// ---------------------------------------------------------------------------
// Evaluator - walk an ExprNode against an EvalContext, parameterised by Dialect.
//
// Operators (binary/unary), short-circuiting, and type-checking are generic.
// Scope resolution uses the context's scope maps + the Dialect's per-scope
// missing-property policy. Function calls dispatch to the Dialect's functions.
//
// Ported from @storylets/engine (storylets/packages/engine/src/expression.ts),
// generalised by injecting scopes + functions from the Dialect.
// ---------------------------------------------------------------------------

import type { ExprNode, ScalarValue } from "./ast.js";
import type { Dialect, EvalContext, ScopeResolver } from "./dialect.js";

export class EvalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvalError";
  }
}

export function evaluate(node: ExprNode, ctx: EvalContext, dialect: Dialect): ScalarValue {
  // Per-scope missing-property policy, precomputed once per top-level evaluate.
  const missingPolicy = new Map<string, "false" | "throw">(
    dialect.scopes.map((s) => [s.token, s.missing ?? "false"])
  );

  const rec = (n: ExprNode): ScalarValue => {
    switch (n.kind) {
      case "bool":   return n.value;
      case "number": return n.value;
      case "string": return n.value;

      case "scopedvar": {
        const scope = ctx.scopes[n.scope];
        if (scope === undefined) {
          // Scope context absent -> graceful false. (A scope the dialect knows
          // about but the context didn't populate, or an unknown scope.)
          return false;
        }
        // A scope is either a static bag or a host resolver ({ get }). Bag values
        // are always ScalarValue (never functions), so a `get` function reliably
        // distinguishes a resolver.
        const val = typeof (scope as ScopeResolver).get === "function"
          ? (scope as ScopeResolver).get(n.name)
          : (scope as Record<string, ScalarValue>)[n.name];
        if (val === undefined) {
          // Property not declared on the present scope. Policy decides: "false"
          // for back-compat scopes, "throw" for scopes where a missing key is a
          // bug publish-time validation should have caught.
          if (missingPolicy.get(n.scope) === "throw") {
            throw new EvalError(`@${n.scope}.${n.name} is not declared on the current ${n.scope}.`);
          }
          return false;
        }
        return val;
      }

      case "call": {
        // `advance` is the language's own, the first core built-in: the next
        // stage in the argument's ladder, saturating at the last. Core rather
        // than dialect because it IS the quality design's insertion mechanism
        // (an outcome that never names its destination routes through an
        // inserted stage automatically), and every dialect should say it the
        // same way. A dialect that defines its own `advance` wins, for
        // back-compat with any dialect that already had one.
        if (n.name === "advance" && !dialect.functions[n.name]) {
          const arg = n.args[0];
          if (n.args.length !== 1 || arg === undefined) {
            throw new EvalError(`advance() takes exactly 1 argument, got ${n.args.length}`);
          }
          const ladder = ladderOf(arg, ctx);
          if (ladder === undefined) {
            throw new EvalError("advance() needs a quality reference (@scope.name of a quality property)");
          }
          const current = stageIndex(rec(arg), ladder, "advance");
          return ladder[Math.min(current + 1, ladder.length - 1)]!;
        }
        const def = dialect.functions[n.name];
        if (!def) throw new EvalError(`unknown function '${n.name}'`);
        return def.eval(n.args, { evaluate: rec, ctx });
      }

      case "flagdelta":
        throw new EvalError("flagdelta node is only valid as an argument to a flag-delta function");

      case "unary": {
        if (n.op === "not") {
          const val = rec(n.operand);
          if (typeof val !== "boolean") throw new EvalError(`'not' requires a boolean operand, got ${typeof val}`);
          return !val;
        }
        // neg
        const val = rec(n.operand);
        if (typeof val !== "number") throw new EvalError(`unary '-' requires a numeric operand, got ${typeof val}`);
        return -val;
      }

      case "binary": {
        // Short-circuit operators first
        if (n.op === "and") {
          const l = rec(n.left);
          if (typeof l !== "boolean") throw new EvalError(`'and' requires boolean operands, left is ${typeof l}`);
          if (!l) return false;
          const r = rec(n.right);
          if (typeof r !== "boolean") throw new EvalError(`'and' requires boolean operands, right is ${typeof r}`);
          return r;
        }
        if (n.op === "or") {
          const l = rec(n.left);
          if (typeof l !== "boolean") throw new EvalError(`'or' requires boolean operands, left is ${typeof l}`);
          if (l) return true;
          const r = rec(n.right);
          if (typeof r !== "boolean") throw new EvalError(`'or' requires boolean operands, right is ${typeof r}`);
          return r;
        }

        const left  = rec(n.left);
        const right = rec(n.right);

        // Quality: when either operand REFERENCES a quality (the node carries
        // the scope+name the channel resolves), ordering compares by ladder
        // position and arithmetic is refused. Everything else is untouched,
        // so a context with no channel behaves exactly as before.
        const lLadder = ladderOf(n.left, ctx);
        const rLadder = ladderOf(n.right, ctx);
        const ladder = lLadder ?? rLadder;
        if (ladder !== undefined) {
          if (lLadder && rLadder && !sameLadder(lLadder, rLadder)) {
            if (n.op === ">" || n.op === ">=" || n.op === "<" || n.op === "<=") {
              throw new EvalError(`'${n.op}' compares two different qualities, whose stage orders are unrelated`);
            }
          }
          switch (n.op) {
            case ">":  return stageIndex(left, ladder, ">")  >  stageIndex(right, ladder, ">");
            case ">=": return stageIndex(left, ladder, ">=") >= stageIndex(right, ladder, ">=");
            case "<":  return stageIndex(left, ladder, "<")  <  stageIndex(right, ladder, "<");
            case "<=": return stageIndex(left, ladder, "<=") <= stageIndex(right, ladder, "<=");
            case "+": case "-": case "*": case "/":
              throw new EvalError(`'${n.op}' cannot be applied to a quality - a stage is a position, not a number; use advance() to move it`);
            default: break;   // == and != fall through to plain value equality
          }
        }

        switch (n.op) {
          case "==": return valueEquals(left, right);
          case "!=": return !valueEquals(left, right);
          case ">":  assertNumbers(left, right, ">");  return (left as number) >  (right as number);
          case ">=": assertNumbers(left, right, ">="); return (left as number) >= (right as number);
          case "<":  assertNumbers(left, right, "<");  return (left as number) <  (right as number);
          case "<=": assertNumbers(left, right, "<="); return (left as number) <= (right as number);
          case "+":
            if (typeof left === "number" && typeof right === "number") return left + right;
            if (typeof left === "string" && typeof right === "string") return left + right;
            throw new EvalError(`'+' requires two numbers or two strings, got ${typeof left} and ${typeof right}`);
          case "-": assertNumbers(left, right, "-"); return (left as number) - (right as number);
          case "*": assertNumbers(left, right, "*"); return (left as number) * (right as number);
          case "/":
            assertNumbers(left, right, "/");
            if ((right as number) === 0) throw new EvalError("division by zero");
            return (left as number) / (right as number);
        }
      }
    }
  };

  return rec(node);
}

