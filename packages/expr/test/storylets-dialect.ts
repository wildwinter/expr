// ---------------------------------------------------------------------------
// The Storylet Studio dialect, reconstructed as a fixture.
//
// This proves the compatibility constraint: the agnostic core, configured with
// this Dialect, must reproduce storylets' current parser/evaluator behaviour
// exactly. Each function's `eval` body is ported verbatim from
// storylets/packages/engine/src/expression.ts, reading host callbacks from
// `ctx.host`. The 8 scopes and the world default + site/zone throw policy match
// the original.
//
// When storylets migrates onto @wildwinter/expr, it provides a dialect like
// this from its own repo. Here it lives in tests as the regression gate.
// ---------------------------------------------------------------------------

import type {
  Dialect, EvalHelpers, ExprNode, ScalarValue, ValidateHelpers,
} from "../src/index.js";
import { EvalError } from "../src/index.js";

// Function-specific static validation, ported from storylets' validate.ts.

/** site_has_tag / count_played_tag / turns_since_tag: a literal empty-string tag never matches. */
function emptyTagArg(fnName: string) {
  return (args: ExprNode[], h: ValidateHelpers): void => {
    if (args.length === 1) {
      const arg = args[0]!;
      if (arg.kind === "string" && arg.value === "") {
        h.report({
          path: [...h.path, "args", 0], kind: "empty-string-arg", severity: "error",
          message: `${fnName}() needs a tag name - empty string never matches`,
        });
      }
    }
  };
}

/** check_flags / set_flags: first arg must be a flags property; deltas must be declared flags. */
function flagsCall(fnName: string) {
  return (args: ExprNode[], h: ValidateHelpers): void => {
    if (args.length === 0) return;
    const firstArg = args[0]!;
    if (firstArg.kind !== "scopedvar") {
      h.report({
        path: [...h.path, "args", 0], kind: "wrong-arg-type", severity: "error",
        message: `${fnName}(): first argument must be a flags property reference (@name or @scope.name)`,
      });
      return;
    }
    const meta = h.schema.properties.get(firstArg.scope)?.get(firstArg.name);
    if (meta && meta.type !== "flags") {
      const ref = firstArg.scope === h.defaultScope ? firstArg.name : `${firstArg.scope}.${firstArg.name}`;
      h.report({
        path: [...h.path, "args", 0], kind: "wrong-arg-type", severity: "error",
        message: `${fnName}(): '@${ref}' is not a flags property (got ${meta.type})`,
      });
      return;
    }
    if (meta?.type === "flags") {
      for (let i = 1; i < args.length; i++) {
        const arg = args[i]!;
        if (arg.kind !== "flagdelta") {
          h.report({
            path: [...h.path, "args", i], kind: "wrong-arg-type", severity: "error",
            message: `${fnName}(): argument ${i + 1} must be +flagName or -flagName`,
          });
        } else if (meta.enumValues && !meta.enumValues.includes(arg.name)) {
          h.report({
            path: [...h.path, "args", i], kind: "unknown-flag-name", severity: "error",
            message: `${fnName}(): unknown flag '${arg.name}' - expected one of: ${meta.enumValues.join(", ")}`,
            reference: arg.name,
          });
        }
      }
    }
  };
}

export interface StoryletsHost {
  siteHasTag?: (tag: string) => boolean;
  countPlayedTag?: (tag: string) => number;
  turnsSinceTag?: (tag: string) => number;
  nextRandom?: () => number;
}

function host(h: EvalHelpers): StoryletsHost {
  return (h.ctx.host ?? {}) as StoryletsHost;
}

