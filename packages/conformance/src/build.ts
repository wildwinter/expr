// ---------------------------------------------------------------------------
// Compile the authored fixtures into the portable corpus.
//
// The only thing compiled is `src` -> `ast`: the expectations are carried
// through untouched, because they are the contract. Ports consume `ast` and
// never parse, so the parser is not part of what a port is held to.
// ---------------------------------------------------------------------------

import { compile } from "@wildwinter/expr";
import { conformanceDialect } from "./dialect.js";
import type { Corpus, Fixtures } from "./types.js";

/** Bumped when the corpus gains cases or changes shape. */
export const CORPUS_VERSION = 2;   // 2: the registry family

export function buildCorpus(fixtures: Fixtures): Corpus {
  return {
    version: CORPUS_VERSION,
    prng: fixtures.prng.map((f) => ({ ...f })),
    expressions: fixtures.expressions.map((f) => ({
      name: f.name,
      src: f.src,
      ast: compile(f.src, conformanceDialect).ast,
      scopes: f.scopes,
      ...(f.expectError ? { expectError: true as const } : { expected: f.expected }),
    })),
    registry: fixtures.registry.map((f) => ({ ...f })),
  };
}
