// ---------------------------------------------------------------------------
// The property catalogue the picker offers — a flat list of available properties
// (scope + name + type + optional enum values + a free-text "purpose" the search
// matches), plus filtering / grouping / ref-formatting helpers. The host builds
// the catalogue from its project (e.g. patter from buildSchema's properties).
// ---------------------------------------------------------------------------

import type { PropertyType } from "@wildwinter/expr";

export type { PropertyType } from "@wildwinter/expr";

export interface CatalogueEntry {
  scope: string;
  /** Property name (stored lowercased to match parsed scopedvar names). */
  name: string;
  type: PropertyType;
  enumValues?: string[];
  /** A quality's ORDERED stage ladder. Separate from `enumValues` because the order carries meaning
   *  here (comparisons are positional, `advance()` walks it) - a host that smuggled stages through
   *  `enumValues` got a value picker but no ordering affordances. */
  stages?: string[];
  /** Free-text description; the picker search matches it alongside the name. */
  purpose?: string;
}

/** The CLOSED set of values a property can hold, when it has one: a quality's stages (in ladder
 *  order) or an enum's values. Everything that offers "pick a value" for a property goes through
 *  this, so a quality is never mistaken for free text. `stages` falls back to `enumValues` for a
 *  host still passing a quality's ladder the old way. */
export const choicesOf = (e: { type: PropertyType; enumValues?: string[]; stages?: string[] } | null | undefined): string[] | undefined => {
  if (!e) return undefined;
  if (e.type === "quality") return e.stages?.length ? e.stages : e.enumValues;
  if (e.type === "enum") return e.enumValues;
  return undefined;
};

/** What a property PILL says on rollover: the purpose, and for a quality its
 *  ladder (the one thing about a property whose order matters and which the
 *  use site cannot otherwise show). The picker already displays purposes; this
 *  is for the place an author actually meets a property, mid-expression.
 *  Pure, so hosts and tests share one answer; the pill wires it as its title. */
export const propertyTip = (e: { type: PropertyType; purpose?: string; stages?: string[] } | null | undefined): string | undefined => {
  if (!e) return undefined;
  const lines: string[] = [];
  if (e.purpose) lines.push(e.purpose);
  if (e.type === "quality" && e.stages?.length) lines.push(`Stages: ${e.stages.join(" \u2192 ")}`);
  return lines.length ? lines.join("\n") : undefined;
};

export interface Filter {
  acceptTypes?: PropertyType[];
  acceptScopes?: string[];
}

/** The reference string for an entry: `@name` for the default scope, else `@scope.name`.
 *  CONDITION-side sugar only: a change TARGET must use {@link targetRefOf} - the storylets
 *  compiler requires `@scope.name` there, and emitting this shorthand for a default-scope
 *  target made every picker-authored change invalid (the Storyletter antagonist audit's
 *  find, 2026-08-29). Patter's grammar takes both forms, so the split costs it nothing. */
export const refOf = (e: { scope: string; name: string }, defaultScope: string): string =>
  e.scope === defaultScope ? `@${e.name}` : `@${e.scope}.${e.name}`;

/** The reference a change TARGET is written as: always fully qualified. A target is a
 *  reference, not an expression, and the shorthand is condition-side sugar (see refOf). */
export const targetRefOf = (e: { scope: string; name: string }): string =>
  `@${e.scope}.${e.name}`;

/** The label shown in the picker / on a property pill. */
export const displayName = (e: { scope: string; name: string }, defaultScope: string): string =>
  e.scope === defaultScope ? e.name : `${e.scope}.${e.name}`;

export function filterCatalogue(entries: readonly CatalogueEntry[], filter: Filter = {}): CatalogueEntry[] {
  return entries.filter(
    (e) => (!filter.acceptTypes || filter.acceptTypes.includes(e.type)) &&
           (!filter.acceptScopes || filter.acceptScopes.includes(e.scope)),
  );
}

/** Filter by a case-insensitive query against the display name AND the purpose text. */
export function searchCatalogue(entries: readonly CatalogueEntry[], query: string, defaultScope: string): CatalogueEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...entries];
  return entries.filter((e) =>
    displayName(e, defaultScope).toLowerCase().includes(q) || (e.purpose ?? "").toLowerCase().includes(q));
}

/** Group entries by scope, scopes in `scopeOrder` first (then alphabetical), names sorted within. */
export function groupByScope(entries: readonly CatalogueEntry[], scopeOrder: string[] = []): Array<{ scope: string; entries: CatalogueEntry[] }> {
  const byScope = new Map<string, CatalogueEntry[]>();
  for (const e of entries) {
    const list = byScope.get(e.scope) ?? [];
    list.push(e);
    byScope.set(e.scope, list);
  }
  const rank = (s: string): number => { const i = scopeOrder.indexOf(s); return i === -1 ? scopeOrder.length : i; };
  return [...byScope.keys()]
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .map((scope) => ({ scope, entries: byScope.get(scope)!.slice().sort((a, b) => a.name.localeCompare(b.name)) }));
}

/** Find an entry by scope + name (name compared case-insensitively). */
export function lookup(entries: readonly CatalogueEntry[], scope: string, name: string): CatalogueEntry | null {
  const n = name.toLowerCase();
  return entries.find((e) => e.scope === scope && e.name.toLowerCase() === n) ?? null;
}
