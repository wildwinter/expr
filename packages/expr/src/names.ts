// ---------------------------------------------------------------------------
// Turning a human label into a name the expression language can hold.
//
// A host that lets people type "Torin's Offer?" and stores it as a property has
// to answer: what is that called in an expression? Both product families
// answered identically, in their own `model` package, along with a hand-written
// copy of this language's keyword list. Neither is theirs: the rules here are
// facts about what `@name` can be, so they belong with the parser that decides.
// ---------------------------------------------------------------------------

import { KEYWORD_NAMES } from "./parser.js";

/**
 * Names a property may not take, because the tokeniser reads them as something
 * else. Derived from the parser's own keyword table, so it cannot go stale.
 */
export const RESERVED_PROPERTY_NAMES: readonly string[] = KEYWORD_NAMES;

/**
 * Coerce a label into a legal property name: lower case, apostrophes dropped,
 * runs of anything else to a single underscore, no trailing underscore, an
 * underscore in front of a leading digit, one behind a keyword. `""` when
 * nothing usable was left.
 */
export function propertyNameify(text: string): string {
  const trimmed = text.trim();
  // An underscore the author typed is kept; one that is only the ghost of
  // leading punctuation is not. That is the difference between `_private` and
  // `!gold`.
  const deliberateLeading = trimmed.startsWith("_");
  let out = trimmed.toLowerCase().replace(/['’]/g, "")
    .replace(/[^a-z0-9_]+/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "");
  if (out === "") return "";
  if (deliberateLeading || /^[0-9]/.test(out)) out = `_${out}`;
  if (RESERVED_PROPERTY_NAMES.includes(out)) out = `${out}_`;
  return out;
}

/**
 * Is this a name an expression can actually reach? Lower case letters, digits
 * and underscores, not starting with a digit, not a keyword. `""` is not a name.
 */
export function isValidPropertyName(name: string): boolean {
  return /^[a-z_][a-z0-9_]*$/.test(name) && !RESERVED_PROPERTY_NAMES.includes(name);
}

/**
 * True when folding case ALONE would make it legal (`isNight`). The only
 * violation a loader may repair without guessing at intent: every reference is
 * folded already, so folding the declaration to match changes nothing
 * observable.
 */
export function isCaseOnlyPropertyName(name: string): boolean {
  return !isValidPropertyName(name) && isValidPropertyName(name.toLowerCase());
}
