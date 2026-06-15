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
  /** Free-text description; the picker search matches it alongside the name. */
  purpose?: string;
}

export interface Filter {
  acceptTypes?: PropertyType[];
  acceptScopes?: string[];
}

/** The reference string for an entry: `@name` for the default scope, else `@scope.name`. */
export const refOf = (e: { scope: string; name: string }, defaultScope: string): string =>
  e.scope === defaultScope ? `@${e.name}` : `@${e.scope}.${e.name}`;

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
