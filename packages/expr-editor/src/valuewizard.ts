// ---------------------------------------------------------------------------
// The VALUE wizard: a small guided popover for picking the value of a `set`
// target (or an `emit` argument), modelled on the storylets Outcomes
// "ChangeValueStep". It picks ONE value - a property reference, or a type-
// appropriate literal (number / text / true-false / enum) - and commits it.
// No operator step: extending into `x + y` is done afterwards, optionally, via
// the inline editor's "+ term" affordance (not a forced popup). The one
// exception is a number target whose ref is known: there the step leads with
// "Change by", which writes `<ref> + n` or `<ref> - n` in one go.
//
// Commits a name-form source string (`5`, `"autumn"`, `true`, `@gold`,
// `@gold + 1`).
// ---------------------------------------------------------------------------

import { KEYWORD_NAMES } from "@wildwinter/expr";
import { el, button, textField } from "./dom.js";
import { flagChangeSrc, changeBySrc } from "./ast.js";
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
  /** The target's qualified ref. For a FLAGS target, with `expectedFlags`, it unlocks the
   *  set/clear-a-flag step, which is what outcomes on a flags property
   *  overwhelmingly want and which a whole-value change cannot express (the
   *  Storyletter antagonist audit's find, 2026-08-29). For a NUMBER target it
   *  unlocks "Change by" (`<ref> + n`), which leads the number step. Absent,
   *  the generic kinds stand alone as before. */
  expectedRef?: string;
  expectedFlags?: string[];
  /** Receives the chosen value as name-form source. */
  onCommit: (src: string) => void;
  /** Optional cancel (the ✕ on the step). */
  onCancel?: () => void;
}

/** A bare word the parser reads back as the same string: never a keyword (`true`, `and`), which would read
 *  back as the keyword, as `unparse` already knows. */
const isIdent = (v: string): boolean => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(v) && !KEYWORD_NAMES.includes(v);
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
  // Likewise Change by: `<ref> + n` needs the ref to write.
  const changeReady = opts.expectedType === "number" && opts.expectedRef !== undefined;
  // Lead straight to a known target type's input; otherwise show the kind chooser.
  // Any type with a closed set of values leads straight to it - a quality included, which fell through
  // to the generic chooser before 0.12.0 because the test named only `enum`.
  let kind: "menu" | "property" | "number" | "text" | "bool" | "enum" | "flags" =
    opts.expectedType === "number" ? "number" : opts.expectedType === "string" ? "text"
      : opts.expectedType === "boolean" ? "bool"
        : (opts.expectedType === "enum" || opts.expectedType === "quality") && choices?.length ? "enum"
          : flagsReady ? "flags" : "menu";
  /** Which half of the flag step is showing. A TOGGLE rather than two lists, for
   *  the reason clausewizard's flag step already uses one: the flags are data,
   *  so laying out sign x flag puts an unbounded list on the screen twice. */
  let flagSign: "+" | "-" = "+";
  /** Change by's sign: add, or take away. */
  let changeSign: "+" | "-" = "+";
  const isNumber = (v: string): boolean => v.trim() !== "" && Number.isFinite(Number(v));

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
        //
        // ONE column under a sign toggle, which is the shape the package's other
        // two flag pickers already use (clausewizard's flag step, and the
        // flagEditor menu). This branch was the odd one out: it laid the flags
        // out as sign x flag in an `exed-field-row`, a row written for the two
        // buttons of a true/false choice and so carrying no `flex-wrap`. The
        // flags are DATA - a Storyletter project declared ten - so the row grew
        // to ten chips wide, twice, and ran straight off the popover and out of
        // the window (reported 2026-08-30). A list built from user data belongs
        // in the same shape as every other list built from user data.
        const flags = opts.expectedFlags ?? [];
        if (!flags.length) body.append(el("div", "exed-hint", ["This property declares no flag values yet."]));
        else {
          const signRow = el("div", "exed-field-row");
          signRow.append(
            button(`exed-opt${flagSign === "+" ? " sel" : ""}`, "＋ set", () => { flagSign = "+"; draw(); }),
            button(`exed-opt${flagSign === "-" ? " sel" : ""}`, "－ clear", () => { flagSign = "-"; draw(); }),
          );
          body.append(signRow);
          body.append(el("div", "exed-vwiz-note", [flagSign === "+" ? "Set a flag:" : "Clear a flag:"]));
          const list = el("div", "exed-picker-list");
          for (const f of flags) list.append(optBtn(`${flagSign} ${f}`, () => opts.onCommit(flagChangeSrc(opts.expectedRef!, flagSign, f))));
          body.append(list);
        }
        body.append(button("exed-vwiz-other", "↩ a different kind (replaces every flag)", () => { kind = "menu"; draw(); }));
        break;
      }
      case "property":
        body.append(propertyPicker(pickCtx, { onPick: (e) => opts.onCommit(refOf(e, opts.defaultScope)) }));
        body.append(other());
        break;
      case "number": {
        // Add to it or take from it, keep the rest: the form outcomes on a
        // number property overwhelmingly want (reputation goes up by one, gold
        // down by five). Without this step the number field took only a
        // literal, and the route to `@reputation + 1` was eight steps through
        // "a different kind", the property again, and "+ term" (ruled
        // 2026-10-28). It writes exactly what that route writes, so the value
        // reads back as the property plus a term. Setting an absolute number
        // stays right below it, because that is a real choice too.
        //
        // The sign is a TOGGLE, the flags step's shape, and switching it
        // restyles the two buttons in place rather than redrawing, so an
        // amount already typed survives the switch.
        if (changeReady) {
          const change = el("div", "exed-vwiz-section");
          change.append(el("div", "exed-menu-head", ["Change by"]));
          const signRow = el("div", "exed-field-row");
          const add = button("exed-opt", "＋ add", () => { changeSign = "+"; syncSign(); });
          const take = button("exed-opt", "－ take away", () => { changeSign = "-"; syncSign(); });
          const syncSign = (): void => {
            add.className = `exed-opt${changeSign === "+" ? " sel" : ""}`;
            take.className = `exed-opt${changeSign === "-" ? " sel" : ""}`;
          };
          syncSign();
          signRow.append(add, take);
          change.append(signRow);
          change.append(textField({
            caption: "by", placeholder: "e.g. 1", validate: isNumber,
            onCommit: (v) => opts.onCommit(changeBySrc(opts.expectedRef!, changeSign, Number(v), opts.defaultScope)),
          }));
          body.append(change);
        }
        const set = el("div", "exed-vwiz-section");
        set.append(textField({
          caption: "Set it to", placeholder: "e.g. 5 or 0.5", validate: isNumber,
          invalidHint: changeReady ? "Not a number. To add to it, use Change by above." : "Not a number.",
          // Change by leads, so it takes the focus when it is there.
          autofocus: !changeReady,
          onCommit: (v) => opts.onCommit(String(Number(v))),
        }));
        body.append(set);
        body.append(other());
        break;
      }
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
