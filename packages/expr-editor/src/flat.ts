// ---------------------------------------------------------------------------
// The flat editor: render an ExprNode as a strip of clickable PILLS, each opening
// a popover micro-editor (property picker / literal / operator swap / flag delta /
// call). Used standalone and inside each tree-row's content. Ported from the
// storylets ExpressionEditor, retargeted to @wildwinter/expr's ExprNode.
// ---------------------------------------------------------------------------

import type { ExprNode, BinaryOp, AstPath } from "@wildwinter/expr";
import { setNodeAt, deleteAt, findEnumPeer, getNodeAt as pathNode, boolLit, numLit, strLit, scopedVar, flagDelta, isComparisonOp } from "./ast.js";
import { BINARY_LABEL, UNARY_LABEL, opSwapGroup, needsParens, formatNumber } from "./ops.js";
import {
  type CatalogueEntry, displayName, refOf, lookup, filterCatalogue, searchCatalogue, groupByScope, type PropertyType,
} from "./schema.js";
import { el, button, textField } from "./dom.js";
import { issuesAt } from "./validate.js";
import type { EditCtx } from "./types.js";

const FLAG_FNS = new Set(["check_flags", "set_flags"]);
const TAG_ARG0_FNS = new Set(["seen", "patter_seen", "visits", "patter_visits"]);

/** A pill button. `kind` selects the colour class; `issues` rings it red. `path`
 *  tags the element (data-exed-path) so the mount can find and auto-open it.
 *  `aria` overrides the accessible name (for glyph labels like operators). */
function pill(kind: string, label: string, onClick: (b: HTMLButtonElement) => void, opts: { issue?: string; title?: string; path?: AstPath; aria?: string } = {}): HTMLButtonElement {
  const b = button(`exed-pill exed-pill-${kind}${opts.issue ? " exed-pill-err" : ""}`, label, () => onClick(b), opts.issue ?? opts.title, opts.aria);
  b.setAttribute("aria-haspopup", "dialog"); // every pill opens a popover micro-editor
  if (opts.path) b.dataset["exedPath"] = opts.path.join("/");
  return b;
}

/** Plain-language names for operators, for the pill's accessible label. */
const OP_ARIA: Record<string, string> = {
  "==": "equals", "!=": "not equal to", ">": "greater than", ">=": "at least",
  "<": "less than", "<=": "at most", "and": "and", "or": "or",
  "+": "plus", "-": "minus", "*": "times", "/": "divided by",
};

const issueText = (ctx: EditCtx, path: AstPath): string | undefined => {
  const list = issuesAt(ctx.byPath, path);
  return list.length ? list.map((i) => i.message).join("; ") : undefined;
};

/** Commit a replacement node at `path`. */
const replace = (ctx: EditCtx, path: AstPath, next: ExprNode): void => ctx.apply(setNodeAt(ctx.getAst(), path, next));

// --- the recursive pill renderer --------------------------------------------

