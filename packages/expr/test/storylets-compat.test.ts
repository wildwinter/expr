// ---------------------------------------------------------------------------
// Storylets compatibility corpus.
//
// Runs the agnostic core against the reconstructed storylets Dialect and asserts
// the behaviours storylets relies on today: the world default scope, the
// site/zone "missing -> throw" policy, and all six built-in functions. This is
// the regression gate that proves the extraction supports storylets migration.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { parse, unparse, evaluate, serialiseAst, EvalError } from "../src/index.js";
import type { EvalContext } from "../src/index.js";
import { storyletsDialect as D } from "./storylets-dialect.js";

const ctx = (scopes: EvalContext["scopes"], host?: Record<string, unknown>): EvalContext => ({ scopes, host });

describe("storylets dialect - scopes", () => {
  it("bare @name is world scope", () => {
    expect(parse("@season", D)).toEqual({ kind: "scopedvar", scope: "world", name: "season" });
    expect(unparse(parse("@season", D), { defaultScope: "world" })).toBe("@season");
  });

  it("supports all eight scope tokens", () => {
    for (const s of ["world", "deck", "act", "zone", "site", "story", "player", "system"]) {
      expect(parse(`@${s}.x`, D)).toEqual({ kind: "scopedvar", scope: s, name: "x" });
    }
  });

  it("world/deck/act/story missing prop -> false; site/zone missing prop -> throw", () => {
    expect(evaluate(parse("@world.unknown", D), ctx({ world: {} }), D)).toBe(false);
    expect(evaluate(parse("@story.unknown", D), ctx({ story: {} }), D)).toBe(false);
    expect(() => evaluate(parse("@site.unknown", D), ctx({ site: {} }), D)).toThrow(EvalError);
    expect(() => evaluate(parse("@zone.unknown", D), ctx({ zone: {} }), D)).toThrow(EvalError);
    // absent scope is always graceful-false, even for site/zone
    expect(evaluate(parse("@site.unknown", D), ctx({}), D)).toBe(false);
  });
});

describe("storylets dialect - built-in functions", () => {
  it("site_has_tag", () => {
    const host = { siteHasTag: (t: string) => t === "indoors" };
    expect(evaluate(parse("site_has_tag('indoors')", D), ctx({}, host), D)).toBe(true);
    expect(evaluate(parse("site_has_tag('outdoors')", D), ctx({}, host), D)).toBe(false);
    expect(evaluate(parse("site_has_tag('x')", D), ctx({}), D)).toBe(false); // no host -> false
  });

  it("random is inclusive and uses the host PRNG", () => {
    expect(evaluate(parse("random(1, 6)", D), ctx({}, { nextRandom: () => 0 }), D)).toBe(1);
    expect(evaluate(parse("random(1, 6)", D), ctx({}, { nextRandom: () => 0.5 }), D)).toBe(4);
    expect(evaluate(parse("random(1, 6)", D), ctx({}, { nextRandom: () => 0.999 }), D)).toBe(6);
    expect(() => evaluate(parse("random(1, 6)", D), ctx({}), D)).toThrow(/without a PRNG/);
  });

  it("count_played_tag / turns_since_tag defaults", () => {
    expect(evaluate(parse("count_played_tag('x')", D), ctx({}), D)).toBe(0);
    expect(evaluate(parse("turns_since_tag('x')", D), ctx({}), D)).toBe(9999);
    expect(evaluate(parse("count_played_tag('x')", D), ctx({}, { countPlayedTag: () => 3 }), D)).toBe(3);
  });

  it("check_flags reads flag-delta args", () => {
    expect(parse("check_flags(@world.q, +met, -found)", D)).toEqual({
      kind: "call", name: "check_flags", args: [
        { kind: "scopedvar", scope: "world", name: "q" },
        { kind: "flagdelta", sign: "+", name: "met" },
        { kind: "flagdelta", sign: "-", name: "found" },
      ],
    });
    const c = ctx({ world: { q: ["met"] } });
    expect(evaluate(parse("check_flags(@world.q, +met)", D), c, D)).toBe(true);
    expect(evaluate(parse("check_flags(@world.q, -met)", D), c, D)).toBe(false);
    expect(evaluate(parse("check_flags(@world.q, +absent)", D), c, D)).toBe(false);
  });

  it("set_flags applies deltas and returns the new array", () => {
    const c = ctx({ world: { q: ["a"] } });
    expect(evaluate(parse("set_flags(@world.q, +b, -a)", D), c, D)).toEqual(["b"]);
  });

  it("serialises the published tagged-tuple form", () => {
    expect(serialiseAst(parse("@season == autumn", D)))
      .toEqual(["bin", "==", ["sv", "world", "season"], ["s", "autumn"]]);
    expect(serialiseAst(parse("check_flags(@world.q, +x)", D)))
      .toEqual(["call", "check_flags", ["sv", "world", "q"], ["fd", "+", "x"]]);
  });
});