/**
 * Equality for `==` / `!=`. Primitives compare by value (JS `===`); arrays
 * (the flags value type) compare as SETS: same members, ORDER IRRELEVANT.
 *
 * Plain `===` on arrays would be reference equality - two distinct arrays with
 * the same contents would never be equal, and a fresh array (from a scope read
 * or a function result) would never equal another. Mixed array/non-array
 * operands are unequal, and never an error.
 *
 * Order was significant until 2026-09-01, and that was wrong: a flags value IS
 * a set, and its stored order is an artefact of the order somebody happened to
 * add things in. `set_flags(@f, +a)` then `+b` compared UNEQUAL to the same two
 * flags added the other way round, which is a difference no author can see and
 * none intends. The Storylet Engine papered over it by sorting in `set_flags`,
 * which only holds while every producer sorts: a bundle's declared default, or
 * a host handing a list in, does not.
 *
 * Compared as MULTISETS (sorted copies), so a duplicated flag still counts. A
 * well-formed flags value has no duplicates, but equality should not be the
 * thing that decides what happens if one appears.
 */
function valueEquals(a: ScalarValue, b: ScalarValue): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    const x = [...a].sort();
    const y = [...b].sort();
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
    return true;
  }
  return a === b;
}

function assertNumbers(l: ScalarValue, r: ScalarValue, op: string): void {
  if (typeof l !== "number" || typeof r !== "number") {
    throw new EvalError(`'${op}' requires numeric operands, got ${typeof l} and ${typeof r}`);
  }
}

// --- quality (design: storylets-new/design/quality.md) -----------------------

/** The ladder behind an operand NODE, when the context's quality channel says
 *  it references a quality. Values are plain strings; the node is what carries
 *  the (scope, name) the channel needs. */
function ladderOf(node: ExprNode, ctx: EvalContext): readonly string[] | undefined {
  if (node.kind !== "scopedvar" || ctx.qualities === undefined) return undefined;
  return ctx.qualities(node.scope, node.name);
}

/** Index of a stage in a ladder; an unknown stage is an error naming the
 *  value, never a silent pass (a drifted save is exactly what lands here). */
function stageIndex(value: ScalarValue, ladder: readonly string[], op: string): number {
  if (typeof value !== "string") {
    throw new EvalError(`'${op}' on a quality compares stages, got ${typeof value}`);
  }
  const i = ladder.indexOf(value);
  if (i < 0) throw new EvalError(`"${value}" is not a stage of this quality (stages: ${ladder.join(", ")})`);
  return i;
}

const sameLadder = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((x, i) => x === b[i]);
