import { describe, it, expect } from "vitest";
import {
  parse, unparse, evaluate, serialiseAst, deserialiseAst, compile, ParseError, EvalError,
} from "../src/index.js";
import type { Dialect, EvalContext } from "../src/index.js";

// A minimal "Patter-style" dialect: different scopes, a different default
// scope, and a different function set - proving the core is genuinely agnostic.
const patter: Dialect = {
  defaultScope: "shared",
  scopes: [{ token: "shared" }, { token: "scene" }, { token: "flow" }],
  functions: {
    max: {
      minArgs: 2, maxArgs: 2, returnType: "number",
      eval(args, h) {
        const a = h.evaluate(args[0]!), b = h.evaluate(args[1]!);
        if (typeof a !== "number" || typeof b !== "number") throw new EvalError("max() needs numbers");
        return Math.max(a, b);
      },
    },
  },
};

const ctx = (scopes: EvalContext["scopes"], host?: Record<string, unknown>): EvalContext => ({ scopes, host });

describe("parser - literals and structure", () => {
  it("parses literals", () => {
    expect(parse("true", patter)).toEqual({ kind: "bool", value: true });
    expect(parse("42", patter)).toEqual({ kind: "number", value: 42 });
    expect(parse("3.14", patter)).toEqual({ kind: "number", value: 3.14 });
    expect(parse("'hello'", patter)).toEqual({ kind: "string", value: "hello" });
  });

  it("treats a bare identifier as an unquoted string (enum sugar)", () => {
    expect(parse("winter", patter)).toEqual({ kind: "string", value: "winter" });
  });

  it("folds unary minus on a literal", () => {
    expect(parse("-5", patter)).toEqual({ kind: "number", value: -5 });
  });

  it("canonicalises bare @name to the dialect default scope", () => {
    expect(parse("@hp", patter)).toEqual({ kind: "scopedvar", scope: "shared", name: "hp" });
  });

  it("parses explicit scopes and lowercases names", () => {
    expect(parse("@scene.Alarm", patter)).toEqual({ kind: "scopedvar", scope: "scene", name: "alarm" });
  });

  it("accepts = as an alias for ==", () => {
    expect(parse("@hp = 5", patter)).toEqual(parse("@hp == 5", patter));
  });

  it("honours operator precedence (and binds tighter than or)", () => {
    // a or b and c  ->  a or (b and c)
    const ast = serialiseAst(parse("@a or @b and @c", patter));
    expect(ast).toEqual(["bin", "or", ["sv", "shared", "a"], ["bin", "and", ["sv", "shared", "b"], ["sv", "shared", "c"]]]);
  });

  it("reports parse errors with position", () => {
    expect(() => parse("@hp +", patter)).toThrow(ParseError);
  });
});

describe("serialise / deserialise round-trip", () => {
  it("round-trips the AST through the tagged-tuple form", () => {
    for (const src of ["@hp < 10 and @scene.alarm", "max(@hp, 3) + 1", "not @flow.done", "-@shared.x"]) {
      const node = parse(src, patter);
      expect(deserialiseAst(serialiseAst(node))).toEqual(node);
    }
  });

  it("compile() produces a { src, ast } envelope", () => {
    expect(compile("@hp > 0", patter)).toEqual({ src: "@hp > 0", ast: ["bin", ">", ["sv", "shared", "hp"], ["n", 0]] });
  });
});

describe("unparse round-trip", () => {
  it("round-trips parse -> unparse -> parse using the default scope", () => {
    for (const src of ["@hp", "@scene.alarm", "@hp < 10 and not @flow.done", "max(@hp, 3) + 1 == 4", "(1 + 2) * 3"]) {
      const a = parse(src, patter);
      const text = unparse(a, { defaultScope: patter.defaultScope });
      expect(parse(text, patter)).toEqual(a);
    }
  });

  it("emits bare @name only for the default scope", () => {
    expect(unparse(parse("@hp", patter), { defaultScope: "shared" })).toBe("@hp");
    expect(unparse(parse("@scene.alarm", patter), { defaultScope: "shared" })).toBe("@scene.alarm");
  });
});

