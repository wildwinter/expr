// ---------------------------------------------------------------------------
// Condition CLAUSE wizards — multi-step guided builders for the "Add a clause"
// menu, ported from the storylets condition editor (clauseWizards.tsx) to
// vanilla-TS / ExprNode. Each wizard renders its steps into a popover host
// element (rebuilt in place as the author advances) and commits a finished
// ExprNode. No clause is inserted with placeholder defaults the author then has
// to chase down.
//
//   comparisonWizard   — property → operator → value (literal or property)
//   booleanWizard      — pick a boolean property (the bare `@flag` clause)
//   checkFlagsWizard   — flags property → +set/−unset → flag
//   randomWizard       — range(a,b) → operator → value
// ---------------------------------------------------------------------------

import type { BinaryOp, ExprNode } from "@wildwinter/expr";
import { el, button, textField } from "./dom.js";
import { propertyPicker } from "./flat.js";
import { binary, scopedVar, numLit, strLit, boolLit, callNode, flagDelta } from "./ast.js";
import { BINARY_LABEL, COMPARISON_OPS } from "./ops.js";
import { type CatalogueEntry, type PropertyType } from "./schema.js";
import type { EditCtx, WizardSpec, WizardValue } from "./types.js";

export interface ClauseWizardCtx {
  catalogue: CatalogueEntry[];
  scopeOrder: string[];
  defaultScope: string;
}

type Commit = (node: ExprNode) => void;
type Cancel = () => void;

const EQUALITY: BinaryOp[] = ["==", "!="];
/** Plain-language gloss for each comparison op (shown beside its glyph, matching storylets). */
const OP_WORD: Partial<Record<BinaryOp, string>> = {
  "==": "equals", "!=": "not equal to", ">": "greater than", ">=": "at least", "<": "less than", "<=": "at most",
};
/** An operator option button: glyph + plain-language word (never the glyph twice). */
const opButton = (o: BinaryOp, onClick: () => void): HTMLButtonElement => {
  const b = button("exed-opt", "", onClick);
  b.append(el("span", "exed-opt-name", [BINARY_LABEL[o]]), el("span", "exed-opt-purpose", [OP_WORD[o] ?? ""]));
  return b;
};
const opsForType = (t: PropertyType): BinaryOp[] => (t === "number" ? COMPARISON_OPS : EQUALITY);
const rhsTypesFor = (t: PropertyType): PropertyType[] =>
  t === "number" ? ["number"] : t === "boolean" ? ["boolean"] : t === "enum" ? ["enum", "string"] : ["string", "enum"];

/** Shared chrome: a step header with a back/cancel control and a title. */
function header(host: HTMLElement, title: string | Node, back: (() => void) | undefined, cancel: Cancel | undefined): void {
  const h = el("div", "exed-vwiz-head");
  if (back) h.append(button("exed-vwiz-back", "←", back, "Back"));
  else if (cancel) h.append(button("exed-vwiz-back", "✕", cancel, "Cancel"));
  h.append(el("span", "exed-vwiz-title", [title]));
  host.append(h);
}

const mono = (s: string): HTMLElement => el("span", "exed-vwiz-mono", [s]);
const pickCtxOf = (w: ClauseWizardCtx): EditCtx =>
  ({ catalogue: w.catalogue, defaultScope: w.defaultScope, scopeOrder: w.scopeOrder } as unknown as EditCtx);