export const storyletsDialect: Dialect = {
  defaultScope: "world",
  scopes: [
    { token: "world" },
    { token: "deck" },
    { token: "act" },
    { token: "story" },
    { token: "player" },
    { token: "system" },
    // site/zone: a missing property is a publish-validation bug, not graceful-false.
    { token: "zone", missing: "throw" },
    { token: "site", missing: "throw" },
  ],
  functions: {
    site_has_tag: {
      minArgs: 1, maxArgs: 1, returnType: "boolean",
      validate: emptyTagArg("site_has_tag"),
      eval(args: ExprNode[], h: EvalHelpers): ScalarValue {
        if (args.length !== 1) throw new EvalError("site_has_tag() requires exactly 1 argument");
        const tag = h.evaluate(args[0]!);
        if (typeof tag !== "string") throw new EvalError("site_has_tag() argument must be a string");
        return host(h).siteHasTag ? host(h).siteHasTag!(tag) : false;
      },
    },
    random: {
      minArgs: 2, maxArgs: 2, returnType: "number",
      eval(args: ExprNode[], h: EvalHelpers): ScalarValue {
        if (args.length !== 2) throw new EvalError("random(a, b) requires exactly 2 arguments");
        const nextRandom = host(h).nextRandom;
        if (!nextRandom) throw new EvalError("random() called without a PRNG in context");
        const aVal = h.evaluate(args[0]!);
        const bVal = h.evaluate(args[1]!);
        if (typeof aVal !== "number" || typeof bVal !== "number") {
          throw new EvalError("random(a, b) arguments must be numbers");
        }
        if (!Number.isInteger(aVal) || !Number.isInteger(bVal)) {
          throw new EvalError("random(a, b) arguments must be integers");
        }
        const lo = Math.min(aVal, bVal);
        const hi = Math.max(aVal, bVal);
        const span = hi - lo + 1;
        return Math.floor(nextRandom() * span) + lo;
      },
    },
    count_played_tag: {
      minArgs: 1, maxArgs: 1, returnType: "number",
      validate: emptyTagArg("count_played_tag"),
      eval(args: ExprNode[], h: EvalHelpers): ScalarValue {
        if (args.length !== 1) throw new EvalError("count_played_tag() requires exactly 1 argument");
        const tag = h.evaluate(args[0]!);
        if (typeof tag !== "string") throw new EvalError("count_played_tag() argument must be a string");
        return host(h).countPlayedTag ? host(h).countPlayedTag!(tag) : 0;
      },
    },
    turns_since_tag: {
      minArgs: 1, maxArgs: 1, returnType: "number",
      validate: emptyTagArg("turns_since_tag"),
      eval(args: ExprNode[], h: EvalHelpers): ScalarValue {
        if (args.length !== 1) throw new EvalError("turns_since_tag() requires exactly 1 argument");
        const tag = h.evaluate(args[0]!);
        if (typeof tag !== "string") throw new EvalError("turns_since_tag() argument must be a string");
        return host(h).turnsSinceTag ? host(h).turnsSinceTag!(tag) : 9999;
      },
    },
    check_flags: {
      minArgs: 1, returnType: "boolean", flagDeltaArgs: true,
      validate: flagsCall("check_flags"),
      eval(args: ExprNode[], h: EvalHelpers): ScalarValue {
        if (args.length === 0) throw new EvalError("check_flags() requires at least one argument (the flags variable)");
        const flagsVal = h.evaluate(args[0]!);
        if (!Array.isArray(flagsVal) && flagsVal !== false && flagsVal !== null && flagsVal !== undefined)
          throw new EvalError("check_flags() first argument must be a flags property");
        const flagSet = Array.isArray(flagsVal) ? (flagsVal as string[]) : [];
        for (let i = 1; i < args.length; i++) {
          const arg = args[i]!;
          if (arg.kind !== "flagdelta") throw new EvalError("check_flags() flag args must be +flagName or -flagName");
          if (arg.sign === "+" ? !flagSet.includes(arg.name) : flagSet.includes(arg.name)) return false;
        }
        return true;
      },
    },
    set_flags: {
      minArgs: 1, returnType: "flags", flagDeltaArgs: true,
      validate: flagsCall("set_flags"),
      eval(args: ExprNode[], h: EvalHelpers): ScalarValue {
        if (args.length === 0) throw new EvalError("set_flags() requires at least one argument (the flags variable)");
        const flagsVal = h.evaluate(args[0]!);
        if (!Array.isArray(flagsVal) && flagsVal !== false && flagsVal !== null && flagsVal !== undefined)
          throw new EvalError("set_flags() first argument must be a flags property");
        const result = Array.isArray(flagsVal) ? [...(flagsVal as string[])] : [];
        for (let i = 1; i < args.length; i++) {
          const arg = args[i]!;
          if (arg.kind !== "flagdelta") throw new EvalError("set_flags() flag args must be +flagName or -flagName");
          if (arg.sign === "+") {
            if (!result.includes(arg.name)) result.push(arg.name);
          } else {
            const idx = result.indexOf(arg.name);
            if (idx >= 0) result.splice(idx, 1);
          }
        }
        return result;
      },
    },
  },
};