describe("evaluate - operators", () => {
  it("evaluates comparisons and arithmetic", () => {
    expect(evaluate(parse("@hp > 10", patter), ctx({ shared: { hp: 20 } }), patter)).toBe(true);
    expect(evaluate(parse("@hp + 5", patter), ctx({ shared: { hp: 20 } }), patter)).toBe(25);
    expect(evaluate(parse("@name == bob", patter), ctx({ shared: { name: "bob" } }), patter)).toBe(true);
  });

  it("== / != compare arrays (flags) by value, not by reference", () => {
    // Two DISTINCT arrays with identical contents must be ==. Plain JS === would
    // be reference equality (false). Order matters; differing contents are !=.
    const same = ctx({ shared: { a: ["x", "y"], b: ["x", "y"] } });
    expect(evaluate(parse("@a == @b", patter), same, patter)).toBe(true);
    expect(evaluate(parse("@a != @b", patter), same, patter)).toBe(false);

    const diffOrder = ctx({ shared: { a: ["x", "y"], b: ["y", "x"] } });
    expect(evaluate(parse("@a == @b", patter), diffOrder, patter)).toBe(false);

    const diffLen = ctx({ shared: { a: ["x"], b: ["x", "y"] } });
    expect(evaluate(parse("@a == @b", patter), diffLen, patter)).toBe(false);

    // Array vs non-array operands are never equal.
    const mixed = ctx({ shared: { a: ["x"], b: "x" } });
    expect(evaluate(parse("@a == @b", patter), mixed, patter)).toBe(false);
  });

  it("short-circuits and / or", () => {
    // right side references a throwing function; left determines result so it must not run
    const boom: Dialect = { ...patter, functions: { ...patter.functions, boom: { minArgs: 0, returnType: "boolean", eval() { throw new EvalError("should not run"); } } } };
    expect(evaluate(parse("false and boom()", boom), ctx({}), boom)).toBe(false);
    expect(evaluate(parse("true or boom()", boom), ctx({}), boom)).toBe(true);
  });

  it("rejects type mismatches", () => {
    expect(() => evaluate(parse("@hp > 'x'", patter), ctx({ shared: { hp: 1 } }), patter)).toThrow(EvalError);
    expect(() => evaluate(parse("1 / 0", patter), ctx({}), patter)).toThrow(/division by zero/);
  });

  it("calls dialect functions", () => {
    expect(evaluate(parse("max(@hp, 3)", patter), ctx({ shared: { hp: 7 } }), patter)).toBe(7);
    expect(() => evaluate(parse("nope()", patter), ctx({}), patter)).toThrow(/unknown function 'nope'/);
  });
});

describe("evaluate - scope resolution", () => {
  it("resolves present scopes and graceful-false for absent scope or missing prop (default policy)", () => {
    expect(evaluate(parse("@scene.alarm", patter), ctx({ scene: { alarm: true } }), patter)).toBe(true);
    expect(evaluate(parse("@scene.alarm", patter), ctx({}), patter)).toBe(false);            // scope absent
    expect(evaluate(parse("@scene.alarm", patter), ctx({ scene: {} }), patter)).toBe(false); // prop missing, policy "false"
  });
});

// Resolver-backed scopes - a scope can be read through a host `{ get }` resolver
// (the basis for foreign scopes), not just a static bag. Backward-compatible.
describe("resolver-backed scopes", () => {
  const D: Dialect = {
    defaultScope: "shared",
    scopes: [{ token: "shared" }, { token: "game" }],
    functions: {},
  };

  it("reads a scope value through a { get } resolver", () => {
    const game = { get: (n: string) => (n === "gold" ? 42 : undefined) };
    expect(evaluate(parse("@game.gold", D), ctx({ game }), D)).toBe(42);
  });

  it("a resolver returning undefined applies the missing policy (false by default)", () => {
    const game = { get: () => undefined };
    expect(evaluate(parse("@game.nope", D), ctx({ game }), D)).toBe(false);
  });

  it("honours a 'throw' missing policy on a resolver scope", () => {
    const T: Dialect = { ...D, scopes: [{ token: "game", missing: "throw" }] };
    const game = { get: () => undefined };
    expect(() => evaluate(parse("@game.x", T), ctx({ game }), T)).toThrow(EvalError);
  });

  it("an absent resolver scope is graceful-false", () => {
    expect(evaluate(parse("@game.gold", D), ctx({}), D)).toBe(false);
  });

  it("mixes a static bag and a resolver in one expression", () => {
    const game = { get: (n: string) => (n === "gold" ? 10 : undefined) };
    expect(evaluate(parse("@shared.hp + @game.gold", D), ctx({ shared: { hp: 5 }, game }), D)).toBe(15);
  });

  it("treats a bag with a property literally named 'get' as a bag, not a resolver", () => {
    // The bag's `get` is a number (a ScalarValue), not a function, so it is not
    // mistaken for a resolver.
    expect(evaluate(parse("@shared.get", D), ctx({ shared: { get: 7 } }), D)).toBe(7);
  });
});
