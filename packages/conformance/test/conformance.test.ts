// ---------------------------------------------------------------------------
// Build the corpus from the authored fixtures, check it is well formed, write
// it out as corpus.json (the portable artifact every port consumes), and
// replay every case through the reference runtime.
//
// The expectations were written from the language's rules, not read off the
// evaluator, so this is the evaluator being held to the contract rather than
// the contract being derived from the evaluator.
//
// It also PROBES the runners: this family has shipped several checks that
// could not fail, so each runner is handed a case it must reject. A corpus
// whose runner always returns "pass" is worse than no corpus, because it reads
// as coverage.
// ---------------------------------------------------------------------------

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildCorpus } from "../src/build.js";
import { fixtures } from "../src/cases.js";
import { runExpressionCase, runPrngCase, seedValue } from "../src/runner.js";
// toUint32 comes from the PACKAGE, so this test holds the shipped one to the
// contract rather than a copy kept beside it.
import { toUint32 } from "@wildwinter/expr";
import type { PrngCase } from "../src/types.js";

const corpus = buildCorpus(fixtures);
const corpusPath = fileURLToPath(new URL("../corpus.json", import.meta.url));

describe("corpus shape", () => {
  it("case names are unique within each family", () => {
    for (const family of ["prng", "expressions"] as const) {
      const names = corpus[family].map((c) => c.name);
      expect(new Set(names).size, family).toBe(names.length);
    }
  });

  it("every expression case carries a compiled ast", () => {
    for (const c of corpus.expressions) expect(Array.isArray(c.ast), c.name).toBe(true);
  });

  it("expression cases carry exactly one of expected / expectError", () => {
    for (const c of corpus.expressions) {
      const hasExpected = c.expected !== undefined;
      expect(hasExpected !== (c.expectError === true), c.name).toBe(true);
    }
  });

  it("both outcomes are represented, so neither path is untested", () => {
    expect(corpus.expressions.some((c) => c.expectError)).toBe(true);
    expect(corpus.expressions.some((c) => c.expected !== undefined)).toBe(true);
  });

  it("prng expectations are uint32 and the two sequences are the same length", () => {
    const isUint32 = (n: number) => Number.isInteger(n) && n >= 0 && n <= 4294967295;
    for (const c of corpus.prng) {
      expect(isUint32(c.expectSeedState), `${c.name} seed state`).toBe(true);
      expect(c.expectStates.length, c.name).toBe(c.expectDraws.length);
      expect(c.expectStates.length, c.name).toBeGreaterThan(0);
      for (const n of [...c.expectStates, ...c.expectDraws]) {
        expect(isUint32(n), `${c.name}: ${n}`).toBe(true);
      }
    }
  });

  it("the non-finite seeds travel as strings, since JSON has no literal", () => {
    const seeds = corpus.prng.map((c) => c.seed);
    for (const s of ["NaN", "Infinity", "-Infinity"]) expect(seeds).toContain(s);
    // And they all coerce to +0, which is the ECMA-262 rule a naive cast misses.
    for (const c of corpus.prng) {
      if (typeof c.seed === "string") expect(c.expectSeedState, c.name).toBe(0);
    }
  });
});

describe("the reference runtime meets the contract", () => {
  it("passes every prng case", () => {
    const fails = corpus.prng.flatMap(runPrngCase);
    expect(fails).toEqual([]);
  });

  it("passes every expression case", () => {
    const fails = corpus.expressions.flatMap(runExpressionCase);
    expect(fails).toEqual([]);
  });
});

// --- the runners are probed, not trusted -----------------------------------

describe("the runners can actually fail", () => {
  const first = corpus.prng[0]!;

  it("rejects a wrong seed state", () => {
    const broken: PrngCase = { ...first, expectSeedState: first.expectSeedState + 1 };
    expect(runPrngCase(broken).length).toBeGreaterThan(0);
  });

  it("rejects a wrong draw", () => {
    const draws = [...first.expectDraws];
    draws[0] = (draws[0]! + 1) >>> 0;
    expect(runPrngCase({ ...first, expectDraws: draws }).length).toBeGreaterThan(0);
  });

  it("rejects a SIGNED state, which is the divergence the section exists for", () => {
    // What a `| 0` runtime would persist for each of these states.
    const signed = first.expectStates.map((s) => s | 0);
    // The case is only a real probe if signed and unsigned actually differ.
    expect(signed).not.toEqual(first.expectStates);
    expect(runPrngCase({ ...first, expectStates: signed }).length).toBeGreaterThan(0);
  });

  it("rejects a value where an error was contracted", () => {
    const c = corpus.expressions.find((x) => x.expectError)!;
    const { expectError, ...rest } = c;
    expect(runExpressionCase({ ...rest, expected: true }).length).toBeGreaterThan(0);
  });

  it("rejects an error where a value was contracted", () => {
    const c = corpus.expressions.find((x) => !x.expectError)!;
    expect(runExpressionCase({ ...c, expectError: true }).length).toBeGreaterThan(0);
  });

  it("rejects a wrong expected value", () => {
    const c = corpus.expressions.find((x) => x.expected === true)!;
    expect(runExpressionCase({ ...c, expected: false }).length).toBeGreaterThan(0);
  });

  it("compares flags as a SET, and still separates different members", () => {
    // Order must not matter...
    const reordered = corpus.expressions.find((x) => x.name === "flags in a different order are still equal")!;
    expect(runExpressionCase(reordered)).toEqual([]);
    expect(runExpressionCase({ ...reordered, expected: false }).length).toBeGreaterThan(0);
    // ...but order-insensitive must not decay into "same length matches".
    const swapped = corpus.expressions.find((x) => x.name === "flags of the same length with different members are unequal")!;
    expect(runExpressionCase(swapped)).toEqual([]);
    expect(runExpressionCase({ ...swapped, expected: true }).length).toBeGreaterThan(0);
    // ...and a duplicate is still not two distinct members.
    const dupe = corpus.expressions.find((x) => x.name === "a duplicated flag is not the same as two distinct ones")!;
    expect(runExpressionCase(dupe)).toEqual([]);
  });
});

// --- the seed coercion, stated independently of the corpus -----------------

describe("ToUint32 matches the host's own >>> 0 wherever JS can express it", () => {
  it("agrees on every finite corpus seed", () => {
    for (const c of corpus.prng) {
      if (typeof c.seed !== "number") continue;
      expect(toUint32(seedValue(c.seed)), c.name).toBe(c.seed >>> 0);
    }
  });

  it("sends every non-finite seed to zero, not to uint32 max", () => {
    for (const seed of [NaN, Infinity, -Infinity]) expect(toUint32(seed)).toBe(0);
  });
});

describe("corpus.json", () => {
  it("is written out for the ports to consume", () => {
    writeFileSync(corpusPath, JSON.stringify(corpus, null, 2) + "\n");
    expect(corpus.prng.length).toBeGreaterThan(0);
    expect(corpus.expressions.length).toBeGreaterThan(0);
  });
});
