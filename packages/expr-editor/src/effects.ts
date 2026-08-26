// ---------------------------------------------------------------------------
// mountEffectsEditor — a framework-neutral visual editor for a LIST of effects
// (outcomes). Each effect is either a `set` (assign a property a value) or an
// `emit` (raise a host event with argument expressions). It is the sibling of
// mountExpressionEditor: where that edits one boolean condition, this edits an
// ordered list of mutations. Every value / argument is itself a full pill/tree
// expression, edited by an embedded mountExpressionEditor (flat mode) — so the
// "visual-and-text" richness of the condition editor carries straight through.
//
// Modelled on the storylets outcome editor (the same system): pick a target
// property, then refine its value by clicking pills. `emit` adds host events
// on top (storylets had no equivalent).
// ---------------------------------------------------------------------------

import { parse, type Dialect, type ExpressionSchema } from "@wildwinter/expr";
import { el, button, openPopover, type Popover } from "./dom.js";
import {
  type CatalogueEntry, type PropertyType,
  filterCatalogue, searchCatalogue, groupByScope, displayName, refOf,
  choicesOf, propertyTip,
} from "./schema.js";
import type { FunctionTemplateSpec } from "./types.js";
import { advancedRef, normaliseRef } from "./ast.js";
import { valueWizard } from "./valuewizard.js";
import { mountExpressionEditor, type ExpressionEditorHandle } from "./mount.js";

/** One effect in name-form: a property assignment or a host event. Mirrors the
 *  host's own Effect model (patter's `set` / `emit`) so it round-trips verbatim. */
export type EditorEffect =
  | { kind: "set"; target: string; value: string }
  | { kind: "emit"; event: string; args: string[] };

/** Does this set advance its OWN target - `@debt = advance(@debt)`, the shape every quality outcome
 *  takes? Then the property is named once (in the target column) instead of three times, and the row
 *  reads as a sentence: `debt advances`. Parsed rather than string-matched so the two ways of writing
 *  one ref agree (`@debt` and `@patter.debt` are the same property; `advance( @debt )` is the same
 *  call). An unparseable value is simply not this shape. */
export function isSelfAdvance(eff: EditorEffect, defaultScope: string, dialect: Dialect): boolean {
  if (eff.kind !== "set" || !eff.target) return false;
  try { return advancedRef(parse(eff.value, dialect), defaultScope) === normaliseRef(eff.target, defaultScope); } catch { return false; }
}

export interface EffectsEditorOptions {
  /** The current effect list (edited in place via onChange). */
  effects: EditorEffect[];
  schema: ExpressionSchema;
  dialect: Dialect;
  /** Properties the target picker + value editors offer. */
  catalogue: CatalogueEntry[];
  scopeOrder?: string[];
  /** Dialect clause templates passed through to each value editor. */
  functions?: FunctionTemplateSpec[];
  /** Known host event names to suggest when adding an `emit` (optional). */
  events?: string[];
  /** Offer the "+ emit event" affordance (default true). A host whose effects are SET-ONLY (e.g.
   *  patter, where host events ride on gameData, not effects) passes false to hide it entirely. */
  allowEmit?: boolean;
  /** Start each inline value editor in raw-text mode (host's global "show as text" toggle drives this). */
  text?: boolean;
  /** Where to append popover micro-editors (default document.body). Pass a container
   *  inside a focus-trapping dialog so popovers do not dismiss it. Threaded to the
   *  target/event pickers here and to every inline value editor. */
  popoverContainer?: HTMLElement;
  /** Host actions for a property pill, shown on right-click (e.g. go to
   *  definition). Threaded to every inline value editor, and honoured by the
   *  set rows' own target pills (resolved via the catalogue). */
  propertyActions?(ref: { scope: string; name: string }): Array<{ label: string; run: () => void }>;
  /** Emitted on every structural / value edit with the whole new list. */
  onChange: (effects: EditorEffect[]) => void;
}

export interface EffectsEditorHandle {
  setValue(effects: EditorEffect[]): void;
  /** Flip every inline value editor between pills and raw text (host's global toggle). */
  setText(on: boolean): void;
  destroy(): void;
}

