// ---------------------------------------------------------------------------
// Pools: the values a pick with a `{ "pool": name }` source has been given, across a project. A pool takes any
// text, and every field naming the same pool, in the same extension, shares its values as suggestions: the
// points of interest a writer has typed on other lines, say. The host walks its data with `addPoolValues`,
// offers `poolValues` to a pick (`PickSources.pool`), and reports `poolNearDuplicates`.
// ---------------------------------------------------------------------------

import type { FieldDecl, Problem, TargetDecl, TypeDecl } from "./types.js";

/** Each pool's values, by pool name, with how many times each is used. */
export type PoolCounts = Map<string, Map<string, number>>;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The pools a pick names, when it names any. */
function poolsOf(decl: TypeDecl): string[] {
  return decl.type === "pick" ? (decl.from ?? []).flatMap((s) => ("pool" in s && typeof s.pool === "string" ? [s.pool] : [])) : [];
}

/** Whether a declaration names a pool anywhere inside it: a walk can skip what doesn't. */
function hasPool(decl: TypeDecl): boolean {
  return poolsOf(decl).length > 0 || (decl.fields ?? []).some(hasPool) || (decl.of !== undefined && hasPool(decl.of));
}

function addValue(decl: TypeDecl, value: unknown, counts: PoolCounts): void {
  if (decl.type === "pick") {
    if (typeof value !== "string" || value === "") return;
    for (const pool of poolsOf(decl)) {
      const byValue = counts.get(pool) ?? new Map<string, number>();
      byValue.set(value, (byValue.get(value) ?? 0) + 1);
      counts.set(pool, byValue);
    }
    return;
  }
  if (decl.type === "record" && isObject(value)) { addFields(decl.fields ?? [], value, counts); return; }
  if (decl.of === undefined || !hasPool(decl.of)) return;
  if (decl.type === "list" && Array.isArray(value)) for (const item of value) addValue(decl.of, item, counts);
  if (decl.type === "map" && isObject(value)) for (const item of Object.values(value)) addValue(decl.of, item, counts);
}

function addFields(fields: readonly FieldDecl[], entry: Record<string, unknown>, counts: PoolCounts): void {
  for (const f of fields) if (hasPool(f) && f.name in entry) addValue(f, entry[f.name], counts);
}

/**
 * Add one node's entry to the counts: every value a field naming a pool holds, however deep (in a record, a
 * list, or a map's values). A value is counted once per use; one that isn't text, or is empty, isn't counted.
 * Call it for every entry of one extension, the project's own among them, with one `PoolCounts` per extension.
 */
export function addPoolValues(target: TargetDecl | undefined, entry: unknown, counts: PoolCounts): PoolCounts {
  if (target !== undefined && isObject(entry)) addFields(target.fields ?? [], entry, counts);
  return counts;
}

/** A pool's values in the order to offer them: the commonest first, then alphabetically, case ignored. */
export function poolValues(counts: PoolCounts, pool: string): string[] {
  const byValue = counts.get(pool);
  if (byValue === undefined) return [];
  return [...byValue].sort(([a, n], [b, m]) => m - n || a.localeCompare(b, undefined, { sensitivity: "base" }) || (a < b ? -1 : 1)).map(([v]) => v);
}

/** What two values that mean the same name share: letters and digits only, in lower case. */
const nearKey = (value: string): string => value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

const uses = (n: number): string => `${n} use${n === 1 ? "" : "s"}`;

/**
 * A warning for each set of a pool's values that differ only in case, spaces, or punctuation ("The gate", "the
 * gate", "the-gate"): most likely one name typed two ways, which a game looking names up would treat as two.
 * The values are named in the message, commonest first, with their uses, and in `options`; the path is "".
 */
export function poolNearDuplicates(counts: PoolCounts): Problem[] {
  const out: Problem[] = [];
  for (const pool of [...counts.keys()].sort()) {
    const groups = new Map<string, string[]>();
    for (const v of poolValues(counts, pool)) {
      const key = nearKey(v);
      if (key === "") continue;
      groups.set(key, [...(groups.get(key) ?? []), v]);
    }
    for (const values of groups.values()) {
      if (values.length < 2) continue;
      const byValue = counts.get(pool)!;
      out.push({
        severity: "warning", code: "pool-near-duplicate", path: "", options: values,
        message: `the pool "${pool}" has ${values.map((v) => `"${v}" (${uses(byValue.get(v)!)})`).join(" and ")}, which differ only in case, spaces, or punctuation`,
      });
    }
  }
  return out;
}
