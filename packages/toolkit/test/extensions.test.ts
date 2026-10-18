// The extensions spec's contract: every hand-written case in conformance/extensions/, run.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  compileEntry, compiledTarget, defaultOf, entryProblems, manifestProblems, mergeExtensionData, mergeTree,
  renameStages, unresolvedProblems, valueProblems,
} from "../src/extensions.js";
import type { FieldDecl, Manifest, Problem, Strategy, TargetDecl } from "../src/extensions.js";

const load = (name: string): any => JSON.parse(readFileSync(new URL(`../conformance/extensions/${name}.json`, import.meta.url), "utf8"));

/** A problem as a case states it: path and code, severity when not an error, options when given. */
const shape = (p: Problem, withOptions: boolean): Record<string, unknown> => ({
  path: p.path, code: p.code,
  ...(p.severity !== "error" ? { severity: p.severity } : {}),
  ...(withOptions && p.options !== undefined ? { options: p.options } : {}),
});
const expected = (e: any): Record<string, unknown> => ({
  path: e.path, code: e.code, ...(e.severity !== undefined && e.severity !== "error" ? { severity: e.severity } : {}),
  ...(e.options !== undefined ? { options: e.options } : {}),
});
const compare = (actual: Problem[], wanted: any[]): void => {
  expect(actual.map((p, i) => shape(p, wanted[i]?.options !== undefined))).toEqual(wanted.map(expected));
  for (const p of actual) expect(p.message.length).toBeGreaterThan(0);
};

describe("manifest", () => {
  for (const c of load("manifest").cases) {
    it(c.name, () => compare(manifestProblems(c.manifest), c.problems));
  }
});

describe("values", () => {
  for (const c of load("values").cases) {
    it(c.name, () => {
      const refs = c.refs === undefined ? undefined : new Set<string>(c.refs);
      const ctx = refs === undefined ? {} : { exists: (kind: string, id: string) => refs.has(`${kind}:${id}`) };
      const problems = c.decl !== undefined
        ? valueProblems(c.decl as FieldDecl, c.value, ctx)
        : entryProblems(c.target as TargetDecl, c.entry, ctx);
      compare(problems, c.problems);
    });
  }
});

describe("defaults, compilation and renames", () => {
  const file = load("defaults");
  for (const c of file.defaults) it(`default: ${c.name}`, () => expect(defaultOf(c.decl)).toEqual(c.default));
  for (const c of file.compile) {
    it(`compile: ${c.name}`, () => {
      expect(compiledTarget(c.target)).toEqual(c.compiled);
      expect(compileEntry(c.target, c.entry) ?? null).toEqual(c.compiledEntry);
    });
  }
  for (const c of file.renames) {
    it(`renames: ${c.name}`, () => {
      const r = renameStages(c.target, c.entry);
      expect(r.entry).toEqual(c.renamed);
      expect(r.renames).toEqual(c.renames);
    });
  }
});

describe("merge", () => {
  const file = load("merge");
  for (const c of file.tree) {
    it(`tree: ${c.name}`, () => {
      const r = mergeTree(c.strategy as Strategy, c.base, c.ours, c.theirs);
      expect(r.merged).toEqual(c.merged);
      expect(r.conflicts.map((x) => ({ path: x.path, kind: x.kind }))).toEqual(c.conflicts);
    });
  }
  for (const c of file.data) {
    it(`data: ${c.name}`, () => {
      const manifest = c.manifest === null ? undefined : (c.manifest ?? file.manifest) as Manifest;
      const r = mergeExtensionData(c.base, c.ours, c.theirs, { host: "storylets", ...(manifest ? { manifest } : {}) });
      expect(r.merged).toEqual(c.merged);
    });
  }
  it("the shared manifest is itself sound", () => expect(manifestProblems(file.manifest)).toEqual([]));
  for (const c of file.unresolved) {
    it(`unresolved: ${c.name}`, () => compare(unresolvedProblems(c.shard), c.problems));
  }
});