/** The shared "pick a value" step: type-appropriate literal input, or switch to a property. */
function valueStep(host: HTMLElement, w: ClauseWizardCtx, lhs: { ref: string; type: PropertyType; enumValues?: string[] }, op: BinaryOp, back: () => void, cancel: Cancel, commit: Commit): void {
  let mode: "value" | "property" = "value";
  const draw = (): void => {
    host.replaceChildren();
    header(host, el("span", undefined, [mono(lhs.ref), " ", BINARY_LABEL[op], " …"]), back, cancel);
    const body = el("div", "exed-vwiz-body");
    host.append(body);
    const swap = (): HTMLButtonElement => button("exed-vwiz-other", mode === "value" ? "↩ use a property instead" : "↩ use a value instead", () => { mode = mode === "value" ? "property" : "value"; draw(); });

    const done = (rhs: ExprNode): void => commit(binary(op, lhsVar(w, lhs.ref), rhs));
    if (mode === "property") {
      body.append(propertyPicker(pickCtxOf(w), { accept: rhsTypesFor(lhs.type), onPick: (e) => done(scopedVar(e.scope, e.name)) }));
      body.append(swap());
      return;
    }
    if (lhs.type === "boolean") {
      const row = el("div", "exed-field-row");
      row.append(button("exed-opt", "true", () => done(boolLit(true))), button("exed-opt", "false", () => done(boolLit(false))));
      body.append(row);
    } else if (lhs.type === "enum" && lhs.enumValues?.length) {
      for (const v of lhs.enumValues) body.append(button("exed-opt", v, () => done(strLit(v))));
    } else if (lhs.type === "number") {
      body.append(textField({ caption: "Number", placeholder: "e.g. 3", validate: (v) => v.trim() !== "" && Number.isFinite(Number(v)), onCommit: (v) => done(numLit(Number(v))) }));
    } else {
      body.append(textField({ caption: "Text", placeholder: "e.g. autumn", onCommit: (v) => done(strLit(v)) }));
    }
    body.append(swap());
  };
  draw();
}

/** Resolve a "@scope.name" / "@name" display ref into a scopedvar node (default scope when bare). */
function lhsVar(w: ClauseWizardCtx, ref: string): ExprNode {
  const bare = ref.replace(/^@/, "");
  const dot = bare.indexOf(".");
  return dot >= 0 ? scopedVar(bare.slice(0, dot), bare.slice(dot + 1)) : scopedVar(w.defaultScope, bare);
}

/** Property → operator → value. */
export function comparisonWizard(host: HTMLElement, w: ClauseWizardCtx, commit: Commit, cancel: Cancel): void {
  const pickLhs = (): void => {
    host.replaceChildren();
    header(host, "Pick a property to compare", undefined, cancel);
    const body = el("div", "exed-vwiz-body");
    host.append(body);
    body.append(propertyPicker(pickCtxOf(w), {
      accept: ["boolean", "number", "string", "enum"],
      onPick: (e) => pickOp({ ref: refDisplay(w, e), type: e.type, ...(e.enumValues ? { enumValues: e.enumValues } : {}) }),
    }));
  };
  const pickOp = (lhs: { ref: string; type: PropertyType; enumValues?: string[] }): void => {
    host.replaceChildren();
    header(host, el("span", undefined, ["Operator for ", mono(lhs.ref)]), pickLhs, cancel);
    const body = el("div", "exed-vwiz-body");
    host.append(body);
    for (const o of opsForType(lhs.type)) {
      body.append(opButton(o, () => valueStep(host, w, lhs, o, () => pickOp(lhs), cancel, commit)));
    }
  };
  pickLhs();
}

/** Pick a boolean property — the bare `@flag` clause. */
export function booleanWizard(host: HTMLElement, w: ClauseWizardCtx, commit: Commit, cancel: Cancel): void {
  host.replaceChildren();
  header(host, "Pick a boolean property", undefined, cancel);
  const body = el("div", "exed-vwiz-body");
  host.append(body);
  body.append(propertyPicker(pickCtxOf(w), { accept: ["boolean"], onPick: (e) => commit(scopedVar(e.scope, e.name)) }));
}

/** Flags property → +set / −unset → flag. */
export function checkFlagsWizard(host: HTMLElement, w: ClauseWizardCtx, commit: Commit, cancel: Cancel): void {
  const pickProp = (): void => {
    host.replaceChildren();
    header(host, el("span", undefined, ["Flags property for ", mono("check_flags()")]), undefined, cancel);
    const body = el("div", "exed-vwiz-body");
    host.append(body);
    body.append(propertyPicker(pickCtxOf(w), { accept: ["flags"], onPick: (e) => pickFlag(e) }));
  };
  const pickFlag = (prop: CatalogueEntry): void => {
    let sign: "+" | "-" = "+";
    const draw = (): void => {
      host.replaceChildren();
      header(host, el("span", undefined, ["Flag on ", mono(refDisplay(w, prop))]), pickProp, cancel);
      const body = el("div", "exed-vwiz-body");
      host.append(body);
      const signRow = el("div", "exed-field-row");
      signRow.append(
        button(`exed-opt${sign === "+" ? " sel" : ""}`, "＋ set", () => { sign = "+"; draw(); }),
        button(`exed-opt${sign === "-" ? " sel" : ""}`, "－ unset", () => { sign = "-"; draw(); }),
      );
      body.append(signRow);
      const flags = prop.enumValues ?? [];
      if (!flags.length) body.append(el("div", "exed-hint", [`${refDisplay(w, prop)} declares no flag values yet.`]));
      for (const f of flags) body.append(button("exed-opt", f, () => commit(callNode("check_flags", [scopedVar(prop.scope, prop.name), flagDelta(sign, f)]))));
    };
    draw();
  };
  pickProp();
}

