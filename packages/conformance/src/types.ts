// ---------------------------------------------------------------------------
// Conformance corpus types: the cross-language parity contract for
// @wildwinter/expr.
//
// The corpus is a language-agnostic JSON document with two case kinds:
//
//   - prng: a seed -> the coerced initial state, then the state and the draw
//     after each successive call. Pure arithmetic; no evaluator, no dialect.
//   - expressions: a compiled `ast` + `scopes` -> an `expected` scalar, or
//     `expectError`. Cases carry the COMPILED ast, so a runtime-only port
//     consumes the corpus with no parser; `src` is informational.
//   - registry: the scope kernel's own `writable` rule. Declarations, one
//     write, and what the kernel must do with it: refuse it as read-only, or
//     land it. No evaluator involved.
//
// DELIBERATELY DIALECT-FREE. No case calls a dialect function, and every case
// populates every scope it reads, so no case depends on a dialect's function
// set or its missing-property policy. That is what lets both product families
// run this corpus through the evaluator they already ship, today, without
// first separating their dialect from their evaluator.
// ---------------------------------------------------------------------------

import type { AstNode, ScalarValue } from "@wildwinter/expr";

export type ScopeBag = Record<string, ScalarValue>;

/**
 * A seed as JSON can carry it. JSON has no literal for the three non-finite
 * doubles, and they are exactly the interesting coercion cases, so they travel
 * as strings; every other seed is a plain number.
 */
export type SeedLiteral = number | "Infinity" | "-Infinity" | "NaN";

/**
 * One PRNG case: mulberry32 from a seed.
 *
 * Everything here is an unsigned 32-bit integer, so a runtime compares exact
 * integers and never floats. `expectDraws` is the draw's NUMERATOR - a draw is
 * `numerator / 2^32` - because that is the value the algorithm actually
 * computes; dividing and then comparing doubles would put every port at the
 * mercy of its own float printing.
 *
 * `expectStates` is the load-bearing half. The state is what a save persists,
 * and it is UNSIGNED: a runtime that keeps it signed (JavaScript `| 0` rather
 * than `>>> 0`) draws identical numbers and writes a save its own native ports
 * cannot read back.
 */
export interface PrngCase {
  name: string;
  seed: SeedLiteral;
  /** The state immediately after seeding, before any draw: JS `seed >>> 0`. */
  expectSeedState: number;
  /** The state after each successive draw, as a uint32. */
  expectStates: number[];
  /** `round(draw * 2^32)` for each successive draw, as a uint32. */
  expectDraws: number[];
}

/** A compiled expression case. `src` is informational; ports evaluate `ast`. */
export interface ExpressionCase {
  name: string;
  src: string;
  ast: AstNode;
  scopes: Record<string, ScopeBag>;
  /** The expected value. Mutually exclusive with `expectError`. */
  expected?: ScalarValue;
  /** Evaluation must raise an eval error. Mutually exclusive with `expected`. */
  expectError?: true;
}

/**
 * One registry case: the scope kernel's `writable` rule, which both product
 * families reach and neither corpus pinned.
 *
 * The rule, stated once: a declaration is writable when its own `writable`
 * says so, else when the scope's default says so, else always -
 * `decl.writable ?? scope.writable ?? true`. A refused write raises an error
 * whose message contains `is read-only`, and leaves the value exactly as it
 * was seeded.
 *
 * `expected` is the value READ BACK after the attempt, on both outcomes. On a
 * refusal that pins the second half of the rule - a refusal is not a partial
 * write - and on a landed write it pins that the write went where it was
 * aimed.
 */
export interface RegistryCase {
  name: string;
  /** Scope-level default for its declarations. Absent = the bag alone, with
   *  no scope wrapped round it. A port without a registry folds this into each
   *  declaration (see README) - the fold IS the rule. */
  scope?: { writable?: boolean };
  declarations: RegistryDeclaration[];
  set: { name: string; value: ScalarValue };
  /** The write must be refused with an error whose message contains
   *  `is read-only`. */
  expectError?: true;
  /** The value read back after the attempt. */
  expected: ScalarValue;
}

/** A declaration as the corpus carries it: the shared kernel's ScopeDeclaration
 *  shape, restricted to what these cases use. */
export interface RegistryDeclaration {
  name: string;
  type: "boolean" | "number" | "string" | "flags";
  default: ScalarValue;
  writable?: boolean;
}

export interface Corpus {
  version: number;
  prng: PrngCase[];
  expressions: ExpressionCase[];
  registry: RegistryCase[];
}

// --- Authoring fixtures (source form, compiled into the corpus) -------------

/** A PRNG fixture. Identical to the case: the expectations are the contract
 *  and are written out in full, so there is nothing to compile. */
export type PrngFixture = PrngCase;

export interface ExpressionFixture {
  name: string;
  src: string;
  scopes: Record<string, ScopeBag>;
  expected?: ScalarValue;
  expectError?: true;
}

/** A registry fixture is the case: nothing to compile. */
export type RegistryFixture = RegistryCase;

export interface Fixtures {
  prng: PrngFixture[];
  expressions: ExpressionFixture[];
  registry: RegistryFixture[];
}
