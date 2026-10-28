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
import { el, button, openPopover, type Popover, propertyMenuBody } from "./dom.js";
import {
  type CatalogueEntry, type PropertyType,
  filterCatalogue, searchCatalogue, groupByScope, displayName, refOf, targetRefOf,
  choicesOf, propertyTip, otherEngineTip, scopeOfRef, targetLabel, newPropertyName, schemaWith, lookup,
} from "./schema.js";
import type { FunctionTemplateSpec, StringArgChoices } from "./types.js";
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

/** The catalogue entry a `set` target names. Normalised, so read-back tolerates
 *  BOTH spellings: the qualified form targets are written in now, and the
 *  default-scope shorthand an older build saved. */
export function entryForTarget(
  catalogue: readonly CatalogueEntry[], target: string, defaultScope: string,
): CatalogueEntry | undefined {
  const want = normaliseRef(target, defaultScope);
  return catalogue.find((e) => normaliseRef(`@${e.scope}.${e.name}`, defaultScope) === want);
}

export { flagChangeSrc } from "./ast.js";

export interface EffectsEditorOptions {
  /** The current effect list (edited in place via onChange). */
  effects: EditorEffect[];
  schema: ExpressionSchema;
  dialect: Dialect;
  /** Properties the target picker + value editors offer. */
  catalogue: CatalogueEntry[];
  scopeOrder?: string[];
  /** Scopes another engine owns (a product family's shared vocabulary, such as `patter` in a
   *  Storylets card): the catalogue never lists their names, and the other engine checks them, so a
   *  reference into one renders as an ordinary property pill instead of an unknown one. */
  otherEngineScopes?: readonly string[];
  /** Dialect clause templates passed through to each value editor. */
  functions?: FunctionTemplateSpec[];
  /** Choices for a function's first string argument, threaded to every inline value editor (see
   *  ExpressionEditorOptions.stringArgChoices). */
  stringArgChoices?: StringArgChoices;
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
  /** The host's own scope (Patterpad's `patter`): pills, targets included, show `@gold` for a
   *  property in it and `@world.time` in full for any other. Display only (see
   *  ExpressionEditorOptions.homeScope); targets are still written `@patter.gold`. */
  homeScope?: string;
  /** Lets the "+ set property" picker create a property. Search text no property in a scope has, and
   *  which is a legal name, offers `+ New property "<name>"` (with the scope it goes in); choosing it
   *  calls this with the name (lower case) and that scope. The host creates the declaration, picking
   *  its type or asking the author, and returns it as a catalogue entry, or null to cancel. The new
   *  property then goes straight on to its value, as a listed one does. Absent, nothing is offered. */
  onCreateProperty?: (name: string, scope: string) => Promise<CatalogueEntry | null> | CatalogueEntry | null;
  /** The scopes a new property can go in, in the order offered (default: the dialect's default
   *  scope). Typing `scope.name` picks one; otherwise each is offered. Another engine's scopes are
   *  never offered. Only read with `onCreateProperty`. */
  newPropertyScopes?: readonly string[];
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

/** What the picker says when the host's `onCreateProperty` throws or rejects. */
const createFailure = (err: unknown): string => {
  const msg = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  return msg ? `Couldn't create the property: ${msg}` : "Couldn't create the property.";
};

// --- mount -----------------------------------------------------------------

export function mountEffectsEditor(host: HTMLElement, opts: EffectsEditorOptions): EffectsEditorHandle {
  const defaultScope = opts.dialect.defaultScope;
  let effects = clone(opts.effects ?? []);
  let textMode = opts.text ?? false; // raw-text view for every inline value editor (host-driven)
  let popover: Popover | null = null;
  const inner: ExpressionEditorHandle[] = []; // inline value / arg editors, destroyed on re-render
  // The host's catalogue and schema, plus any property created from the picker since mounting, so a
  // new property's target and value pills know it before the host next re-mounts. Never mutated:
  // replaced with a copy that adds the entry.
  let catalogue = opts.catalogue;
  let schema = opts.schema;
  let destroyed = false;
  const newScopes = (opts.newPropertyScopes ?? [defaultScope]).filter((s) => !opts.otherEngineScopes?.includes(s));
  host.classList.add("exed-root", "exed-effects-root");

  const closePopover = (): void => { popover?.close(); popover = null; };
  const commit = (next: EditorEffect[]): void => { effects = clone(next); opts.onChange(effects); render(); };

  /** Open the guided value wizard anchored to `anchor`; commit its built source. */
  const openValueWizard = (anchor: HTMLElement, expected: CatalogueEntry | undefined, onCommit: (src: string) => void): void => {
    closePopover();
    popover = openPopover(anchor, (close) => valueWizard({
      catalogue, scopeOrder: opts.scopeOrder ?? [], defaultScope,
      ...(expected?.type ? { expectedType: expected.type } : {}),
      // choicesOf, never a raw field: a quality's ladder lives in `stages`, and reading `enumValues`
      // here told the wizard the type and withheld the values.
      ...(choicesOf(expected) ? { expectedChoices: choicesOf(expected) } : {}),
      // The flags step needs the target itself: its declared flags, and the
      // qualified ref its set_flags(...) is written against. choicesOf stays
      // out of it deliberately - flags are not a pick-one list, and a pinned
      // test holds it to that.
      ...(expected?.type === "flags" ? { expectedRef: targetRefOf(expected), expectedFlags: expected.enumValues ?? [] } : {}),
      // Change by needs the same: the ref its `<ref> + n` is written against.
      ...(expected?.type === "number" ? { expectedRef: targetRefOf(expected) } : {}),
      onCommit: (src) => { onCommit(src); close(); },
      onCancel: close,
    }), { container: opts.popoverContainer });
  };

  /** The declared type of a `set` target (resolved from the catalogue by its ref), so the value editor
   *  offers the right "+ term" extension (arithmetic for numbers, logical for booleans, none else). */
  const targetType = (target: string): PropertyType | undefined =>
    entryForTarget(catalogue, target, defaultScope)?.type;

  /** The committed value as an INLINE editable pill editor (click pills to edit; "+ term" to extend) -
   *  the storylets ExpressionField model. The initial value is picked via the wizard; this edits it.
   *  `addTerm` is type-led: numbers extend arithmetically, booleans logically, others not at all. */
  const valueDisplay = (value: string, onChange: (src: string) => void, type?: PropertyType,
    selfAdvanceRef?: string): HTMLElement => {
    const sub = el("div", "exed-effect-value");
    const addTerm = type === "number" ? "arithmetic" : type === "boolean" ? "boolean" : undefined;
    inner.push(mountExpressionEditor(sub, {
      value, schema, dialect: opts.dialect, catalogue,
      scopeOrder: opts.scopeOrder, functions: opts.functions, mode: "flat",
      ...(opts.otherEngineScopes ? { otherEngineScopes: opts.otherEngineScopes } : {}),
      ...(opts.stringArgChoices ? { stringArgChoices: opts.stringArgChoices } : {}),
      ...(opts.homeScope !== undefined ? { homeScope: opts.homeScope } : {}),
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

  /** Take a property the host has just created into this editor's own catalogue and schema, so its
   *  pills resolve before the host re-mounts. The host's entry wins if it already listed it. */
  const adopt = (entry: CatalogueEntry): CatalogueEntry => {
    const known = lookup(catalogue, entry.scope, entry.name);
    if (known) return known;
    catalogue = [...catalogue, entry];
    schema = schemaWith(schema, entry);
    return entry;
  };

  /** The picker's "+ New property" rows (or why the search text can't be one), when the host can
   *  create properties. A scope that already has the name lists it above instead. */
  const createRows = (query: string, hasMatches: boolean, onCreated: (e: CatalogueEntry) => void,
    close: () => void): HTMLElement[] => {
    if (!opts.onCreateProperty || !newScopes.length) return [];
    const parsed = newPropertyName(query, newScopes);
    if (!parsed) return [];
    // A search that matched something is a search, not a failed name: only explain when nothing did.
    if ("why" in parsed) return hasMatches ? [] : [el("div", "exed-hint exed-create-why", [parsed.why])];
    const rows: HTMLElement[] = [];
    for (const scope of parsed.scopes) {
      if (lookup(catalogue, scope, parsed.name)) continue;
      const row = button("exed-opt exed-opt-create", "", () => {
        if (row.disabled) return;
        row.disabled = true;
        row.classList.add("busy");
        const fail = (msg?: string): void => {
          row.disabled = false;
          row.classList.remove("busy");
          if (msg) row.after(el("div", "exed-hint exed-create-why", [msg]));
        };
        const done = (entry: CatalogueEntry | null): void => {
          if (destroyed) return;
          if (!entry) { fail(); return; }
          close();
          onCreated(adopt(entry));
        };
        let result: Promise<CatalogueEntry | null> | CatalogueEntry | null;
        try { result = opts.onCreateProperty!(parsed.name, scope); } catch (err) { fail(createFailure(err)); return; }
        if (result && typeof (result as Promise<unknown>).then === "function") {
          (result as Promise<CatalogueEntry | null>).then(done, (err) => { if (!destroyed) fail(createFailure(err)); });
        } else done(result as CatalogueEntry | null);
      });
      row.append(
        el("span", "exed-opt-name", [`+ New property "${parsed.name}"`]),
        el("span", "exed-opt-type", [`in ${scope}`]),
      );
      rows.push(row);
    }
    return rows;
  };

  /** The target-property picker popover (reuses the catalogue helpers). */
  const pickTarget = (anchor: HTMLElement, accept: PropertyType[] | undefined, onPick: (e: CatalogueEntry) => void): void => {
    closePopover();
    popover = openPopover(anchor, (close) => {
      const wrap = el("div", "exed-picker");
      const search = el("input", "exed-input");
      search.type = "text";
      search.placeholder = opts.onCreateProperty && newScopes.length ? "Search or name a new property…" : "Search properties…";
      const list = el("div", "exed-picker-list");
      const pool = filterCatalogue(catalogue, { acceptTypes: accept });
      const draw = (): void => {
        list.replaceChildren();
        // `@gold` searches as `gold`: the picker lists names, and an author may well type the sigil.
        const query = search.value.trim().replace(/^@/, "");
        const groups = groupByScope(searchCatalogue(pool, query, defaultScope), opts.scopeOrder ?? []);
        const create = createRows(search.value, groups.length > 0, onPick, close);
        if (!groups.length && !create.some((r) => r.tagName === "BUTTON")) list.append(el("div", "exed-hint", ["No matching properties."]));
        for (const g of groups) {
          list.append(el("div", "exed-picker-scope", [g.scope]));
          for (const e of g.entries) {
            const row = button("exed-opt", "", () => { onPick(e); close(); });
            row.append(el("span", "exed-opt-name", [displayName(e, defaultScope)]), el("span", "exed-opt-type", [e.type]));
            if (e.purpose) row.append(el("span", "exed-opt-purpose", [e.purpose]));
            list.append(row);
          }
        }
        list.append(...create);
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
    const targetBtn = button("exed-pill exed-pill-prop", eff.target ? targetLabel(eff.target, defaultScope, opts.homeScope) : "(pick property)", (e) => {
      pickTarget(e.currentTarget as HTMLElement, undefined, (entry) => {
        commit(updateAt(effects, i, { target: targetRefOf(entry), value: initialValueFor(entry, defaultScope).src }));
      });
    }, "change the target property");
    const targetEntry = entryForTarget(catalogue, eff.target, defaultScope);
    // The same affordances the pills inside values carry: the declaration's
    // purpose (and ladder) on hover, the host's menu on right-click. Left-click
    // stays the repick, which the fallback title still teaches.
    const targetScope = targetEntry ? undefined : scopeOfRef(eff.target);
    const tip = targetScope !== undefined && opts.otherEngineScopes?.includes(targetScope)
      ? otherEngineTip(eff.target) : propertyTip(targetEntry);
    if (tip) targetBtn.title = tip;
    if (targetEntry && opts.propertyActions) {
      const actions = opts.propertyActions({ scope: targetEntry.scope, name: targetEntry.name });
      if (actions.length) targetBtn.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        closePopover();
        popover = openPopover(targetBtn, (close) => propertyMenuBody(actions, close), { container: opts.popoverContainer });
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
        if (!ask) { commit(addSet(effects, targetRefOf(entry), src)); return; }
        openValueWizard(anchor, entry, (chosen) => commit(addSet(effects, targetRefOf(entry), chosen)));
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
    destroy: () => { destroyed = true; closePopover(); for (const h of inner.splice(0)) h.destroy(); host.replaceChildren(); host.classList.remove("exed-root", "exed-effects-root"); },
  };
}
