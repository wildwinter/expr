// ---------------------------------------------------------------------------
// The authored fixtures: the parity contract, hand-written.
//
// Contract-first, which here is not a formality. Every expectation below was
// derived from the language's stated rules, not read off a running evaluator:
//
//   - the PRNG numbers come from an independent BigInt implementation written
//     from ECMA-262 7.1.6 (ToUint32) and mulberry32's published form, then
//     cross-checked against the host's own `seed >>> 0` on every seed
//     JavaScript can represent. They are not copied from any port.
//   - the expression expectations are read off evaluate.ts's documented rules
//     (operator typing, short-circuiting, value equality, comparison), not
//     produced by running it.
//
// The corpus is DIALECT-FREE by construction. No case calls a function, and
// every case populates every scope property it reads, so nothing here depends
// on which dialect a runtime ships or what its missing-property policy is.
// Both product families can therefore run this today, through the evaluator
// they already have, without separating dialect from evaluator first.
//
// Scopes used: `@v` and `@w` are ordinary populated bags. `@gone` is never
// supplied by any case - referencing it exercises the core's own rule that an
// ABSENT scope resolves to false, which is not a dialect decision.
// ---------------------------------------------------------------------------

import type { Fixtures } from "./types.js";

export const fixtures: Fixtures = {
  // -- PRNG: seed coercion, then the state and draw sequence ----------------
  //
  // Two things are pinned here that the ports have already drifted on.
  //
  // `expectSeedState` is JS ToUint32. A port that casts the seed straight to a
  // 32-bit integer agrees on every seed a game would realistically pass and is
  // undefined behaviour on the rest, which is how the last divergence hid.
  //
  // `expectStates` pins the state as UNSIGNED. The draws do not care - signed
  // and unsigned accumulation produce bit-identical draws - but the state is
  // what a save persists, so a runtime that keeps it signed writes a save its
  // own native ports read back wrong.
  prng: [
  // the default seed
  {
    name: "seed zero",
    seed: 0,
    expectSeedState: 0,
    expectStates: [1831565813, 3663131626, 1199730143, 3031295956],
    expectDraws: [1144304738, 1416247, 958946056, 627933444],
  },
  {
    name: "seed one",
    seed: 1,
    expectSeedState: 1,
    expectStates: [1831565814, 3663131627, 1199730144, 3031295957],
    expectDraws: [2693262067, 11749833, 2265367787, 4213581821],
  },
  {
    name: "seed forty-two",
    seed: 42,
    expectSeedState: 42,
    expectStates: [1831565855, 3663131668, 1199730185, 3031295998],
    expectDraws: [2581720956, 1925393290, 3661312704, 2876485805],
  },
  // two's complement wrap, not a clamp
  {
    name: "seed negative one",
    seed: -1,
    expectSeedState: 4294967295,
    expectStates: [1831565812, 3663131625, 1199730142, 3031295955],
    expectDraws: [3850105811, 813802916, 3073704848, 4054706436],
  },
  {
    name: "seed negative forty-two",
    seed: -42,
    expectSeedState: 4294967254,
    expectStates: [1831565771, 3663131584, 1199730101, 3031295914],
    expectDraws: [380665563, 1024582575, 936117768, 3925118404],
  },
  // truncates towards zero, never rounds
  {
    name: "seed fractional 2.5",
    seed: 2.5,
    expectSeedState: 2,
    expectStates: [1831565815, 3663131628, 1199730145, 3031295958],
    expectDraws: [3153583793, 1395857638, 1225337227, 2310499808],
  },
  // truncates towards zero (-2), then wraps
  {
    name: "seed fractional -2.5",
    seed: -2.5,
    expectSeedState: 4294967294,
    expectStates: [1831565811, 3663131624, 1199730141, 3031295954],
    expectDraws: [677713132, 210922997, 3337126793, 725220637],
  },
  // modulo 2^32 lands back on the zero seed
  {
    name: "seed 2^32",
    seed: 4294967296,
    expectSeedState: 0,
    expectStates: [1831565813, 3663131626, 1199730143, 3031295956],
    expectDraws: [1144304738, 1416247, 958946056, 627933444],
  },
  // and one past it on the seed of 1
  {
    name: "seed 2^32 + 1",
    seed: 4294967297,
    expectSeedState: 1,
    expectStates: [1831565814, 3663131627, 1199730144, 3031295957],
    expectDraws: [2693262067, 11749833, 2265367787, 4213581821],
  },
  // the largest seed that is its own state
  {
    name: "seed uint32 max",
    seed: 4294967295,
    expectSeedState: 4294967295,
    expectStates: [1831565812, 3663131625, 1199730142, 3031295955],
    expectDraws: [3850105811, 813802916, 3073704848, 4054706436],
  },
  // inside int64, so a naive cast still agrees here
  {
    name: "seed 1e18",
    seed: 1000000000000000000,
    expectSeedState: 2808348672,
    expectStates: [344947189, 2176513002, 4008078815, 1544677332],
    expectDraws: [2768649970, 2896632030, 1878583439, 1479682013],
  },
  // OUTSIDE int64: Patterplay's cast is UB, the answer is 2313682944
  {
    name: "seed 1e19",
    seed: 10000000000000000000,
    expectSeedState: 2313682944,
    expectStates: [4145248757, 1681847274, 3513413087, 1050011604],
    expectDraws: [3802796870, 2473517270, 1070484268, 353218858],
  },
  // ECMA-262 ToUint32 sends every non-finite to +0
  {
    name: "seed NaN",
    seed: "NaN",
    expectSeedState: 0,
    expectStates: [1831565813, 3663131626, 1199730143, 3031295956],
    expectDraws: [1144304738, 1416247, 958946056, 627933444],
  },
  // not a clamp to uint32 max, which is what a naive cast gives
  {
    name: "seed Infinity",
    seed: "Infinity",
    expectSeedState: 0,
    expectStates: [1831565813, 3663131626, 1199730143, 3031295956],
    expectDraws: [1144304738, 1416247, 958946056, 627933444],
  },
  {
    name: "seed -Infinity",
    seed: "-Infinity",
    expectSeedState: 0,
    expectStates: [1831565813, 3663131626, 1199730143, 3031295956],
    expectDraws: [1144304738, 1416247, 958946056, 627933444],
  },
  ],

  // -- Expressions ----------------------------------------------------------
  //
  // The shared bags. Every property a case reads is declared here, so no case
  // ever reaches a dialect's missing-property policy.
  expressions: (() => {
    const scopes = {
      v: {
        n: 3,
        zero: 0,
        neg: -2,
        s: "ab",
        t: "cd",
        yes: true,
        no: false,
        tags: ["red", "blue"],
      },
      w: {
        n: 5,
        s: "ab",
        tags: ["red", "blue"],
        reordered: ["blue", "red"],
        longer: ["red", "blue", "green"],
        swapped: ["red", "green"],
        dupe: ["red", "red"],
        empty: [] as string[],
      },
    };
    const c = (
      name: string,
      src: string,
      rest: { expected?: import("./types.js").ScopeBag[string]; expectError?: true },
    ) => ({ name, src, scopes, ...rest });

    return [
      // --- short-circuiting -------------------------------------------------
      //
      // The decisive four. `@v.zero` is 0, so `@v.n / @v.zero` is a division by
      // zero, which the evaluator refuses. Wrapped in a comparison it is a
      // boolean-typed operand, so the ONLY reason these first two do not raise
      // is that the right operand is never evaluated at all. A port that
      // evaluates both sides before testing the left passes plenty of `and`
      // cases and fails exactly here.
      c("and short-circuits on a false left", "@v.no and (@v.n / @v.zero > 1)", { expected: false }),
      c("or short-circuits on a true left", "@v.yes or (@v.n / @v.zero > 1)", { expected: true }),
      c("and does not short-circuit on a true left", "@v.yes and (@v.n / @v.zero > 1)", { expectError: true }),
      c("or does not short-circuit on a false left", "@v.no or (@v.n / @v.zero > 1)", { expectError: true }),
      c("and returns the right operand when the left is true", "@v.yes and @v.no", { expected: false }),
      c("or returns the right operand when the left is false", "@v.no or @v.yes", { expected: true }),

      // --- operator typing: the logical operators ---------------------------
      //
      // Boolean operands only. No truthiness anywhere in this language: a
      // non-zero number is not a true, and a non-empty string is not a true.
      c("and rejects a numeric left", "@v.n and @v.yes", { expectError: true }),
      c("and rejects a numeric right", "@v.yes and @v.n", { expectError: true }),
      c("or rejects a numeric left", "@v.n or @v.yes", { expectError: true }),
      c("or rejects a string right", "@v.no or @v.s", { expectError: true }),
      c("not rejects a number", "not @v.n", { expectError: true }),
      c("not rejects a string", "not @v.s", { expectError: true }),
      c("not negates a boolean", "not @v.no", { expected: true }),
      c("unary minus rejects a boolean", "-@v.yes", { expectError: true }),
      c("unary minus rejects a string", "-@v.s", { expectError: true }),
      c("unary minus negates a number", "-@v.n", { expected: -3 }),
      c("unary minus on a negative number", "-@v.neg", { expected: 2 }),

      // --- arithmetic -------------------------------------------------------
      c("addition of two numbers", "@v.n + @w.n", { expected: 8 }),
      c("subtraction of two numbers", "@v.n - @w.n", { expected: -2 }),
      c("multiplication of two numbers", "@v.n * @w.n", { expected: 15 }),
      c("division of two numbers is not integer division", "@v.n / @w.n", { expected: 0.6 }),
      // `+` is the one overloaded operator: two numbers or two strings, never
      // a mix. A port that reaches for its host language's `+` gets "3cd" or
      // "ab5" here instead of an error.
      c("addition concatenates two strings", "@v.s + @v.t", { expected: "abcd" }),
      c("addition rejects a number and a string", "@v.n + @v.s", { expectError: true }),
      c("addition rejects a string and a number", "@v.s + @v.n", { expectError: true }),
      c("addition rejects two booleans", "@v.yes + @v.no", { expectError: true }),
      c("subtraction rejects two strings", "@v.s - @v.t", { expectError: true }),
      c("multiplication rejects a string", "@v.s * @v.n", { expectError: true }),
      c("division by zero is refused", "@v.n / @v.zero", { expectError: true }),
      c("division of zero by a number is fine", "@v.zero / @v.n", { expected: 0 }),

      // --- comparison -------------------------------------------------------
      //
      // Ordering is numeric only. Strings do NOT compare with < or >, which is
      // the rule most likely to be lost in a hand port: every one of these
      // languages will happily order strings if asked.
      c("less than on numbers", "@v.n < @w.n", { expected: true }),
      c("greater than on numbers", "@v.n > @w.n", { expected: false }),
      c("less than or equal, when equal", "@v.n <= @v.n", { expected: true }),
      c("greater than or equal, when equal", "@v.n >= @v.n", { expected: true }),
      c("less than on negatives", "@v.neg < @v.zero", { expected: true }),
      c("ordering rejects two strings", "@v.s < @v.t", { expectError: true }),
      c("ordering rejects two booleans", "@v.no < @v.yes", { expectError: true }),
      c("ordering rejects a number and a string", "@v.n < @v.s", { expectError: true }),
      c("ordering rejects two flag lists", "@v.tags < @w.tags", { expectError: true }),

      // --- value equality ---------------------------------------------------
      //
      // `==` never coerces and never raises. Mismatched types are simply
      // unequal, which is why these are `expected: false` and not
      // `expectError`. Flags compare element-wise, in order, by value: a port
      // that compares them by reference reports false for two identical lists,
      // and one that compares them as sets reports true for a reordering.
      c("numbers compare equal by value", "@v.n == @v.n", { expected: true }),
      c("strings compare equal by value", "@v.s == @w.s", { expected: true }),
      c("booleans compare equal by value", "@v.no == @v.no", { expected: true }),
      c("a number and a string are unequal, not an error", "@v.n == @v.s", { expected: false }),
      c("a number and a boolean are unequal, not an error", "@v.zero == @v.no", { expected: false }),
      c("inequality negates equality", "@v.n != @w.n", { expected: true }),
      c("flags with the same members are equal", "@v.tags == @w.tags", { expected: true }),
      // Flags are a SET. Their stored order is an artefact of the order somebody
      // happened to add things in, which no author can see and none intends, so
      // it must not decide equality. This case said `false` until 2026-09-01 and
      // was the bug: `set_flags(@f, +red) then +blue` compared unequal to the
      // same two flags added the other way round.
      c("flags in a different order are still equal", "@v.tags == @w.reordered", { expected: true }),
      c("flags of different lengths are unequal", "@v.tags == @w.longer", { expected: false }),
      // Same length, different members: order-insensitive must not collapse into
      // "any two lists of the same size match".
      c("flags of the same length with different members are unequal", "@v.tags == @w.swapped", { expected: false }),
      // Compared as MULTISETS, so a duplicate still counts. A well-formed flags
      // value has none, but equality should not be what decides otherwise.
      c("a duplicated flag is not the same as two distinct ones", "@w.dupe == @v.tags", { expected: false }),
      c("an empty flag list equals itself", "@w.empty == @w.empty", { expected: true }),
      c("an empty flag list is not a populated one", "@w.empty == @v.tags", { expected: false }),
      c("flags and a string are unequal, not an error", "@v.tags == @v.s", { expected: false }),
      c("flags and a number are unequal, not an error", "@v.tags == @v.n", { expected: false }),
      c("flags inequality is order-insensitive too", "@v.tags != @w.reordered", { expected: false }),
      c("flags inequality still separates different members", "@v.tags != @w.swapped", { expected: true }),

      // --- scope resolution -------------------------------------------------
      //
      // A scope the context does not carry at all resolves to false, gracefully
      // and without consulting any dialect. This is the core's own rule, and it
      // is what lets a bundle keep working when a host declines to wire up an
      // optional scope.
      c("an absent scope resolves to false", "@gone.anything", { expected: false }),
      c("an absent scope is false, so `not` of it is true", "not @gone.anything", { expected: true }),
      c("an absent scope short-circuits an and", "@gone.anything and (@v.n / @v.zero > 1)", { expected: false }),

      // --- literals and precedence -----------------------------------------
      c("a bare true literal", "true", { expected: true }),
      c("a numeric literal", "7", { expected: 7 }),
      c("a string literal", "\"hi\"", { expected: "hi" }),
      c("multiplication binds tighter than addition", "@v.n + @w.n * 2", { expected: 13 }),
      c("parentheses override precedence", "(@v.n + @w.n) * 2", { expected: 16 }),
      c("and binds tighter than or", "@v.no and @v.yes or @v.yes", { expected: true }),
      c("comparison binds tighter than and", "@v.n < @w.n and @w.n > @v.zero", { expected: true }),
    ];
  })(),

  // -- registry: the scope kernel's `writable` rule -----------------------------
  //
  // Written from the rule as @wildwinter/scoperegistry states it, not read off a
  // bag: a declaration is writable when its own `writable` says so, else when the
  // scope's default says so, else always (`decl.writable ?? scope.writable ??
  // true`). A refusal raises `... is read-only` and leaves the value seeded.
  //
  // Both families reach this rule today - Storylets through its self-backed
  // @world bag, Patter through its host-scope mount - and neither corpus pinned
  // the kernel itself, so a port could drift on it and both engines' corpora
  // would stay green. `expected` is the value READ BACK after the attempt on BOTH
  // outcomes: on a refusal it is the seed, which is what makes "refused"
  // different from "half written".
  registry: [
    // the declaration's own flag, with no scope round it
    { name: "a read-only declaration refuses a write",
      declarations: [{ name: "hp", type: "number", default: 3, writable: false }],
      set: { name: "hp", value: 9 }, expectError: true, expected: 3 },
    { name: "a declaration with no flag takes the write",
      declarations: [{ name: "hp", type: "number", default: 3 }],
      set: { name: "hp", value: 9 }, expected: 9 },
    { name: "a declaration marked writable takes the write",
      declarations: [{ name: "hp", type: "number", default: 3, writable: true }],
      set: { name: "hp", value: 9 }, expected: 9 },
    { name: "a refused write leaves a flags value exactly as seeded",
      declarations: [{ name: "marks", type: "flags", default: ["a"], writable: false }],
      set: { name: "marks", value: ["a", "b"] }, expectError: true, expected: ["a"] },
    { name: "a refusal on one declaration does not touch its neighbour",
      declarations: [
        { name: "hp", type: "number", default: 3, writable: false },
        { name: "mood", type: "string", default: "calm" },
      ],
      set: { name: "mood", value: "tense" }, expected: "tense" },

    // the scope's default, and how a declaration's own flag relates to it
    { name: "a read-only scope default covers a declaration that says nothing",
      scope: { writable: false },
      declarations: [{ name: "hp", type: "number", default: 3 }],
      set: { name: "hp", value: 9 }, expectError: true, expected: 3 },
    { name: "a declaration's own flag overrides a read-only scope default",
      scope: { writable: false },
      declarations: [{ name: "hp", type: "number", default: 3, writable: true }],
      set: { name: "hp", value: 9 }, expected: 9 },
    { name: "a declaration's own flag overrides a writable scope default",
      scope: { writable: true },
      declarations: [{ name: "hp", type: "number", default: 3, writable: false }],
      set: { name: "hp", value: 9 }, expectError: true, expected: 3 },
    { name: "a scope that says nothing is writable",
      scope: {},
      declarations: [{ name: "hp", type: "number", default: 3 }],
      set: { name: "hp", value: 9 }, expected: 9 },
  ],
};
