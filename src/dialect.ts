// ---------------------------------------------------------------------------
// Dialect - the injected configuration that makes the agnostic core concrete.
//
// The parser and evaluator are dialect-agnostic; a Dialect supplies:
//   - the valid scope tokens (and their missing-property policy),
//   - the default scope for bare `@name`,
//   - the built-in function set (names, arity, return type, evaluation).
//
// Storylet Studio is one Dialect; Patter is another. Same core, two configs.
// ---------------------------------------------------------------------------

import type { ExprNode, ScalarValue } from "./ast.js";
import type { ValidateHelpers } from "./validate.js";

/** Coarse return-type tag, used by static validation to type-check operands. */
export type ReturnType = "boolean" | "number" | "string" | "flags" | "unknown";

export interface ScopeDef {
  /** The scope token, e.g. "world" / "scene" / "flow". */
  token: string;
  /**
   * Policy when a property is missing from a *present* scope:
   *   "false" - resolve to false (graceful; the default).
   *   "throw" - raise an EvalError (for scopes where a missing key is a bug
   *             that publish-time validation is meant to have caught).
   * A scope that is entirely absent from the EvalContext always resolves to
   * false, regardless of this policy.
   */
  missing?: "false" | "throw";
}

export interface EvalContext {
  /**
   * Property values per scope token. Keys are lowercase property names. A scope
   * absent from this map resolves to false (graceful) for any reference.
   */
  scopes: Record<string, Record<string, ScalarValue> | undefined>;
  /**
   * Arbitrary host callbacks/values a Dialect's functions read at eval time
   * (e.g. a PRNG, tag lookups). The core never inspects this; the Dialect's
   * `eval` functions cast and read what they need.
   */
  host?: Record<string, unknown>;
}

export interface EvalHelpers {
  /** Evaluate a child node (for functions to evaluate their arguments). */
  evaluate: (node: ExprNode) => ScalarValue;
  /** The active evaluation context (scopes + host). */
  ctx: EvalContext;
}

export interface FunctionDef {
  minArgs: number;
  maxArgs?: number;
  returnType: ReturnType;
  /**
   * When true, trailing arguments (after the first) are parsed as `+flagName` /
   * `-flagName` flag deltas rather than expressions, and reach `eval` as
   * `flagdelta` nodes. (e.g. storylets' check_flags / set_flags.)
   */
  flagDeltaArgs?: boolean;
  /**
   * Evaluate the call. Receives the RAW argument nodes (not pre-evaluated) so
   * flag-delta functions can read `flagdelta` nodes directly; plain functions
   * call `h.evaluate(args[i])`. Implementations own their own arity/type checks.
   */
  eval: (args: ExprNode[], h: EvalHelpers) => ScalarValue;
  /**
   * Optional function-specific static validation, run by `validateExpr` after
   * the core has checked arity and recursed into args. Use it for rules the
   * generic validator can't know (e.g. "this string arg must be non-empty", or
   * "the first arg must be a flags property"). The core handles scope
   * resolution, arity, operand types, division-by-zero and enum compares.
   */
  validate?: (args: ExprNode[], h: ValidateHelpers) => void;
}

export interface Dialect {
  scopes: ScopeDef[];
  /** Bare `@name` is shorthand for `@<defaultScope>.name`. */
  defaultScope: string;
  functions: Record<string, FunctionDef>;
}
