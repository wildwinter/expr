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
import { propertyPicker } from "./flat.js";
import { refOf, type CatalogueEntry, type PropertyType } from "./schema.js";
import type { EditCtx } from "./types.js";

export interface ValueWizardOptions {
  catalogue: CatalogueEntry[];
  scopeOrder: string[];
  defaultScope: string;
  /** When known (a `set` target's declared type), the picker leads straight to that input. */
  expectedType?: PropertyType;
  expectedEnumValues?: string[];
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

  // Lead straight to a known target type's input; otherwise show the kind chooser.
  let kind: "menu" | "property" | "number" | "text" | "bool" | "enum" =
    opts.expectedType === "number" ? "number" : opts.expectedType === "string" ? "text"
      : opts.expectedType === "boolean" ? "bool"
        : opts.expectedType === "enum" && opts.expectedEnumValues?.length ? "enum" : "menu";

  const draw = (): void => {
    body.replaceChildren();
    const other = (): HTMLButtonElement => button("exed-vwiz-other", "↩ a different kind", () => { kind = "menu"; draw(); });
    switch (kind) {
      case "menu":
        body.append(optBtn("A property…", () => { kind = "property"; draw(); }));
        body.append(optBtn("A number", () => { kind = "number"; draw(); }));
        body.append(optBtn("Text", () => { kind = "text"; draw(); }));
        body.append(optBtn("True / False", () => { kind = "bool"; draw(); }));
        if (opts.expectedEnumValues?.length) body.append(optBtn("A listed value", () => { kind = "enum"; draw(); }));
        break;
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
        for (const v of opts.expectedEnumValues ?? []) body.append(optBtn(v, () => opts.onCommit(enumSrc(v))));
        body.append(other());
        break;
    }
  };
  draw();
  return host;
}