/** Render `node` (at `path`) as inline pills. `parentOp`/`side` drive parenthesisation. */
export function renderNode(node: ExprNode, path: AstPath, ctx: EditCtx, parentOp?: BinaryOp, side?: "left" | "right"): HTMLElement {
  const issue = issueText(ctx, path);
  switch (node.kind) {
    case "bool":
      return pill("bool", node.value ? "true" : "false", (b) => boolEditor(ctx, path, node.value, b), { issue });
    case "number":
      return pill("number", formatNumber(node.value), (b) => numberEditor(ctx, path, node.value, b), { issue });
    case "string": {
      const isArg = path[path.length - 2] === "args"; // a call argument (the segment before the index)
      // A node-reference arg (seen/visits arg0) gets a flow-node picker when the host provides one,
      // instead of a free-text field - the value is a node id, shown via its readable label.
      const call = isArg ? pathNode(ctx.getAst(), path.slice(0, -2)) : null;
      const isNodeRef = !!ctx.pickNode && call?.kind === "call" && TAG_ARG0_FNS.has(call.name) && path[path.length - 1] === 0;
      if (isNodeRef) {
        const openPick = (b: HTMLButtonElement): void => ctx.pickNode!(b, node.value, (id) => replace(ctx, path, strLit(id)));
        return node.value === ""
          ? pill("placeholder", "pick a node…", openPick, { issue, path })
          : pill("node", ctx.nodeLabel?.(node.value) ?? node.value, openPick, { issue, title: node.value });
      }
      // An empty literal is an unfilled slot, not the literal text "empty": render
      // it as a clearly-placeholder pill so it can't be mistaken for real content.
      if (node.value === "")
        return pill("placeholder", isArg ? "set a tag…" : "set a value…", (b) => stringEditor(ctx, path, node, b), { issue, path });
      return pill(isArg ? "tag" : "string", node.value, (b) => stringEditor(ctx, path, node, b), { issue });
    }
    case "scopedvar": {
      const entry = lookup(ctx.catalogue, node.scope, node.name);
      const label = displayName({ scope: node.scope, name: node.name }, ctx.defaultScope);
      const varPill = pill("var", label, (b) => variableEditor(ctx, path, node, b), { issue: issue ?? (entry ? undefined : `Unknown property ${label}`) });
      attachPropertyMenu(ctx, node, varPill);
      return varPill;
    }
    case "flagdelta":
      return pill(node.sign === "+" ? "flagpos" : "flagneg", `${node.sign}${node.name || "flag"}`, (b) => flagEditor(ctx, path, node, b), { issue, path });
    case "call": {
      const row = el("span", "exed-call");
      row.append(pill("func", node.name, (b) => callEditor(ctx, path, node, b), { issue }));
      row.append(el("span", "exed-paren", ["("]));
      node.args.forEach((arg, i) => {
        if (i > 0) row.append(el("span", "exed-comma", [", "]));
        row.append(renderNode(arg, [...path, "args", i], ctx));
      });
      row.append(el("span", "exed-paren", [")"]));
      return row;
    }
    case "unary": {
      const row = el("span", "exed-unary");
      row.append(pill("op", UNARY_LABEL[node.op], () => ctx.apply(deleteOrUnwrapNot(ctx, path, node)), { title: "remove", aria: `${OP_ARIA[node.op] ?? node.op} (click to remove)` }));
      row.append(renderNode(node.operand, [...path, "operand"], ctx));
      return row;
    }
    case "binary": {
      const row = el("span", "exed-binary");
      const wrap = parentOp && needsParens(node.op, parentOp, side ?? "left");
      if (wrap) row.append(el("span", "exed-paren", ["("]));
      row.append(renderNode(node.left, [...path, "left"], ctx, node.op, "left"));
      const swap = opSwapGroup(node.op);
      const opPill = pill("op", BINARY_LABEL[node.op], (b) => { if (swap) operatorEditor(ctx, path, node.op, swap, b); }, { title: swap ? "swap operator" : undefined, aria: OP_ARIA[node.op] ?? node.op });
      if (!swap) opPill.classList.add("exed-op-structural");
      row.append(opPill);
      row.append(renderNode(node.right, [...path, "right"], ctx, node.op, "right"));
      if (wrap) row.append(el("span", "exed-paren", [")"]));
      return row;
    }
  }
}

/**
 * The +set / −unset toggle shared by every flag editor (the add-flag chip and
 * the per-pill flag editor). Two flex buttons themed emerald / rose via
 * --exed-flagpos / --exed-flagneg, matching the flag-delta pill colours.
 */
export function signToggle(current: "+" | "-", onPick: (s: "+" | "-") => void): HTMLElement {
  const row = el("div", "exed-sign");
  (["+", "-"] as const).forEach((s) => {
    const cls = `exed-signbtn${s === current ? (s === "+" ? " sel-pos" : " sel-neg") : ""}`;
    row.append(button(cls, s === "+" ? "+ set" : "− unset", () => onPick(s)));
  });
  return row;
}

const deleteOrUnwrapNot = (ctx: EditCtx, path: AstPath, node: ExprNode & { kind: "unary" }): ExprNode | null =>
  // clicking the NOT pill strips it (keeps the operand)
  setNodeAt(ctx.getAst(), path, node.operand);

/** Right-click a property pill -> a menu of host actions (e.g. go to definition). */
function attachPropertyMenu(ctx: EditCtx, node: ExprNode & { kind: "scopedvar" }, pillEl: HTMLButtonElement): void {
  if (!ctx.propertyActions) return;
  const actions = ctx.propertyActions({ scope: node.scope, name: node.name });
  if (!actions.length) return;
  pillEl.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    ctx.openPopover(pillEl, (close) => {
      const wrap = el("div", "exed-menu");
      for (const a of actions) wrap.append(button("exed-opt", a.label, () => { a.run(); close(); }));
      return wrap;
    });
  });
}

/** A comparison whose operands are a numeric dialect-function call and a number
 *  literal - a wizard-inserted unit that should delete atomically (half a
 *  comparison is meaningless). Dialect-driven: the call's returnType is "number". */
function isCompoundComparison(node: ExprNode, ctx: EditCtx): boolean {
  if (node.kind !== "binary" || !isComparisonOp(node.op)) return false;
  const numCall = (n: ExprNode): boolean => n.kind === "call" && ctx.dialect.functions[n.name]?.returnType === "number";
  const isNum = (n: ExprNode): boolean => n.kind === "number";
  return (numCall(node.left) && isNum(node.right)) || (numCall(node.right) && isNum(node.left));
}

