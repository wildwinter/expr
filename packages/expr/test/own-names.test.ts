// Names an author writes are looked up as a record's OWN entries (src/own.ts), never as the
// names every JavaScript object inherits. Before October 2026 the keyword table answered
// `constructor` and `__proto__` with built-ins, so the parser refused them as property names;
// a static scope bag answered them with built-in values; and a dialect's function table
// offered `Object` (as `constructor`) and `toString` as functions to call.

import { describe, it, expect } from "vitest";
import { parse, evaluate, EvalError, validateExpr } from "../src/index.js";
import type { Dialect, EvalContext } from "../src/index.js";

const dialect: Dialect = {
  defaultScope: "game",
  scopes: [{ token: "game" }, { token: "world", missing: "throw" }],
  functions: {},
};
const ctx = (scopes: EvalContext["scopes"]): EvalContext => ({ scopes });
const run = (src: string, scopes: EvalContext["scopes"]): unknown => evaluate(parse(src, dialect), ctx(scopes), dialect);

describe("an author's names are looked up as own entries only", () => {
  it("parses a property named like a built-in, in a scope and in the default scope", () => {
    for (const name of ["constructor", "__proto__", "tostring", "valueof", "hasownproperty"]) {
      expect(() => parse(`@world.${name}`, dialect), name).not.toThrow();
      expect(() => parse(`@${name}`, dialect), name).not.toThrow();
    }
  });

  it("reads such a property's own value from a static bag, and treats an inherited one as missing", () => {
    expect(run("@game.constructor + 1", { game: { constructor: 2 } })).toBe(3);
    expect(run("@game.constructor", { game: { hp: 1 } })).toBe(false);          // missing: false policy
    expect(() => run("@world.constructor", { world: { hp: 1 } }))                 // missing: throw policy
      .toThrow("@world.constructor is not declared on the current world.");
    expect(run("@game.__proto__", { game: { hp: 1 } })).toBe(false);
  });

  it("finds no scope by an inherited name", () => {
    const withScope: Dialect = { ...dialect, scopes: [...dialect.scopes, { token: "constructor" }] };
    expect(evaluate(parse("@constructor.name", withScope), ctx({}), withScope)).toBe(false);   // not Object.name, "Object"
  });

  it("calls no inherited function, and validation agrees", () => {
    for (const name of ["constructor", "tostring", "valueof"]) {
      const ast = parse(`${name}(1)`, dialect);
      expect(() => evaluate(ast, ctx({}), dialect), name).toThrow(EvalError);
      expect(() => evaluate(ast, ctx({}), dialect), name).toThrow(`unknown function '${name}'`);
      expect(validateExpr(ast, { properties: new Map() }, dialect).map((i) => i.kind), name).toContain("unknown-function");
    }
  });
});
