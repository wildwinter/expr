// ---------------------------------------------------------------------------
// The registry conformance corpus: types.
//
// A language-agnostic JSON document (corpus.json, beside package.json) that every
// ScopeRegistry must pass: the TypeScript package, and each vendored native copy
// (C#, C++, GDScript) in each product that takes one. It is the registry's own
// contract, separate from expr's parity corpus, which is the evaluator's.
//
// A case is a SCRIPT: a fresh registry, then steps run in order, each with what
// must happen. Steps name only registry operations every port has, so a port's
// runner is a small interpreter over this file.
//
// PRODUCT-NEUTRAL BY CONSTRUCTION. No token here belongs to an engine: `game`,
// `world`, `here`, `a`, `b`. The registry knows nothing about Patter, the
// Storylet Engine, Lockstep or any game, and its contract should not either.
// ---------------------------------------------------------------------------

import type { AstNode, PropertyType, ScalarValue } from "@wildwinter/expr";

export type Value = ScalarValue;
export type Blob = Record<string, Record<string, Value>>;

/** A declaration as the corpus carries it: the kernel's ScopeDeclaration. */
export interface Decl {
  name: string;
  type: PropertyType;
  default?: Value;
  values?: string[];
  stages?: string[];
  writable?: boolean;
}

/** One examiner row, the fields every port's row carries. `owner` absent means
 *  the row must carry none. */
export interface RowExpect {
  scope: string;
  owner?: string;
  name: string;
  path: string;
  value: Value;
  writable: boolean;
}

/** `expectError` is a SUBSTRING the error message must contain. The substrings
 *  are part of the contract: every port's messages carry them. */
export type Step =
  /** defineOwned: the registry builds the bag. Rows' default prefix is `<token>.`. */
  | { op: "owned"; token: string; declarations: Decl[]; normalise?: "identity"; pathPrefix?: string; owner?: string; expectError?: string }
  /** mountOwned: the RUNNER builds a PropertyBag (prefix default "") and mounts it,
   *  as an engine mounts an instance bag it holds. */
  | { op: "mount"; token: string; declarations: Decl[]; normalise?: "identity"; pathPrefix?: string; owner?: string; expectError?: string }
  /** defineForeign over a plain map the runner keeps, seeded from `store`. With
   *  `settable: false` the resolver has no set. */
  | { op: "foreign"; token: string; declarations?: Decl[]; writable?: boolean; settable?: false; store?: Record<string, Value>; normalise?: "identity"; owner?: string; expectError?: string }
  | { op: "set"; scope: string; name: string; value: Value; host?: true; expectError?: string }
  /** `expect`, or `expectUnset: true` for a scope or property that is not there. */
  | { op: "get"; scope: string; name: string; expect?: Value; expectUnset?: true }
  | { op: "has"; token: string; expect: boolean }
  | { op: "remove"; token: string; keep?: true; expectError?: string }
  /** Exact: keys, values, flags in order. */
  | { op: "save"; expect: Blob }
  | { op: "load"; blob: Blob }
  | { op: "discardParked" }
  /** The foreign scope's backing map, exactly: proves where a write did or did
   *  not land. */
  | { op: "store"; scope: string; expect: Record<string, Value> }
  /** listProperties, in order, compared on RowExpect's fields. */
  | { op: "rows"; expect: RowExpect[] }
  /** Evaluate `ast` (compiled from `src` when the corpus is built; a port never
   *  parses) against toEvalContext with `aliases`. */
  | { op: "eval"; src: string; ast?: AstNode; aliases?: Record<string, string>; expect?: Value; expectError?: string }
  /** readScopeRegistrySpec on a parsed JSON value. */
  | { op: "spec"; source: unknown; expect?: { version: number; tokens: string[] }; expectAbsent?: true; expectError?: string };

export interface RegistryCase {
  name: string;
  steps: Step[];
}

export interface RegistryCorpus {
  version: number;
  cases: RegistryCase[];
}
