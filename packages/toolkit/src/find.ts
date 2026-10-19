// ---------------------------------------------------------------------------
// Find and replace over authored text.
// ---------------------------------------------------------------------------

export interface FindOptions {
  query: string;
  caseSensitive?: boolean;
  wholeWord?: boolean;
}

/**
 * Build the find matcher, or null for an empty query. Global, so every
 * occurrence in a string is replaced rather than only the first.
 *
 * The query is escaped: a person typing `a.b` means those three characters, not
 * "a, anything, b".
 */
export function findMatcher(opts: FindOptions): RegExp | null {
  if (!opts.query) return null;
  const esc = opts.query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const body = opts.wholeWord ? `\\b${esc}\\b` : esc;
  return new RegExp(body, opts.caseSensitive ? "g" : "gi");
}

// ---------------------------------------------------------------------------
// Find by field value: the Field tab of both families' Find windows
// (patterkit design/family-parity-2026-10.md item 16). Each app walks its own
// project for the values (Storylets' card and outcome fields, Patter's
// gameData) and asks these two what a query means, so `mood = tense` reads the
// same in both.
// ---------------------------------------------------------------------------

/** A parsed Field query: a field, and optionally a value it must (`=`) or must
 *  not (`!=`) hold. With no `op` the query lists every value of the field. */
export interface FieldQuery {
  /** As typed, folded to lower case: `mood`, or `extension.field`. */
  field: string;
  op?: "=" | "!=";
  /** As typed, trimmed, one pair of surrounding quotes taken off. May be `""`
   *  (`mood =` asks for the field left empty). */
  value?: string;
}

/**
 * `mood`, `mood = tense`, `mood != tense`, `ext.field = "two words"`. Null when
 * the text before the operator is not a field name (a letter or `_`, then
 * letters, digits, `_` or `-`; up to three of those joined by dots).
 */
export function parseFieldQuery(query: string): FieldQuery | null {
  const m = /^\s*([a-z_][\w-]*(?:\.[a-z_][\w-]*){0,2})\s*(?:(!=|=)\s*(.*?))?\s*$/i.exec(query);
  if (!m) return null;
  const field = m[1]!.toLowerCase();
  if (m[2] === undefined) return { field };
  let value = m[3]!;
  const q = /^(["'])(.*)\1$/.exec(value);
  if (q) value = q[2]!;
  return { field, op: m[2] as "=" | "!=", value };
}

/** Does this field name answer the query's? Names compare without case. */
export const fieldNameMatches = (name: string, query: FieldQuery): boolean => name.toLowerCase() === query.field;

/**
 * Does a field's value satisfy the query, read by its type (the family's list:
 * text, multiline, number, boolean, enum, flags, quality; `string` is text)?
 * Pass the value that HOLDS: the default when the node sets none, so
 * `mood = calm` finds the cards that leave a calm mood alone.
 *
 * - text, multiline, enum, quality, and any type this does not know: equal,
 *   ignoring case and the ends' whitespace
 * - flags: the list includes that flag (`= ""` is no flags set)
 * - number: numerically equal (`= 1.0` finds 1)
 * - boolean: `true` or `false`, ignoring case
 *
 * `!=` is the opposite of `=`. A query with no operator matches any value.
 */
export function fieldValueMatches(type: string, value: unknown, query: FieldQuery): boolean {
  if (query.op === undefined || query.value === undefined) return true;
  const holds = valueIs(type, value, query.value);
  return query.op === "=" ? holds : !holds;
}

function valueIs(type: string, value: unknown, wanted: string): boolean {
  const want = wanted.trim().toLowerCase();
  if (type === "flags") {
    const flags = Array.isArray(value) ? value.map((f) => String(f).toLowerCase()) : [];
    return want === "" ? flags.length === 0 : flags.includes(want);
  }
  if (type === "number") {
    if (want === "") return value === undefined || value === null || value === "";
    const n = Number(want);
    return !Number.isNaN(n) && typeof value === "number" && value === n;
  }
  if (type === "boolean") return (value === true && want === "true") || (value === false && want === "false");
  return fieldValueText(type, value).trim().toLowerCase() === want;
}

/** A field's value as a row shows it: flags joined with commas, everything
 *  else as written, nothing for no value. */
export function fieldValueText(type: string, value: unknown): string {
  if (value === undefined || value === null) return "";
  if (type === "flags" && Array.isArray(value)) return value.join(", ");
  return typeof value === "string" ? value : JSON.stringify(value);
}
