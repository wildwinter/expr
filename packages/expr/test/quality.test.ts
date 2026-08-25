// ---------------------------------------------------------------------------
// Quality: an ordered ladder of named stages, first-class in the engine.
//
// The design lives in storylets-new/design/quality.md; the fork that put it
// HERE rather than in a dialect was the author's ruling of 2026-08-25, on the
// expectation that the whole family (Patter included) shares the payoff.
//
// The value model is untouched: a quality's runtime value is its stage name,
// a plain string. What the engine gains is the LADDER, reaching evaluation
// through an opt-in `qualities` channel on EvalContext, and `advance`, the
// language's first core built-in. A context that never wires the channel
// changes nothing, which is what keeps Patter compiling unchanged.
//
// Every expectation here was written before the implementation.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { parse, evaluate, EvalError, parseAndValidate } from "../src/index.js";
import type { Dialect, EvalContext, ExpressionSchema } from "../src/index.js";

const dialect: Dialect = {
  defaultScope: "story",
  scopes: [{ token: "story" }, { token: "deck" }],
  functions: {},
};

// Stage names chosen to sort WRONGLY as strings (alphabetical order would be
// confronted < resolved < troubled), so a lexicographic cheat cannot pass.
const LADDER = ["troubled", "confronted", "resolved"];

const ctx = (values: Record<string, string>, wire = true): EvalContext => ({
  scopes: { deck: values },
  ...(wire ? {
    qualities: (scope: string, name: string) =>
      scope === "deck" && name === "debt" ? LADDER : undefined,
  } : {}),
});

const run = (src: string, c: EvalContext) => evaluate(parse(src, dialect), c, dialect);

describe("ordering on a quality", () => {
  it("compares by ladder position, not by the alphabet", () => {
    expect(run('@deck.debt >= "confronted"', ctx({ debt: "resolved" }))).toBe(true);
    expect(run('@deck.debt >= "confronted"', ctx({ debt: "confronted" }))).toBe(true);
    expect(run('@deck.debt >= "confronted"', ctx({ debt: "troubled" }))).toBe(false);
    expect(run('@deck.debt < "resolved"', ctx({ debt: "troubled" }))).toBe(true);
    expect(run('@deck.debt > "troubled"', ctx({ debt: "confronted" }))).toBe(true);
    expect(run('@deck.debt <= "troubled"', ctx({ debt: "confronted" }))).toBe(false);
  });

  it("works with the quality on either side", () => {
    expect(run('"confronted" <= @deck.debt', ctx({ debt: "resolved" }))).toBe(true);
    expect(run('"resolved" > @deck.debt', ctx({ debt: "troubled" }))).toBe(true);
  });

  it("equality stays plain string equality, channel or no channel", () => {
    expect(run('@deck.debt == "confronted"', ctx({ debt: "confronted" }))).toBe(true);
    expect(run('@deck.debt != "resolved"', ctx({ debt: "confronted" }))).toBe(true);
    // an unknown stage in an EQUALITY is just false, like any enum mismatch
    expect(run('@deck.debt == "typo"', ctx({ debt: "confronted" }))).toBe(false);
  });

  it("a value naming no stage is an error on an ordering op, never a silent pass", () => {
    expect(() => run('@deck.debt >= "typo"', ctx({ debt: "confronted" }))).toThrow(EvalError);
    expect(() => run('@deck.debt >= "typo"', ctx({ debt: "confronted" }))).toThrow(/typo/);
    // the variable's own value can be the stray one (a drifted save)
    expect(() => run('@deck.debt >= "confronted"', ctx({ debt: "ghost" }))).toThrow(/ghost/);
  });

  it("comparing two different qualities is an error: their orders are unrelated", () => {
    const c: EvalContext = {
      scopes: { deck: { debt: "confronted", tree: "budding" } },
      qualities: (_s, n) => (n === "debt" ? LADDER : n === "tree" ? ["dormant", "budding", "blooming"] : undefined),
    };
    expect(() => run("@deck.debt >= @deck.tree", c)).toThrow(EvalError);
    expect(() => run("@deck.debt >= @deck.tree", c)).toThrow(/different qualit/);
  });

  it("two references to the SAME quality compare fine", () => {
    const c: EvalContext = {
      scopes: { deck: { debt: "confronted" }, story: { debt_seen: "troubled" } },
      qualities: (_s, n) => (n === "debt" || n === "debt_seen" ? LADDER : undefined),
    };
    expect(run("@deck.debt > @story.debt_seen", c)).toBe(true);
  });

  it("without the channel nothing changes: ordering still refuses strings", () => {
    expect(() => run('@deck.debt >= "confronted"', ctx({ debt: "resolved" }, false))).toThrow(/numeric/);
  });

  it("arithmetic on a quality is an error, not string concatenation", () => {
    expect(() => run('@deck.debt + "x"', ctx({ debt: "confronted" }))).toThrow(EvalError);
    expect(() => run('@deck.debt + "x"', ctx({ debt: "confronted" }))).toThrow(/quality/);
  });
});