// --- pure list operations (exported for testing) ---------------------------

const clone = (list: EditorEffect[]): EditorEffect[] => list.map((e) =>
  e.kind === "set" ? { ...e } : { ...e, args: [...e.args] });

export const addSet = (list: EditorEffect[], target: string, value: string): EditorEffect[] =>
  [...clone(list), { kind: "set", target, value }];

export const addEmit = (list: EditorEffect[], event: string): EditorEffect[] =>
  [...clone(list), { kind: "emit", event, args: [] }];

export const removeAt = (list: EditorEffect[], i: number): EditorEffect[] =>
  clone(list).filter((_, idx) => idx !== i);

export function moveAt(list: EditorEffect[], i: number, dir: -1 | 1): EditorEffect[] {
  const next = clone(list);
  const j = i + dir;
  if (j < 0 || j >= next.length) return next;
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
}

export function updateAt(list: EditorEffect[], i: number, patch: Partial<EditorEffect>): EditorEffect[] {
  const next = clone(list);
  const cur = next[i];
  if (!cur) return next;
  next[i] = { ...cur, ...patch } as EditorEffect;
  return next;
}

export function setArgAt(list: EditorEffect[], i: number, argIdx: number, value: string): EditorEffect[] {
  const next = clone(list);
  const cur = next[i];
  if (!cur || cur.kind !== "emit") return next;
  cur.args[argIdx] = value;
  return next;
}

export function addArg(list: EditorEffect[], i: number, value = "0"): EditorEffect[] {
  const next = clone(list);
  const cur = next[i];
  if (!cur || cur.kind !== "emit") return next;
  cur.args.push(value);
  return next;
}

export function removeArgAt(list: EditorEffect[], i: number, argIdx: number): EditorEffect[] {
  const next = clone(list);
  const cur = next[i];
  if (!cur || cur.kind !== "emit") return next;
  cur.args.splice(argIdx, 1);
  return next;
}

/**
 * What a freshly targeted property's value should be, and whether the guided value wizard still has a
 * question worth asking.
 *
 * BOTH paths that target a property go through this - "+ set property" (add) and re-picking an
 * existing effect's target - because when they answered separately they drifted: 0.11.0 seeded a
 * quality with `advance(...)` on re-pick while the add path opened a wizard that did not know what a
 * quality was, so the same job offered two different affordances depending on how you arrived.
 *
 * `ask: false` means the type has a canonical outcome and the wizard would be ceremony: a QUALITY
 * moves to its next stage, which is the insertion-safe form the type exists for, and an author who
 * meant a specific stage clicks the pill.
 */
export function initialValueFor(entry: CatalogueEntry, defaultScope: string): { src: string; ask: boolean } {
  const ref = refOf(entry, defaultScope);
  return {
    src: seedValueSrc(entry.type, choicesOf(entry), ref),
    ask: entry.type !== "quality",
  };
}

/** A sensible starting value-expression for a freshly targeted property. Literals
 *  are seeded so the value editor opens on an editable pill, never the empty state.
 *
 *  A QUALITY seeds to `advance(<ref>)` when the target's ref is known: moving to the next stage is
 *  what outcomes on a ladder overwhelmingly do, and it is the form that keeps a story insertion-safe
 *  (it names no destination, so a stage added later routes through it). Pass no ref and it falls back
 *  to the first stage as a literal, which the author can still swap to `advance(...)`. */
export function seedValueSrc(type: PropertyType, values?: string[], ref?: string): string {
  switch (type) {
    case "boolean": return "true";
    case "number": return "0";
    case "enum": return JSON.stringify(values?.[0] ?? "");
    case "quality": return ref ? `advance(${ref})` : JSON.stringify(values?.[0] ?? "");
    case "string": return '""';
    default: return "0"; // flags / unknown — user refines via pills or raw text
  }
}

// --- mount -----------------------------------------------------------------

