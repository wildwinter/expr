// ---------------------------------------------------------------------------
// mulberry32 - the contractual PRNG.
//
// A fixed, published algorithm that both product families need and neither
// owns. It lived in `@storylet-studio/runtime` as prng.ts and inline in
// `@patterkit/runtime`'s engine.ts, plus separately in three of Patterplay's
// harnesses, plus a hand port in each of six native runtimes: thirteen copies
// of forty lines. It belongs here, in the package both families already depend
// on, for the same reason the evaluator does.
//
// All arithmetic is unsigned 32-bit, matching JavaScript's `>>> 0` and
// Math.imul.
// ---------------------------------------------------------------------------

export interface Prng {
  /** One draw in [0, 1); advances the state. */
  next(): number;
  /** The persisted state (a uint32; feed back into makePrng to restore). */
  state(): number;
}

/**
 * ECMA-262 7.1.6 ToUint32, which is what `seed >>> 0` means.
 *
 * Written out rather than spelled `seed >>> 0` because THIS is the obligation a
 * port in a language without JavaScript's shift semantics has to reproduce, and
 * the shorthand hides it. Patterplay's C++ port cast the seed straight to an
 * integer type, which is undefined behaviour outside that type's range and gave
 * two wrong answers before the parity corpus pinned them.
 */
export function toUint32(seed: number): number {
  if (Number.isNaN(seed) || !Number.isFinite(seed)) return 0;
  const modded = Math.trunc(seed) % 4294967296;
  return modded < 0 ? modded + 4294967296 : modded;
}

/**
 * Seed a generator. The state is UNSIGNED throughout (`>>> 0`, never `| 0`):
 * the two produce identical draws and differ only in the sign of the number a
 * save persists, and Patterplay shipped `| 0` for long enough that over half of
 * all its saves carried a negative state its own native ports could not read
 * back.
 */
export function makePrng(seed: number): Prng {
  let s = toUint32(seed);
  return {
    next(): number {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    state(): number {
      return s;
    },
  };
}

/** The contractual shuffle: Fisher-Yates, descending. Runs of one element
 *  consume no draws (the loop never executes for length < 2). */
export function shuffleInPlace<T>(arr: T[], prng: Prng): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(prng.next() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
}