describe("advance, the core built-in", () => {
  it("returns the next stage in the ladder", () => {
    expect(run("advance(@deck.debt)", ctx({ debt: "troubled" }))).toBe("confronted");
    expect(run("advance(@deck.debt)", ctx({ debt: "confronted" }))).toBe("resolved");
  });

  it("saturates at the last stage rather than running off the end", () => {
    expect(run("advance(@deck.debt)", ctx({ debt: "resolved" }))).toBe("resolved");
  });

  it("needs a quality reference: anything else is an error", () => {
    expect(() => run('advance("troubled")', ctx({ debt: "troubled" }))).toThrow(EvalError);
    expect(() => run("advance(@deck.other)", ctx({ debt: "troubled", other: "x" } as never))).toThrow(/quality/);
    expect(() => run("advance(@deck.debt)", ctx({ debt: "troubled" }, false))).toThrow(/quality/);
  });

  it("a stray current value (a drifted save) is an error naming the value", () => {
    expect(() => run("advance(@deck.debt)", ctx({ debt: "ghost" }))).toThrow(/ghost/);
  });

  it("is core, not dialect: this dialect declared no functions at all", () => {
    // the dialect above has `functions: {}`; advance still resolves
    expect(run("advance(@deck.debt)", ctx({ debt: "troubled" }))).toBe("confronted");
  });
});

describe("static validation", () => {
  const schema: ExpressionSchema = {
    properties: new Map([
      ["deck", new Map([
        ["debt", { type: "quality" as const, stages: LADDER }],
        ["mood", { type: "quality" as const, stages: ["low", "level", "high"] }],
        ["heat", { type: "number" as const }],
      ])],
    ]),
  };

  it("accepts an ordering comparison against a known stage", () => {
    const r = parseAndValidate('@deck.debt >= "confronted"', schema, dialect);
    expect(r.issues).toEqual([]);
  });

  it("flags a comparison against a name that is not a stage", () => {
    const r = parseAndValidate('@deck.debt >= "tpyo"', schema, dialect);
    expect(r.ok).toBe(false);
    expect(r.issues.map((i) => i.message).join()).toContain("tpyo");
  });

  it("accepts equality against a known stage - the natural 'exactly here' gate", () => {
    expect(parseAndValidate('@deck.debt == "troubled"', schema, dialect).issues).toEqual([]);
    expect(parseAndValidate('@deck.debt != "resolved"', schema, dialect).issues).toEqual([]);
  });

  it("flags equality against a name that is not a stage - it could never be true", () => {
    const r = parseAndValidate('@deck.debt == "tpyo"', schema, dialect);
    expect(r.ok).toBe(false);
    expect(r.issues.map((i) => i.kind)).toContain("unknown-stage");
    expect(r.issues.map((i) => i.message).join()).toContain("tpyo");
  });

  it("flags equality between two different qualities", () => {
    const r = parseAndValidate("@deck.debt == @deck.mood", schema, dialect);
    expect(r.ok).toBe(false);
    expect(r.issues.map((i) => i.message).join()).toContain("different qualities");
  });

  it("flags equality between a quality and a number", () => {
    const r = parseAndValidate("@deck.debt == 2", schema, dialect);
    expect(r.ok).toBe(false);
  });

  it("flags ordering between a quality and a number", () => {
    const r = parseAndValidate("@deck.debt >= 3", schema, dialect);
    expect(r.ok).toBe(false);
  });

  it("flags arithmetic on a quality", () => {
    const r = parseAndValidate("@deck.debt + 1", schema, dialect);
    expect(r.ok).toBe(false);
  });

  it("accepts advance on a quality and flags it on anything else", () => {
    expect(parseAndValidate("advance(@deck.debt)", schema, dialect).issues).toEqual([]);
    const r = parseAndValidate("advance(@deck.heat)", schema, dialect);
    expect(r.ok).toBe(false);
    expect(r.issues.map((i) => i.message).join()).toContain("quality");
  });

  it("still calls an unknown function unknown, so advance did not blanket-open the namespace", () => {
    const r = parseAndValidate("retreat(@deck.debt)", schema, dialect);
    expect(r.ok).toBe(false);
    expect(r.issues.map((i) => i.message).join()).toContain("retreat");
  });
});