export function mountEffectsEditor(host: HTMLElement, opts: EffectsEditorOptions): EffectsEditorHandle {
  const defaultScope = opts.dialect.defaultScope;
  let effects = clone(opts.effects ?? []);
  let textMode = opts.text ?? false; // raw-text view for every inline value editor (host-driven)
  let popover: Popover | null = null;
  const inner: ExpressionEditorHandle[] = []; // inline value / arg editors, destroyed on re-render
  host.classList.add("exed-root", "exed-effects-root");

  const closePopover = (): void => { popover?.close(); popover = null; };
  const commit = (next: EditorEffect[]): void => { effects = clone(next); opts.onChange(effects); render(); };

  /** Open the guided value wizard anchored to `anchor`; commit its built source. */
  const openValueWizard = (anchor: HTMLElement, expected: CatalogueEntry | undefined, onCommit: (src: string) => void): void => {
    closePopover();
    popover = openPopover(anchor, (close) => valueWizard({
      catalogue: opts.catalogue, scopeOrder: opts.scopeOrder ?? [], defaultScope,
      ...(expected?.type ? { expectedType: expected.type } : {}),
      // choicesOf, never a raw field: a quality's ladder lives in `stages`, and reading `enumValues`
      // here told the wizard the type and withheld the values.
      ...(choicesOf(expected) ? { expectedChoices: choicesOf(expected) } : {}),
      onCommit: (src) => { onCommit(src); close(); },
      onCancel: close,
    }), { container: opts.popoverContainer });
  };

  /** The declared type of a `set` target (resolved from the catalogue by its ref), so the value editor
   *  offers the right "+ term" extension (arithmetic for numbers, logical for booleans, none else). */
  const targetType = (target: string): PropertyType | undefined =>
    opts.catalogue.find((e) => refOf(e, defaultScope) === target)?.type;

  /** The committed value as an INLINE editable pill editor (click pills to edit; "+ term" to extend) -
   *  the storylets ExpressionField model. The initial value is picked via the wizard; this edits it.
   *  `addTerm` is type-led: numbers extend arithmetically, booleans logically, others not at all. */
  const valueDisplay = (value: string, onChange: (src: string) => void, type?: PropertyType,
    selfAdvanceRef?: string): HTMLElement => {
    const sub = el("div", "exed-effect-value");
    const addTerm = type === "number" ? "arithmetic" : type === "boolean" ? "boolean" : undefined;
    inner.push(mountExpressionEditor(sub, {
      value, schema: opts.schema, dialect: opts.dialect, catalogue: opts.catalogue,
      scopeOrder: opts.scopeOrder, functions: opts.functions, mode: "flat",
      // Every editor here holds a VALUE (a set's value, an emit's argument), never a condition. Say
      // so, or emptying one falls back to the condition empty state and an outcome row reads
      // "always / + Add your first condition" - condition vocabulary, offering clauses where a value
      // belongs, and no way back to a value. `valueField` renders an editable empty literal instead.
      valueField: true,
      ...(addTerm ? { addTerm } : {}),
      ...(selfAdvanceRef ? { selfAdvanceRef } : {}),
      ...(opts.propertyActions ? { propertyActions: opts.propertyActions } : {}),
      ...(opts.popoverContainer ? { popoverContainer: opts.popoverContainer } : {}),
      text: textMode, onChange,
    }));
    return sub;
  };

  /** The target-property picker popover (reuses the catalogue helpers). */
  const pickTarget = (anchor: HTMLElement, accept: PropertyType[] | undefined, onPick: (e: CatalogueEntry) => void): void => {
    closePopover();
    popover = openPopover(anchor, (close) => {
      const wrap = el("div", "exed-picker");
      const search = el("input", "exed-input");
      search.type = "text"; search.placeholder = "Search properties…";
      const list = el("div", "exed-picker-list");
      const pool = filterCatalogue(opts.catalogue, { acceptTypes: accept });
      const draw = (): void => {
        list.replaceChildren();
        const groups = groupByScope(searchCatalogue(pool, search.value, defaultScope), opts.scopeOrder ?? []);
        if (!groups.length) { list.append(el("div", "exed-hint", ["No matching properties."])); return; }
        for (const g of groups) {
          list.append(el("div", "exed-picker-scope", [g.scope]));
          for (const e of g.entries) {
            const row = button("exed-opt", "", () => { onPick(e); close(); });
            row.append(el("span", "exed-opt-name", [displayName(e, defaultScope)]), el("span", "exed-opt-type", [e.type]));
            if (e.purpose) row.append(el("span", "exed-opt-purpose", [e.purpose]));
            list.append(row);
          }
        }
      };
      search.addEventListener("input", draw);
      draw();
      wrap.append(search, list);
      setTimeout(() => search.focus(), 0);
      return wrap;
    }, { container: opts.popoverContainer });
  };

  const iconBtn = (glyph: string, title: string, onClick: () => void, danger = false): HTMLButtonElement =>
    button(`exed-eff-icon${danger ? " danger" : ""}`, glyph, onClick, title);

  function setRow(eff: Extract<EditorEffect, { kind: "set" }>, i: number): HTMLElement {
    // One line, storylets-style: [target] = [value inline] [actions].
    const row = el("div", "exed-effect exed-effect-set");
    // Target pill — click to repick (re-seeds the value to match the new type).
    const targetBtn = button("exed-pill exed-pill-prop", eff.target || "(pick property)", (e) => {
      pickTarget(e.currentTarget as HTMLElement, undefined, (entry) => {
        commit(updateAt(effects, i, { target: refOf(entry, defaultScope), value: initialValueFor(entry, defaultScope).src }));
      });
    }, "change the target property");
    const targetEntry = opts.catalogue.find((e) => refOf(e, defaultScope) === eff.target);
    // The same affordances the pills inside values carry: the declaration's
    // purpose (and ladder) on hover, the host's menu on right-click. Left-click
    // stays the repick, which the fallback title still teaches.
    const tip = propertyTip(targetEntry);
    if (tip) targetBtn.title = tip;
    if (targetEntry && opts.propertyActions) {
      const actions = opts.propertyActions({ scope: targetEntry.scope, name: targetEntry.name });
      if (actions.length) targetBtn.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        closePopover();
        popover = openPopover(targetBtn, (close) => {
          const wrap = el("div", "exed-menu");
          for (const a of actions) wrap.append(button("exed-opt", a.label, () => { a.run(); close(); }));
          return wrap;
        }, { container: opts.popoverContainer });
      });
    }
    // A quality outcome reads as a sentence, not an assignment: `debt advances`, no `=`. The
    // collapse is decided here as well as in the renderer because the separator lives on this row.
    const advances = isSelfAdvance(eff, defaultScope, opts.dialect);
    row.append(targetBtn);
    if (!advances) row.append(el("span", "exed-effect-eq", ["="]));
    // Value — an inline pill editor; capture its edits WITHOUT a re-render (it owns its own DOM). The
    // "+ term" extension follows the target's declared type (arithmetic / logical / none).
    row.append(valueDisplay(eff.value, (src) => {
      const next = updateAt(effects, i, { value: src });
      // The value editor owns its DOM and normally updates without rebuilding the row - but the ROW's
      // shape follows the value here: `debt advances` drops the `=` and the explicit call. So when
      // that state flips (an advance edited into a named stage, or back) the row must be rebuilt, or
      // the separator and the value would disagree.
      if (isSelfAdvance(next[i]!, defaultScope, opts.dialect) !== advances) { commit(next); return; }
      effects = next; opts.onChange(effects);
    }, targetType(eff.target), advances ? eff.target : undefined));
    row.append(rowActions(i));
    return row;
  }

  function emitRow(eff: Extract<EditorEffect, { kind: "emit" }>, i: number): HTMLElement {
    const row = el("div", "exed-effect exed-effect-emit");
    const head = el("div", "exed-effect-head");
    head.append(el("span", "exed-effect-kw", ["emit"]));
    // The event name is free author text (a label for the host), not a defined dialect function -
    // so it reads as a STRING, not a function call.
    const eventBtn = button("exed-pill exed-pill-event", eff.event ? `"${eff.event}"` : "(name)", (e) => {
      editEvent(e.currentTarget as HTMLElement, eff.event, (name) => commit(updateAt(effects, i, { event: name })));
    }, "name the host event");
    head.append(eventBtn);
    head.append(rowActions(i));
    row.append(head);
    // Arguments — each its own value editor; "+ arg" / remove per slot.
    const args = el("div", "exed-effect-args");
    eff.args.forEach((a, ai) => {
      const slot = el("div", "exed-effect-arg");
      slot.append(valueDisplay(a, (src) => { effects = setArgAt(effects, i, ai, src); opts.onChange(effects); }));
      slot.append(iconBtn("✕", "remove argument", () => commit(removeArgAt(effects, i, ai)), true));
      args.append(slot);
    });
    args.append(button("exed-eff-add", "+ argument", (e) =>
      openValueWizard(e.currentTarget as HTMLElement, undefined, (src) => commit(addArg(effects, i, src)))));
    row.append(args);
    return row;
  }

  /** Event-name editor: a text field, optionally listing known events as quick picks. */
  const editEvent = (anchor: HTMLElement, current: string, onName: (name: string) => void): void => {
    closePopover();
    popover = openPopover(anchor, (close) => {
      const wrap = el("div", "exed-picker");
      const input = el("input", "exed-input");
      input.type = "text"; input.value = current; input.placeholder = "event name";
      const apply = (): void => { const v = input.value.trim(); if (v) onName(v); close(); };
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); apply(); } });
      wrap.append(input);
      for (const name of opts.events ?? []) {
        if (name === current) continue;
        wrap.append(button("exed-opt", name, () => { onName(name); close(); }));
      }
      wrap.append(button("exed-btn primary", "Apply", apply));
      setTimeout(() => input.focus(), 0);
      return wrap;
    }, { container: opts.popoverContainer });
  };

  const rowActions = (i: number): HTMLElement => {
    const acts = el("div", "exed-effect-acts");
    if (i > 0) acts.append(iconBtn("↑", "move up", () => commit(moveAt(effects, i, -1))));
    if (i < effects.length - 1) acts.append(iconBtn("↓", "move down", () => commit(moveAt(effects, i, 1))));
    acts.append(iconBtn("✕", "remove effect", () => commit(removeAt(effects, i)), true));
    return acts;
  };

  function render(): void {
    closePopover();
    for (const h of inner.splice(0)) h.destroy(); // tear down the previous value editors
    host.replaceChildren();

    const listEl = el("div", "exed-effect-list");
    if (!effects.length) listEl.append(el("div", "exed-effect-empty", ["No effects yet."]));
    effects.forEach((eff, i) => listEl.append(eff.kind === "set" ? setRow(eff, i) : emitRow(eff, i)));
    host.append(listEl);

    const bar = el("div", "exed-effect-addbar");
    bar.append(button("exed-eff-add", "+ set property", (e) => {
      const anchor = e.currentTarget as HTMLElement;
      // Pick the target property, then build its value with the guided wizard (type-aware).
      pickTarget(anchor, undefined, (entry) => {
        const { src, ask } = initialValueFor(entry, defaultScope);
        if (!ask) { commit(addSet(effects, refOf(entry, defaultScope), src)); return; }
        openValueWizard(anchor, entry, (chosen) => commit(addSet(effects, refOf(entry, defaultScope), chosen)));
      });
    }));
    // Emit needs a name first: open the event-name wizard immediately; only add the effect once named.
    // Hidden when the host opts out of emit (set-only effects, e.g. patter - emission rides on gameData).
    if (opts.allowEmit !== false) {
      bar.append(button("exed-eff-add", "+ emit event", (e) =>
        editEvent(e.currentTarget as HTMLElement, "", (name) => commit(addEmit(effects, name)))));
    }
    host.append(bar);
  }

  render();
  return {
    setValue: (next) => { effects = clone(next ?? []); render(); },
    // Flip every live inline value editor in place — keeps any open target/wizard popover alive.
    setText: (on) => { textMode = on; for (const h of inner) h.setText(on); },
    destroy: () => { closePopover(); for (const h of inner.splice(0)) h.destroy(); host.replaceChildren(); host.classList.remove("exed-root", "exed-effects-root"); },
  };
}
