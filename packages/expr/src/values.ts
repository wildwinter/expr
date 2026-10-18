// ---------------------------------------------------------------------------
// Does a value fit its declaration?
//
// Every place a typed value is held outside an expression asks it: a compiler
// checking a field's value or a given default, a load checking a save written
// against an older build (a stage, an enum value or a flag since deleted). Both
// product families had written it, Storylets twice in its compiler and once in
// its engine, with the vocabulary rule disagreeing between the copies. It is a
// fact about the family's types, so it lives here, beside the ladder helpers.
//
// Design: patterkit design/proposals/patter-qualities.md, sections 1 and 7.
// ---------------------------------------------------------------------------

/** A declaration as this check reads it: a property's, a field's or a game-data
 *  field's. `type` is the family's word (`text`, `multiline`, `number`,
 *  `boolean`, `enum`, `flags`, `quality`, and a property's `string`). */
export interface ValueDecl {
  readonly type: string;
  /** An enum's values, or the flags a flags value may hold. */
  readonly values?: readonly string[];
  /** A quality's ladder. */
  readonly stages?: readonly string[];
}

export interface ValueFitsOptions {
  /** An enum may hold `""`, none chosen: an editor writes that for "(none)".
   *  Only an enum; a quality is always on a stage. */
  readonly noneChosen?: boolean;
}

/**
 * Whether `value` fits `decl`: the type first, then the declaration's own
 * vocabulary. An enum value or a stage that is no longer listed is still a
 * string, and still no longer a legal value. A declaration that lists no
 * vocabulary (`values` or `stages` absent, or not a list: a declaration read
 * from JSON as it came) constrains nothing past the type, as in every port.
 *
 * A type this build does not know constrains nothing: a newer build's
 * declaration is the compiler's to report, not a reason to throw a value away.
 */
export function valueFits(decl: ValueDecl, value: unknown, opts?: ValueFitsOptions): boolean {
  switch (decl.type) {
    case "boolean": return typeof value === "boolean";
    case "number": return typeof value === "number";
    case "string":
    case "text":
    case "multiline": return typeof value === "string";
    case "enum":
      if (typeof value !== "string") return false;
      if (value === "" && opts?.noneChosen) return true;
      return !Array.isArray(decl.values) || decl.values.includes(value);
    case "flags":
      return Array.isArray(value)
        && value.every((f) => typeof f === "string" && (!Array.isArray(decl.values) || decl.values.includes(f)));
    case "quality":
      return typeof value === "string" && (!Array.isArray(decl.stages) || decl.stages.includes(value));
    default: return true;
  }
}
