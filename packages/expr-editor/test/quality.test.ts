// ---------------------------------------------------------------------------
// The editor's side of the `quality` type (the engine shipped it in 0.4.0). A quality is a story
// stage on an ORDERED ladder, so the editor owes it three things an enum does not need: the full
// comparison set (the type exists for "at or past a stage"), its stages offered in ladder order
// wherever a value is picked, and outcomes that step the ladder rather than naming a destination.
//
// Until 0.11.0 the editor did none of it - worse, `comparisonWizard` did not even OFFER a quality
// property, so a host could declare one and then be unable to build a condition on it through the
// visual editor at all. These tests pin the contract that closes that.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { choicesOf, type CatalogueEntry } from "../src/schema.js";
import { COMPARABLE_TYPES, COMPARISON_OPS, EQUALITY_OPS, comparisonOpsFor, rhsTypesFor } from "../src/ops.js";
import { seedValueSrc } from "../src/effects.js";

const quality: CatalogueEntry = {
  scope: "patter", name: "negotiation", type: "quality",
  stages: ["not_started", "underway", "done", "aftermath"],
};
const enumEntry: CatalogueEntry = { scope: "patter", name: "mood", type: "enum", enumValues: ["calm", "tense"] };

describe("choicesOf: the one place a closed value list is resolved", () => {
  it("gives a quality its stages, in ladder order", () => {
    expect(choicesOf(quality)).toEqual(["not_started", "underway", "done", "aftermath"]);
  });

  it("gives an enum its values, and everything else nothing", () => {
    expect(choicesOf(enumEntry)).toEqual(["calm", "tense"]);
    expect(choicesOf({ type: "string" })).toBeUndefined();
    expect(choicesOf({ type: "number" })).toBeUndefined();
    expect(choicesOf({ type: "flags", enumValues: ["a"] })).toBeUndefined();
    expect(choicesOf(null)).toBeUndefined();
  });

  it("still reads a quality whose host passes its ladder the OLD way, through enumValues", () => {
    // Patter shipped exactly this before `stages` existed on the entry; it must not regress to
    // free-text when a host has not yet moved over.
    const legacy: CatalogueEntry = { scope: "patter", name: "q", type: "quality", enumValues: ["a", "b"] };
    expect(choicesOf(legacy)).toEqual(["a", "b"]);
  });
});

describe("the clause vocabulary a property type offers", () => {
  it("offers a quality as a comparison subject at all (it was omitted before 0.11.0)", () => {
    // The regression that mattered most: a host could declare a quality and then find no way to build
    // a condition on it in the visual editor, because the wizard's picker never listed it.
    expect(COMPARABLE_TYPES).toContain("quality");
  });

  it("gives a quality the ORDERING operators, like a number", () => {
    expect(comparisonOpsFor("quality")).toEqual(COMPARISON_OPS);
    expect(comparisonOpsFor("quality")).toContain(">=");
  });

  it("still gives the unordered types equality only", () => {
    expect(comparisonOpsFor("enum")).toEqual(EQUALITY_OPS);
    expect(comparisonOpsFor("string")).toEqual(EQUALITY_OPS);
    expect(comparisonOpsFor("boolean")).toEqual(EQUALITY_OPS);
    expect(comparisonOpsFor("number")).toEqual(COMPARISON_OPS);
  });

  it("compares a quality only against another quality", () => {
    // A bare string would name a stage nothing validates; cross-ladder ordering is an engine error.
    expect(rhsTypesFor("quality")).toEqual(["quality"]);
    expect(rhsTypesFor("enum")).toEqual(["enum", "string"]);
  });
});

describe("seedValueSrc: what a freshly targeted outcome starts as", () => {
  it("seeds a quality with advance(ref) - the insertion-safe form", () => {
    // Naming a destination is what makes a ladder brittle: advance() routes through whatever the
    // ladder says is next, so a stage inserted later needs no edit here.
    expect(seedValueSrc("quality", choicesOf(quality), "@negotiation")).toBe("advance(@negotiation)");
  });

  it("falls back to the first stage when no ref is available", () => {
    expect(seedValueSrc("quality", choicesOf(quality))).toBe('"not_started"');
  });

  it("leaves the other types alone", () => {
    expect(seedValueSrc("boolean")).toBe("true");
    expect(seedValueSrc("number")).toBe("0");
    expect(seedValueSrc("string")).toBe('""');
    expect(seedValueSrc("enum", ["calm", "tense"])).toBe('"calm"');
  });
});