/** random(a, b) → operator → value (a whole number in a..b, compared). */
export function randomWizard(host: HTMLElement, w: ClauseWizardCtx, commit: Commit, cancel: Cancel): void {
  const pickRange = (): void => {
    host.replaceChildren();
    header(host, el("span", undefined, ["Range for ", mono("random(a, b)")]), undefined, cancel);
    const body = el("div", "exed-vwiz-body");
    host.append(body);
    let a = "1";
    body.append(textField({ caption: "Low (a)", initial: "1", placeholder: "e.g. 1", validate: numOk, onCommit: (v) => { a = v; } }));
    body.append(textField({
      caption: "High (b)", initial: "6", placeholder: "e.g. 6", submitLabel: "Next →", validate: numOk,
      onCommit: (b) => pickOp(Math.round(Number(a)), Math.round(Number(b))),
    }));
  };
  const pickOp = (a: number, b: number): void => {
    host.replaceChildren();
    header(host, el("span", undefined, ["Operator for ", mono(`random(${a}, ${b})`)]), pickRange, cancel);
    const body = el("div", "exed-vwiz-body");
    host.append(body);
    for (const o of COMPARISON_OPS) {
      body.append(opButton(o, () => pickValue(a, b, o)));
    }
  };
  const pickValue = (a: number, b: number, op: BinaryOp): void => {
    host.replaceChildren();
    header(host, el("span", undefined, [mono(`random(${a}, ${b})`), ` ${BINARY_LABEL[op]} …`]), () => pickOp(a, b), cancel);
    const body = el("div", "exed-vwiz-body");
    host.append(body);
    body.append(textField({ caption: "Compare to", placeholder: "e.g. 1", validate: numOk, onCommit: (v) => commit(binary(op, callNode("random", [numLit(a), numLit(b)]), numLit(Number(v)))) }));
  };
  pickRange();
}

const numOk = (v: string): boolean => v.trim() !== "" && Number.isFinite(Number(v));

/**
 * Generic runner for a declarative WizardSpec: walks the steps in order with the
 * shared back/cancel chrome, collects one value per step, and commits
 * `spec.build(values)`. Lets a dialect add guided flows (tag -> operator ->
 * threshold and the like) without any upstream code.
 */
export function genericWizard(host: HTMLElement, spec: WizardSpec, commit: Commit, cancel: Cancel): void {
  const values: WizardValue[] = [];
  const stepAt = (i: number): void => {
    const step = spec.steps[i];
    if (!step) return;
    host.replaceChildren();
    const back = i > 0 ? (): void => { values.length = i - 1; stepAt(i - 1); } : undefined;
    header(host, step.title, back, cancel);
    const body = el("div", "exed-vwiz-body");
    host.append(body);
    const last = i === spec.steps.length - 1;
    const done = (v: WizardValue): void => {
      values[i] = v;
      if (last) commit(spec.build(values));
      else stepAt(i + 1);
    };
    switch (step.kind) {
      case "string":
        body.append(textField({
          caption: step.caption ?? "Text", placeholder: step.placeholder,
          submitLabel: last ? "Apply" : "Next →",
          validate: (v) => v.trim() !== "",
          onCommit: (v) => done(v.trim()),
        }));
        break;
      case "number":
        body.append(textField({
          caption: step.caption ?? "Number", placeholder: step.placeholder,
          initial: step.initial !== undefined ? String(step.initial) : undefined,
          submitLabel: last ? "Apply" : "Next →",
          validate: numOk,
          onCommit: (v) => done(Number(v)),
        }));
        break;
      case "op":
        for (const o of step.ops ?? COMPARISON_OPS) body.append(opButton(o, () => done(o)));
        break;
    }
  };
  stepAt(0);
}

/** A property's display ref ("@name" in the default scope, else "@scope.name"). */
function refDisplay(w: ClauseWizardCtx, e: CatalogueEntry): string {
  return e.scope === w.defaultScope ? `@${e.name}` : `@${e.scope}.${e.name}`;
}
