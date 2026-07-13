// ---------------------------------------------------------------------------
// @wildwinter/expr-specificity - public surface.
//
// Matched-constraint specificity: score how many atomic constraints in an
// expression are actively holding it true against the current state. An
// evaluation-aware walk (unlike a static clause count, an `or`'s score depends
// on which branch is currently matching). Shared by Storylet Studio (storylet
// draw priority) and Patter (dialogue best-match), which had independently
// grown the same algorithm.
//
// Built on @wildwinter/expr's `ExprNode`. The host supplies truthiness via an
// `evalTruthy` closure, so this package stays ignorant of the eval context,
// the dialect, and the host's truthiness rule - each host keeps its own
// behaviour while sharing one definition of the walk.
// ---------------------------------------------------------------------------

import type { ExprNode } from "@wildwinter/expr";

/** A call node, narrowed from the ExprNode union. */
type CallNode = Extract<ExprNode, { kind: "call" }>;

/**
 * Evaluate an expression subtree to a boolean. Host-bound: the host closes over
 * its own evaluate + eval context + dialect and applies its own truthiness
 * coercion (Storylets' `conditionPasses`, Patter's `truthy`, etc.).
 */
export type EvalTruthy = (node: ExprNode) => boolean;

/**
 * A call treated as a conjunction of constraints rather than a single atom, so
 * it contributes its operand count instead of 1. `check_flags` is the built-in
 * example (see {@link CHECK_FLAGS_COUNTING_CALL}).
 */
export interface CountingCall {
  /** The function name this rule applies to. */
  name: string;
  /** How many constraints the call contributes when it holds (at least 1). */
  count: (node: CallNode) => number;
}

export interface MatchedSpecificityOptions {
  /**
   * Root polarity - the truth value the whole condition must have. Production
   * only ever scores conditions already known eligible, so this defaults to
   * `true` and rarely needs setting.
   */
  want?: boolean;
  /**
   * Calls scored by operand count rather than as a single atom. Defaults to
   * `[CHECK_FLAGS_COUNTING_CALL]`. Supply your own to add or replace rules.
   */
  countingCalls?: readonly CountingCall[];
}

/**
 * `check_flags(v, f1..fN)` counts as N constraints - an N-ary AND over the flag
 * operands - never fewer than 1. `args[0]` is the flags source, so the operand
 * count is `args.length - 1`.
 */
export const CHECK_FLAGS_COUNTING_CALL: CountingCall = {
  name: "check_flags",
  count: (node) => Math.max(1, node.args.length - 1),
};

const DEFAULT_COUNTING_CALLS: readonly CountingCall[] = [CHECK_FLAGS_COUNTING_CALL];

/**
 * Score how many atomic constraints in `node` are actively holding it true
 * against current state, via `evalTruthy`.
 *
 * The walk carries a polarity flag `want` ("the truth value this subtree must
 * have for the whole to hold"), applying De Morgan as it descends:
 *   - atom: 1 if its truth matches `want`, else 0
 *   - and:  under `want`, both must hold -> sum; under `!want`, behaves as or
 *   - or:   under `want`, strongest branch -> max; under `!want`, behaves as and
 *   - not:  recurse with `want` flipped
 *   - counting call (e.g. check_flags): its operand count when it must hold and
 *     does, else the negated rules apply
 *
 * @example
 *   // `@x == 5 and @y > 3` with both holding -> 2
 *   matchedSpecificity(ast, node => conditionPasses(evaluate(node, ctx)))
 */
export function matchedSpecificity(
  node: ExprNode,
  evalTruthy: EvalTruthy,
  opts?: MatchedSpecificityOptions,
): number {
  const countingCalls = opts?.countingCalls ?? DEFAULT_COUNTING_CALLS;
  return walk(node, opts?.want ?? true, evalTruthy, countingCalls);
}

function walk(
  node: ExprNode,
  want: boolean,
  evalTruthy: EvalTruthy,
  countingCalls: readonly CountingCall[],
): number {
  if (node.kind === "binary" && (node.op === "and" || node.op === "or")) {
    const l = walk(node.left, want, evalTruthy, countingCalls);
    const r = walk(node.right, want, evalTruthy, countingCalls);
    // De Morgan: an `and` under negation behaves like an `or`, and vice versa.
    const behaveAsAnd = (node.op === "and") === want;
    if (behaveAsAnd) return l > 0 && r > 0 ? l + r : 0; // both must hold -> sum
    return Math.max(l, r); // either holds -> strongest branch
  }
  if (node.kind === "unary" && node.op === "not") {
    return walk(node.operand, !want, evalTruthy, countingCalls);
  }
  if (node.kind === "call") {
    const rule = countingCalls.find((c) => c.name === node.name);
    if (rule) {
      const operands = rule.count(node);
      const holds = evalTruthy(node);
      if (want) return holds ? operands : 0;
      return holds ? 0 : 1; // negated: De Morgan -> at least one operand fails -> 1
    }
  }
  // Any other node is an atom worth one constraint when its truth matches want.
  return evalTruthy(node) === want ? 1 : 0;
}
