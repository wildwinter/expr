// ---------------------------------------------------------------------------
// The VALUE wizard: a small guided popover for picking the value of a `set`
// target (or an `emit` argument), modelled on the storylets Outcomes
// "ChangeValueStep". It picks ONE value - a property reference, or a type-
// appropriate literal (number / text / true-false / enum) - and commits it.
// No operator step: extending into `x + y` is done afterwards, optionally, via
// the inline editor's "+ term" affordance (not a forced popup).
//
// Commits a name-form source string (`5`, `"autumn"`, `true`, `@gold`).
// ---------------------------------------------------------------------------

import { el, button, textField } from "./dom.js";
import { flagChangeSrc } from "./ast.js";
import { propertyPicker } from "./flat.js";
import { refOf, type CatalogueEntry, type PropertyType } from "./schema.js";
import type { EditCtx } from "./types.js";

export interface ValueWizardOptions {
  catalogue: CatalogueEntry[];
  scopeOrder: string[];
  defaultScope: string;
  /** When known (a `set` target's declared type), the picker leads straight to that input. */
  expectedType?: PropertyType;
  /** The target's closed set of values, when it has one: an enum's values, or a QUALITY's stages in
   *  ladder order. Callers should fill this with `choicesOf(entry)` rather than reading a single
   *  field, so a quality is never handed a wizard that knows its type but not its ladder. */
  expectedChoices?: string[];
  /** @deprecated Use `expectedChoices`. Kept so a 0.11.x caller keeps working. */
  expectedEnumValues?: string[];
  /** A FLAGS target's qualified ref and declared flags: together they unlock the
   *  set/clear-a-flag step, which is what outcomes on a flags property
   *  overwhelmingly want and which a whole-value change cannot express (the
   *  Storyletter antagonist audit's find, 2026-08-29). Absent, the generic
   *  kinds stand alone as before. */
  expectedRef?: string;
  expectedFlags?: string[];
  /** Receives the chosen value as name-form source. */
  onCommit: (src: string) => void;
  /** Optional cancel (the ✕ on the step). */
  onCancel?: () => void;
}

const isIdent = (v: string): boolean => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(v);
/** An enum / bare string commits unquoted only when it's a safe identifier, else JSON-quoted. */
const enumSrc = (v: string): string => (isIdent(v) ? v : JSON.stringify(v));

/** Build the wizard UI into a fresh element (drive it via the host's popover). */
export function valueWizard(opts: ValueWizardOptions): HTMLElement {
  const host = el("div", "exed-vwiz");
  // propertyPicker only reads catalogue / defaultScope / scopeOrder off the ctx.
  const pickCtx = { catalogue: opts.catalogue, defaultScope: opts.defaultScope, scopeOrder: opts.scopeOrder } as unknown as EditCtx;
  const optBtn = (label: string, onClick: () => void): HTMLButtonElement => button("exed-opt", label, onClick);

  const head = (title: string): HTMLElement => {
    const h = el("div", "exed-vwiz-head");
    if (opts.onCancel) h.append(button("exed-vwiz-back", "✕", opts.onCancel, "Cancel"));
    h.append(el("span", "exed-vwiz-title", [title]));
    return h;
  };

  host.append(head("Pick a value"));
  const body = el("div", "exed-vwiz-body");
  host.append(body);

  const choices = opts.expectedChoices?.length ? opts.expectedChoices : opts.expectedEnumValues;
  // A quality's list is of STAGES on a ladder, and saying so is the difference between "pick one of
  // these" and "pick where the story now stands".
  const isStage = opts.expectedType === "quality";
  
  // The flags step exists when the caller handed us the target's ref (without
  // it there is nothing to write set_flags against).
  const flagsReady = opts.expectedType === "flags" && opts.expectedRef !== undefined;
  // Lead straight to a known target type's input; otherwise show the kind chooser.
  // Any type with a closed set of values leads straight to it - a quality included, which fell through
  // to the generic chooser before 0.12.0 because the test named only `enum`.
  let kind: "menu" | "property" | "number" | "text" | "bool" | "enum" | "flags" =
    opts.expectedType === "number" ? "number" : opts.expectedType === "string" ? "text"
      : opts.expectedType === "boolean" ? "bool"
        : (opts.expectedType === "enum" || opts.expectedType === "quality") && choices?.length ? "enum"
          : flagsReady ? "flags" : "menu";

  const draw = (): void => {
    body.replaceChildren();
    const other = (): HTMLButtonElement => button("exed-vwiz-other", "↩ a different kind", () => { kind = "menu"; draw(); });
    switch (kind) {
      case "menu":
        if (flagsReady) body.append(optBtn("Set or clear a flag…", () => { kind = "flags"; draw(); }));
        body.append(optBtn("A property…", () => { kind = "property"; draw(); }));
        body.append(optBtn("A number", () => { kind = "number"; draw(); }));
        body.append(optBtn("Text", () => { kind = "text"; draw(); }));
        body.append(optBtn("True / False", () => { kind = "bool"; draw(); }));
        if (choices?.length) body.append(optBtn(isStage ? "A stage" : "A listed value", () => { kind = "enum"; draw(); }));
        break;
      case "flags": {
        // Adjust one flag, keep the rest: the form outcomes on a flags
        // property overwhelmingly want. Whole-value assignment stays a step
        // away ("a different kind"), where its replace-everything nature is a
        // choice rather than a trap.
        const flags = opts.expectedFlags ?? [];
        if (!flags.length) body.append(el("div", "exed-hint", ["This property declares no flag values yet."]));
        for (const sign of ["+", "-"] as const) {
          if (!flags.length) break;
          body.append(el("div", "exed-vwiz-note", [sign === "+" ? "Set a flag:" : "Clear a flag:"]));
          const row = el("div", "exed-field-row");
          for (const f of flags) row.append(optBtn(`${sign} ${f}`, () => opts.onCommit(flagChangeSrc(opts.expectedRef!, sign, f))));
          body.append(row);
        }
        body.append(button("exed-vwiz-other", "↩ a different kind (replaces every flag)", () => { kind = "menu"; draw(); }));
        break;
      }
      case "property":
        body.append(propertyPicker(pickCtx, { onPick: (e) => opts.onCommit(refOf(e, opts.defaultScope)) }));
        body.append(other());
        break;
      case "number":
        body.append(textField({ caption: "Number", placeholder: "e.g. 5 or 0.5", validate: (v) => v.trim() !== "" && Number.isFinite(Number(v)), onCommit: (v) => opts.onCommit(String(Number(v))) }));
        body.append(other());
        break;
      case "text":
        body.append(textField({ caption: "Text", placeholder: "e.g. autumn", onCommit: (v) => opts.onCommit(JSON.stringify(v)) }));
        body.append(other());
        break;
      case "bool": {
        const row = el("div", "exed-field-row");
        row.append(optBtn("true", () => opts.onCommit("true")), optBtn("false", () => opts.onCommit("false")));
        body.append(row, other());
        break;
      }
      case "enum":
        body.append(el("div", "exed-vwiz-note", [isStage ? "Stages, in ladder order:" : ""]));
        for (const v of choices ?? []) body.append(optBtn(v, () => opts.onCommit(enumSrc(v))));
        body.append(other());
        break;
    }
  };
  draw();
  return host;
}
