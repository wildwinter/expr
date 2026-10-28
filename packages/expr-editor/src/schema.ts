// ---------------------------------------------------------------------------
// The property catalogue the picker offers — a flat list of available properties
// (scope + name + type + optional enum values + a free-text "purpose" the search
// matches), plus filtering / grouping / ref-formatting helpers. The host builds
// the catalogue from its project (e.g. patter from buildSchema's properties).
// ---------------------------------------------------------------------------

import { isValidPropertyName, RESERVED_PROPERTY_NAMES, type ExpressionSchema, type PropertyType } from "@wildwinter/expr";

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

/** The label a property PILL shows. Without `homeScope`, as it always has: `gold` in the dialect's
 *  default scope, `world.time` in any other. With it (the host's own scope, such as Patterpad's
 *  `patter`), every reference reads the way an author writes one: `@gold` in that scope, and
 *  `@world.time` in full elsewhere. Display only: the source keeps whatever form it was written in. */
export const pillLabel = (e: { scope: string; name: string }, defaultScope: string, homeScope?: string): string =>
  homeScope === undefined ? displayName(e, defaultScope)
    : e.scope === homeScope ? `@${e.name}` : `@${e.scope}.${e.name}`;

/** The label a set row's TARGET pill shows. Without `homeScope`, the target exactly as written
 *  (`@patter.gold`, since targets are always written in full); with it, the same label a pill in the
 *  value shows, so `@patter.gold = @gold + 1` reads `@gold = @gold + 1`. A bare `@name` (an older
 *  save) is in the default scope; anything that is not a ref is shown as written. */
export function targetLabel(target: string, defaultScope: string, homeScope?: string): string {
  if (homeScope === undefined) return target;
  const m = /^@(?:([^.\s]+)\.)?([^.\s]+)$/.exec(target.trim());
  return m ? pillLabel({ scope: m[1] ?? defaultScope, name: m[2]! }, defaultScope, homeScope) : target;
}

/** What a picker's search text says about a NEW property: the name it would have and the scopes it
 *  could go in, or why it can't be one. `null` for empty text (nothing to offer or explain).
 *
 *  A leading `@` is allowed, and `scope.name` (or `@scope.name`) names the scope, which must be one of
 *  `scopes`. The name is folded to lower case, as every reference is, and must then be a name the
 *  expression language can hold (`isValidPropertyName`): letters, digits and `_`, not starting with
 *  a digit, not a keyword. */
export function newPropertyName(
  text: string, scopes: readonly string[],
): { name: string; scopes: string[] } | { why: string } | null {
  let t = text.trim();
  if (t.startsWith("@")) t = t.slice(1);
  if (!t) return null;
  let only: string | undefined;
  const dot = t.indexOf(".");
  if (dot !== -1) {
    only = t.slice(0, dot);
    t = t.slice(dot + 1);
    if (!scopes.includes(only)) {
      return { why: scopes.length
        ? `A new property can go in ${orList(scopes)}, not ${only}.`
        : "New properties can't be added here." };
    }
    if (!t) return null;
  }
  const name = t.toLowerCase();
  if (!isValidPropertyName(name)) {
    if (/[^a-z0-9_]/.test(name)) return { why: "A property name takes only letters, digits, and _." };
    if (/^[0-9]/.test(name)) return { why: "A property name can't start with a digit." };
    if (RESERVED_PROPERTY_NAMES.includes(name)) return { why: `"${name}" is a reserved word, so it can't be a property name.` };
    return { why: "That can't be a property name." };
  }
  return { name, scopes: only !== undefined ? [only] : [...scopes] };
}

/** `a`, `a or b`, `a, b, or c` (Oxford comma). */
const orList = (xs: readonly string[]): string =>
  xs.length <= 2 ? xs.join(" or ") : `${xs.slice(0, -1).join(", ")}, or ${xs[xs.length - 1]}`;

/** `schema` with `entry` declared in it, for validating values that name a property created since
 *  the schema was built. The host's schema is never changed: a copy is returned when the entry is
 *  new, and the schema itself when it already declares it or doesn't list its scope. */
export function schemaWith(schema: ExpressionSchema, entry: CatalogueEntry): ExpressionSchema {
  const name = entry.name.toLowerCase();
  const declared = schema.properties.get(entry.scope);
  // A scope the schema doesn't list is unchecked already; listing it now would turn every other
  // reference into it into an unknown property.
  if (!declared || declared.has(name)) return schema;
  const properties = new Map(schema.properties);
  const scope = new Map(declared);
  scope.set(name, {
    type: entry.type,
    ...(entry.enumValues ? { enumValues: entry.enumValues } : {}),
    ...(entry.stages ? { stages: entry.stages } : {}),
  });
  properties.set(entry.scope, scope);
  return { ...schema, properties };
}

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

/** The tip on a pill naming another engine's property (see `otherEngineScopes`). */
export function otherEngineTip(label: string): string {
  return `${label} belongs to another engine, which checks it`;
}

/** What a property pill says about itself: an issue when the catalogue does not know it, unless its
 *  scope is another engine's (that engine checks it), and the tip on hover. */
export function propertyPillNote(
  entry: CatalogueEntry | null | undefined, scope: string, label: string, otherEngineScopes?: readonly string[],
): { issue?: string; title?: string } {
  if (entry) { const title = propertyTip(entry); return title ? { title } : {}; }
  if (otherEngineScopes?.includes(scope)) return { title: otherEngineTip(label) };
  return { issue: `Unknown property ${label}` };
}

/** The scope of a written reference (`@patter.gold` -> "patter"), or undefined for a bare `@name`. */
export function scopeOfRef(ref: string): string | undefined {
  return /^@([^.\s]+)\./.exec(ref)?.[1];
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
