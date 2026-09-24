// ---------------------------------------------------------------------------
// The reference runners, one per case kind.
//
// A port re-implements these two in its own language and drives them from
// corpus.json. This file is the normative statement of what that means: if a
// port's runner does something these do not, the port is testing something
// else. See README.md for the obligations in prose.
//
// Each returns a list of failure strings (empty = pass), so one run reports
// every divergence rather than the first.
// ---------------------------------------------------------------------------

import { deserialiseAst, evaluate, makePrng, toUint32 } from "@wildwinter/expr";
import type { EvalContext, ScalarValue } from "@wildwinter/expr";
import { conformanceDialect } from "./dialect.js";
import type { ExpressionCase, PrngCase, SeedLiteral } from "./types.js";

/** A seed as the corpus carries it -> the double the algorithm is given. */
export function seedValue(seed: SeedLiteral): number {
  if (seed === "Infinity") return Infinity;
  if (seed === "-Infinity") return -Infinity;
  if (seed === "NaN") return NaN;
  return seed;
}

/**
 * The reference implementation is `@wildwinter/expr`'s own, not a copy kept
 * beside the corpus. A corpus that pins a PRNG against a private copy of that
 * PRNG proves nothing about the package everyone actually uses.
 */
export function runPrngCase(c: PrngCase): string[] {
  const fails: string[] = [];
  const seed = seedValue(c.seed);
  const prng = makePrng(seed);

  if (prng.state() !== c.expectSeedState) {
    fails.push(`${c.name}: seed state ${prng.state()}, expected ${c.expectSeedState}`);
  }
  if (toUint32(seed) !== c.expectSeedState) {
    fails.push(`${c.name}: toUint32 gave ${toUint32(seed)}, expected ${c.expectSeedState}`);
  }
  for (let i = 0; i < c.expectStates.length; i++) {
    const draw = prng.next();
    // The corpus pins the draw's NUMERATOR, an exact uint32, so no port is held
    // to another language's float printing.
    const numerator = Math.round(draw * 4294967296);

    if (prng.state() !== c.expectStates[i]) {
      fails.push(`${c.name}: state after draw ${i + 1} is ${prng.state()}, expected ${c.expectStates[i]}`);
    }
    if (numerator !== c.expectDraws[i]) {
      fails.push(`${c.name}: draw ${i + 1} is ${numerator}, expected ${c.expectDraws[i]}`);
    }
    // The draw a caller actually sees must be in [0, 1). Pinned here so a port
    // cannot pass the integer checks while handing its caller something else.
    if (!(draw >= 0 && draw < 1)) fails.push(`${c.name}: draw ${i + 1} is ${draw}, outside [0, 1)`);
  }
  return fails;
}

const show = (v: unknown): string => JSON.stringify(v);

/** Value equality as `==` means it: element-wise for flags, by value otherwise. */
export function valueEquals(a: ScalarValue | undefined, b: ScalarValue | undefined): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    return a.length === b.length && a.every((x, i) => x === b[i]);
  }
  return a === b;
}

/**
 * Evaluate `ast` against `scopes`. A case carries either `expected` or
 * `expectError`; an error where a value was expected fails, and so does a
 * value where an error was expected. The SECOND half matters as much as the
 * first: a runtime that never raises passes every `expected` case and is
 * wrong about the whole typing contract.
 */
export function runExpressionCase(c: ExpressionCase): string[] {
  const ctx: EvalContext = { scopes: c.scopes };
  let value: ScalarValue | undefined;
  let error: string | undefined;
  try {
    value = evaluate(deserialiseAst(c.ast), ctx, conformanceDialect);
  } catch (e) {
    error = String(e);
  }

  if (c.expectError) {
    return error === undefined
      ? [`${c.name}: expected an eval error, got ${show(value)}`]
      : [];
  }
  if (error !== undefined) return [`${c.name}: unexpected error: ${error}`];
  return valueEquals(value, c.expected)
    ? []
    : [`${c.name}: expected ${show(c.expected)}, got ${show(value)}`];
}
