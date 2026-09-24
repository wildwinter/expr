// ---------------------------------------------------------------------------
// Build the registry corpus from its cases, check it is well formed, write it
// out as corpus.json (the portable artifact every registry port consumes), and
// replay every case through the reference runner.
//
// The runner is PROBED as well as trusted: each kind of expectation is handed a
// case it must reject. A corpus whose runner always passes is worse than none,
// because it reads as coverage.
// ---------------------------------------------------------------------------

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compile } from "@wildwinter/expr";
import { cases } from "./corpus/cases.js";
import { corpusDialect, runRegistryCase } from "./corpus/runner.js";
import type { RegistryCase, RegistryCorpus, Step } from "./corpus/types.js";

/** Bumped when the corpus gains cases or changes shape. */
export const REGISTRY_CORPUS_VERSION = 1;

function build(): RegistryCorpus {
  return {
    version: REGISTRY_CORPUS_VERSION,
    cases: cases.map((c) => ({
      name: c.name,
      steps: c.steps.map((s): Step => (s.op === "eval" ? { ...s, ast: compile(s.src, corpusDialect).ast } : s)),
    })),
  };
}

const corpus = build();
writeFileSync(fileURLToPath(new URL("../corpus.json", import.meta.url)), `${JSON.stringify(corpus, null, 2)}\n`);

const steps = (): Step[] => corpus.cases.flatMap((c) => c.steps);

describe("registry corpus shape", () => {
  it("case names are unique", () => {
    const names = corpus.cases.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("every case has steps, and every eval step carries a compiled ast", () => {
    for (const c of corpus.cases) expect(c.steps.length, c.name).toBeGreaterThan(0);
    for (const s of steps()) if (s.op === "eval") expect(Array.isArray(s.ast), s.src).toBe(true);
  });

  it("an eval or get step says exactly one thing about its outcome", () => {
    for (const s of steps()) {
      if (s.op === "eval") expect((s.expect !== undefined) !== (s.expectError !== undefined), s.src).toBe(true);
      if (s.op === "get") expect((s.expect !== undefined) !== (s.expectUnset === true), `${s.scope}.${s.name}`).toBe(true);
    }
  });

  it("covers every step kind a port's runner must implement", () => {
    const kinds = new Set(steps().map((s) => s.op));
    for (const k of ["owned", "mount", "foreign", "set", "get", "has", "remove", "save", "load",
      "discardParked", "store", "rows", "eval", "spec"] as const) expect(kinds.has(k), k).toBe(true);
  });

  it("uses no product's token: the registry's contract is product-neutral", () => {
    const tokens = new Set<string>();
    for (const s of steps()) {
      if ("token" in s) tokens.add(s.token.split("/")[0]!);
      if ("scope" in s) tokens.add(s.scope.split("/")[0]!);
    }
    for (const product of ["patter", "scene", "story", "box", "deck", "hand", "party", "dungeon"]) {
      expect(tokens.has(product), product).toBe(false);
    }
  });
});

describe("the reference registry meets the contract", () => {
  for (const c of corpus.cases) {
    it(c.name, () => expect(runRegistryCase(c)).toEqual([]));
  }
});

// --- the runner is probed, not trusted -----------------------------------------

describe("the registry runner can actually fail", () => {
  const probe = (c: RegistryCase): string[] => runRegistryCase(c);
  const base = { owned: { op: "owned", token: "game", declarations: [{ name: "hp", type: "number", default: 10 }] } as Step };

  it("rejects a wrong value", () => {
    expect(probe({ name: "p", steps: [base.owned, { op: "get", scope: "game", name: "hp", expect: 11 }] })).not.toEqual([]);
  });

  it("rejects a value where unset was contracted, and unset where a value was", () => {
    expect(probe({ name: "p", steps: [base.owned, { op: "get", scope: "game", name: "hp", expectUnset: true }] })).not.toEqual([]);
    expect(probe({ name: "p", steps: [base.owned, { op: "get", scope: "game", name: "nope", expect: 0 }] })).not.toEqual([]);
  });

  it("rejects a write that landed where a refusal was contracted", () => {
    expect(probe({ name: "p", steps: [base.owned, { op: "set", scope: "game", name: "hp", value: 1, expectError: "is read-only" }] })).not.toEqual([]);
  });

  it("rejects a refusal where a write was contracted", () => {
    const ro: Step = { op: "owned", token: "game", declarations: [{ name: "hp", type: "number", default: 10, writable: false }] };
    expect(probe({ name: "p", steps: [ro, { op: "set", scope: "game", name: "hp", value: 1 }] })).not.toEqual([]);
  });

  it("rejects an error that does not say what the contract says", () => {
    expect(probe({ name: "p", steps: [{ op: "set", scope: "nowhere", name: "x", value: 1, expectError: "is read-only" }] })).not.toEqual([]);
  });

  it("rejects a wrong save, including a flags list in the wrong order", () => {
    expect(probe({ name: "p", steps: [base.owned, { op: "save", expect: { game: { hp: 9 } } }] })).not.toEqual([]);
    const f: Step = { op: "owned", token: "game", declarations: [{ name: "m", type: "flags", default: ["a", "b"] }] };
    expect(probe({ name: "p", steps: [f, { op: "save", expect: { game: { m: ["b", "a"] } } }] })).not.toEqual([]);
  });

  it("rejects a wrong store, wrong rows, and a wrong owner", () => {
    const fr: Step = { op: "foreign", token: "world", store: { gold: 1 } };
    expect(probe({ name: "p", steps: [fr, { op: "store", scope: "world", expect: { gold: 2 } }] })).not.toEqual([]);
    const withOwner: Step = { op: "owned", token: "game", owner: "X", declarations: [{ name: "hp", type: "number", default: 10 }] };
    const row = { scope: "game", name: "hp", path: "game.hp", value: 10, writable: true };
    expect(probe({ name: "p", steps: [withOwner, { op: "rows", expect: [row] }] })).not.toEqual([]);          // owner missing
    expect(probe({ name: "p", steps: [base.owned, { op: "rows", expect: [{ ...row, owner: "X" }] }] })).not.toEqual([]); // owner invented
  });

  it("rejects a wrong evaluation, and an alias that quietly resolves", () => {
    const m: Step = { op: "mount", token: "k", declarations: [{ name: "seen", type: "boolean", default: true }] };
    const ev = (e: Partial<Extract<Step, { op: "eval" }>>): Step =>
      ({ op: "eval", src: "@here.seen", ast: compile("@here.seen", corpusDialect).ast, ...e });
    expect(probe({ name: "p", steps: [m, ev({ aliases: { here: "k" }, expect: false })] })).not.toEqual([]);
    expect(probe({ name: "p", steps: [m, ev({ aliases: { here: "k" }, expectError: "is not registered" })] })).not.toEqual([]);
  });

  it("rejects a spec read wrongly", () => {
    const src = { scopeRegistrySpec: { version: 1, scopes: [{ token: "world" }] } };
    expect(probe({ name: "p", steps: [{ op: "spec", source: src, expect: { version: 1, tokens: ["game"] } }] })).not.toEqual([]);
    expect(probe({ name: "p", steps: [{ op: "spec", source: src, expectAbsent: true }] })).not.toEqual([]);
  });
});