/** Redirect a delete of a compound-comparison operand to the whole comparison. */
function effectiveDeletePath(ctx: EditCtx, path: AstPath): AstPath {
  const last = path[path.length - 1];
  if (last !== "left" && last !== "right") return path;
  const parentPath = path.slice(0, -1);
  const parent = pathNode(ctx.getAst(), parentPath);
  return parent && isCompoundComparison(parent, ctx) ? parentPath : path;
}

// --- popover micro-editors ---------------------------------------------------

function boolEditor(ctx: EditCtx, path: AstPath, value: boolean, anchor: HTMLButtonElement): void {
  ctx.openPopover(anchor, (close) => {
    const wrap = el("div", "exed-menu");
    wrap.append(el("div", "exed-menu-head", ["Boolean value"]));
    for (const v of [true, false]) {
      wrap.append(button(`exed-opt${v === value ? " sel" : ""}`, String(v), () => { replace(ctx, path, boolLit(v)); close(); }));
    }
    return wrap;
  });
}

function numberEditor(ctx: EditCtx, path: AstPath, value: number, anchor: HTMLButtonElement): void {
  ctx.openPopover(anchor, (close) => textField({
    initial: formatNumber(value), caption: "Number value", placeholder: "0",
    validate: (v) => v.trim() !== "" && Number.isFinite(Number(v)),
    onCommit: (v) => { replace(ctx, path, numLit(Number(v))); close(); },
  }));
}

function stringEditor(ctx: EditCtx, path: AstPath, node: ExprNode & { kind: "string" }, anchor: HTMLButtonElement): void {
  const peer = findEnumPeer(ctx.getAst(), path);
  const enumEntry = peer ? lookup(ctx.catalogue, peer.scope, peer.name) : null;
  // Enum options come from a comparison peer, or - for the single root literal of
  // a value field - from the target's declared enum values (ctx.valueEnumValues).
  const rootValueEnums = path.length === 0 && ctx.valueEnumValues?.length ? ctx.valueEnumValues : null;
  const enumValues = enumEntry?.enumValues?.length ? enumEntry.enumValues : rootValueEnums;
  const enumHeadLabel = enumEntry ? `${displayName(enumEntry, ctx.defaultScope)} value` : "Value";
  ctx.openPopover(anchor, (close) => {
    // Enum value list when compared against an enum property or as an enum value field.
    if (enumValues?.length) {
      const wrap = el("div", "exed-menu");
      wrap.append(el("div", "exed-menu-head", [enumHeadLabel]));
      for (const v of enumValues) {
        wrap.append(button(`exed-opt${v === node.value ? " sel" : ""}`, v, () => { replace(ctx, path, strLit(v)); close(); }));
      }
      return wrap;
    }
    return textField({
      initial: node.value, caption: "Text value", placeholder: "value",
      onCommit: (v) => { replace(ctx, path, strLit(v)); close(); },
    });
  });
}

function operatorEditor(ctx: EditCtx, path: AstPath, current: BinaryOp, group: BinaryOp[], anchor: HTMLButtonElement): void {
  ctx.openPopover(anchor, (close) => {
    const wrap = el("div", "exed-menu");
    wrap.append(el("div", "exed-menu-head", ["Operator"]));
    for (const op of group) {
      wrap.append(button(`exed-opt${op === current ? " sel" : ""}`, `${BINARY_LABEL[op]}  ${op}`, () => {
        const node = ctx.getAst();
        const cur = setNodeAt(node, path, { ...(getBinary(ctx, path)), op } as ExprNode);
        ctx.apply(cur); close();
      }));
    }
    return wrap;
  });
}

const getBinary = (ctx: EditCtx, path: AstPath): ExprNode & { kind: "binary" } => {
  const n = pathNode(ctx.getAst(), path);
  if (n?.kind !== "binary") throw new Error("expected binary");
  return n;
};

