// ---------------------------------------------------------------------------
// '+' takes two numbers and nothing else.
//
// It joined two strings until 2026-11-08, while the checker refused it, so the
// language disagreed with itself. Ian's ruling: text built from pieces fixes its
// word order in the expression and cannot be translated, so the join goes, at
// evaluation (every port) and in the checker, with one message that says why.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { parse, evaluate, EvalError, parseAndValidate } from "../src/index.js";
import type { Dialect, ExpressionSchema, ScalarValue } from "../src/index.js";

const dialect: Dialect = { defaultScope: "story", scopes: [{ token: "story" }], functions: {} };

const JOIN_TEXT = "'+' cannot join text: put the value into the text itself, so it can be translated";

const schema: ExpressionSchema = {
  properties: new Map([
    ["story", new Map([
      ["name", { type: "string" as const }],
      ["season", { type: "enum" as const, enumValues: ["winter", "summer"] }],
      ["gold", { type: "number" as const }],
      ["brave", { type: "boolean" as const }],
    ])],
  ]),
};

const run = (src: string, values: Record<string, ScalarValue>) =>
  evaluate(parse(src, dialect), { scopes: { story: values } }, dialect);

describe("'+' at evaluation", () => {
  it("adds two numbers", () => {
    expect(run("@gold + 2", { gold: 3 })).toBe(5);
  });

  it.each([
    ["two strings", "@name + 'x'", { name: "Ann" }],
    ["a string and a number", "@name + 1", { name: "Ann" }],
    ["a number and a string", "@gold + 'x'", { gold: 1 }],
  ])("refuses %s, saying why", (_label, src, values) => {
    expect(() => run(src, values)).toThrow(EvalError);
    expect(() => run(src, values)).toThrow(JOIN_TEXT);
  });

  it("refuses two booleans as a type error, not a text one", () => {
    expect(() => run("@brave + @brave", { brave: true })).toThrow("'+' requires numeric operands, got boolean and boolean");
  });
});

describe("'+' in the checker", () => {
  const check = (src: string) => parseAndValidate(src, schema, dialect).issues;

  it("accepts two numbers", () => {
    expect(check("@gold + 2")).toEqual([]);
  });

  it.each([
    ["two strings", "@name + 'x'"],
    ["two literals", "'a' + 'b'"],
    ["an enum and a string", "@season + 'x'"],
    ["a string and a number", "@name + @gold"],
    ["a number and a string", "@gold + @name"],
  ])("refuses %s once, with the text message", (_label, src) => {
    const issues = check(src);
    expect(issues.map((i) => [i.kind, i.message])).toEqual([["operand-type-mismatch", JOIN_TEXT]]);
  });

  it("still refuses a boolean as a number", () => {
    expect(check("@brave + 1").map((i) => i.message)).toEqual(["'+' requires a number on the left, got boolean"]);
  });
});
