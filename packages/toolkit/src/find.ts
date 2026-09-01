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