function flagEditor(ctx: EditCtx, path: AstPath, node: ExprNode & { kind: "flagdelta" }, anchor: HTMLButtonElement): void {
  // The flags property is the call's first arg (the sibling at args[0]).
  const callPath = path.slice(0, -2);
  const call = pathNode(ctx.getAst(), callPath);
  const flagsVar = call?.kind === "call" ? call.args[0] : undefined;
  const entry = flagsVar?.kind === "scopedvar" ? lookup(ctx.catalogue, flagsVar.scope, flagsVar.name) : null;
  const flagCount = call?.kind === "call" ? call.args.filter((a) => a.kind === "flagdelta").length : 0;
  const used = call?.kind === "call"
    ? call.args.filter((a, i): a is ExprNode & { kind: "flagdelta" } => a.kind === "flagdelta" && i !== (path[path.length - 1] as number)).map((a) => a.name)
    : [];
  // The last flag delta can't be removed when the field must stay non-empty
  // (a set_flags value cell must always carry at least one flag).
  const canRemove = !(ctx.requireNonEmpty && flagCount <= 1);
  ctx.openPopover(anchor, (close) => {
    const wrap = el("div", "exed-menu");
    wrap.append(el("div", "exed-menu-head", ["Flag set?"]));
    wrap.append(signToggle(node.sign, (s) => { replace(ctx, path, flagDelta(s, node.name)); close(); }));
    const names = (entry?.enumValues ?? []).filter((n) => !used.includes(n));
    if (names.length) {
      wrap.append(el("div", "exed-menu-head", ["Flag"]));
      for (const n of names) wrap.append(button(`exed-opt${n === node.name ? " sel" : ""}`, n, () => { replace(ctx, path, flagDelta(node.sign, n)); close(); }));
    } else {
      wrap.append(textField({ initial: node.name, caption: "Flag name", onCommit: (v) => { replace(ctx, path, flagDelta(node.sign, v)); close(); } }));
    }
    if (canRemove) {
      wrap.append(button("exed-opt danger", "Remove flag", () => { ctx.apply(deleteAt(ctx.getAst(), path)); close(); }));
    }
    return wrap;
  });
}

// A root-emptying delete is withheld when the field must stay non-empty (a
// single-value field). Check the EFFECTIVE path (a compound-comparison operand
// redirects to the whole comparison), so deleting one is blocked when the
// comparison is the whole value.
const canDelete = (ctx: EditCtx, path: AstPath): boolean =>
  !(ctx.requireNonEmpty && effectiveDeletePath(ctx, path).length === 0);

function callEditor(ctx: EditCtx, path: AstPath, node: ExprNode & { kind: "call" }, anchor: HTMLButtonElement): void {
  ctx.openPopover(anchor, (close) => {
    const wrap = el("div", "exed-menu");
    wrap.append(el("div", "exed-menu-head", [node.name]));
    wrap.append(el("div", "exed-hint", ["Edit the arguments by clicking each one."]));
    if (FLAG_FNS.has(node.name)) {
      wrap.append(button("exed-opt", "+ add flag", () => { replace(ctx, path, { ...node, args: [...node.args, flagDelta("+", "")] }); close(); }));
    }
    if (canDelete(ctx, path)) {
      wrap.append(button("exed-opt danger", "Delete", () => { ctx.apply(deleteAt(ctx.getAst(), effectiveDeletePath(ctx, path))); close(); }));
    }
    return wrap;
  });
}

function variableEditor(ctx: EditCtx, path: AstPath, node: ExprNode & { kind: "scopedvar" }, anchor: HTMLButtonElement): void {
  ctx.openPopover(anchor, (close) => propertyPicker(ctx, {
    current: refOf(node, ctx.defaultScope),
    onPick: (entry) => { replace(ctx, path, scopedVar(entry.scope, entry.name)); close(); },
    ...(canDelete(ctx, path)
      ? { footer: button("exed-opt danger", "Delete", () => { ctx.apply(deleteAt(ctx.getAst(), effectiveDeletePath(ctx, path))); close(); }) }
      : {}),
  }));
}

// --- property picker ---------------------------------------------------------

export function propertyPicker(ctx: EditCtx, opts: {
  current?: string; accept?: PropertyType[]; onPick: (e: CatalogueEntry) => void; footer?: Node;
}): HTMLElement {
  const wrap = el("div", "exed-picker");
  const search = el("input", "exed-input");
  search.type = "text"; search.placeholder = "Search properties…";
  const list = el("div", "exed-picker-list");
  const pool = filterCatalogue(ctx.catalogue, { acceptTypes: opts.accept });
  const draw = (): void => {
    list.replaceChildren();
    const groups = groupByScope(searchCatalogue(pool, search.value, ctx.defaultScope), ctx.scopeOrder);
    if (!groups.length) { list.append(el("div", "exed-hint", ["No matching properties."])); return; }
    for (const g of groups) {
      list.append(el("div", "exed-picker-scope", [g.scope]));
      for (const e of g.entries) {
        const label = displayName(e, ctx.defaultScope);
        const sel = opts.current === refOf(e, ctx.defaultScope);
        const row = button(`exed-opt${sel ? " sel" : ""}`, "", () => opts.onPick(e));
        row.append(el("span", "exed-opt-name", [label]), el("span", "exed-opt-type", [e.type]));
        if (e.purpose) row.append(el("span", "exed-opt-purpose", [e.purpose]));
        list.append(row);
      }
    }
  };
  search.addEventListener("input", draw);
  draw();
  wrap.append(search, list);
  if (opts.footer) wrap.append(el("div", "exed-picker-foot", [opts.footer]));
  setTimeout(() => search.focus(), 0);
  return wrap;
}
