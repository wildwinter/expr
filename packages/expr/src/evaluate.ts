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

        switch (n.op) {
          case "==": return left === right;
          case "!=": return left !== right;
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

function assertNumbers(l: ScalarValue, r: ScalarValue, op: string): void {
  if (typeof l !== "number" || typeof r !== "number") {
    throw new EvalError(`'${op}' requires numeric operands, got ${typeof l} and ${typeof r}`);
  }
}
