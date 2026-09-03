# The expr parity corpus

A language-agnostic JSON corpus that every hand port of `@wildwinter/expr` must
pass, in either product family. `corpus.json` is the artifact; everything else
here is what builds and proves it.

## Why it exists

`@wildwinter/expr` is the one genuinely shared component in this family, and it
is transliterated by hand six times: `{C++, C#, GDScript}` times
`{storylets, patter}`. Until 2026-09-01 nothing anywhere tested its own
semantics.

Each family has a conformance corpus, and each tests its own ENGINE. The
evaluator is reached only incidentally, through dealing a storylet or walking a
scene, so a divergence in `expr` itself failed neither corpus. That is how the
PRNG seed coercion drifted while two C++ headers both claimed to be identical to
the JS runtime.

On the day it was written this corpus found:

- Patterplay's C++ seed cast, undefined behaviour for a double outside `int64_t`
  (the known one, from `design/port-redundancy-audit.md`);
- the same two divergences in the Storylet Engine's **GDScript** port, which the
  audit had ruled correct on the strength of its other three runtimes;
- Patterplay's GDScript evaluator refusing nothing at all: it called
  `push_error()` and returned a fallback value, so `1 / 0` was `0.0` there and
  an error everywhere else. Fixed, and it was the last thing standing between
  the two families and one shared evaluator.

## What it covers

Two sections, both deliberately narrow.

**`prng`** - mulberry32 from a seed. Every number is an unsigned 32-bit integer,
so a runtime compares exact integers and never floats:

- `expectSeedState` is the seed after ECMA-262 `ToUint32`. A port that casts a
  double straight to an integer type agrees on every seed a game would
  realistically pass and is undefined behaviour on the rest, which is how the
  last divergence hid.
- `expectDraws` is the draw's NUMERATOR (a draw is `numerator / 2^32`), because
  that is the value the algorithm actually computes. Dividing first and
  comparing doubles would put every port at the mercy of its own float printing.
- `expectStates` is the state after each draw, and it is **unsigned**. Signed
  and unsigned accumulation produce bit-identical draws, so this looks like
  pedantry; it is not. The state is what a save persists, and a runtime that
  keeps it signed writes a save its own native ports read back wrong.

**`expressions`** - a compiled `ast` plus `scopes`, giving either an `expected`
scalar or `expectError`. Covers operator typing, short-circuiting, value
equality, the comparison rules, and scope absence.

Not covered, and deliberately: the parser (no port has one - bundles ship
compiled ASTs), the quality ladder and `advance()`, and anything dialect-shaped.

**`registry`** (9 cases) pins the scope kernel's `writable` rule, which both
families reach and neither corpus pinned: Storylets through its self-backed
`@world` bag, Patter through its host-scope mount (storylet-studio
`design/joint-demo-findings.md` 9, 2026-09-03). A port could have drifted on it
and both engines' corpora would have stayed green.

The rule, stated once: a declaration is writable when its own `writable` says
so, else when its scope's default says so, else always -
`decl.writable ?? scope.writable ?? true`. A refused write raises an error
whose message contains `is read-only` and leaves the value exactly as seeded.
Every case carries `declarations`, one `set`, and `expected`: the value READ
BACK after the attempt, on both outcomes. On a refusal that is the seed, which
is what separates "refused" from "half written".

Cases without a `scope` are the kernel's declaration-level rule, the bag alone.
Cases with a `scope` are its scope-level rule: a declaration's own flag wins
over the scope default in both directions, and a scope that says nothing is
writable.

## The corpus is dialect-free, and that is load-bearing

No case calls a function, and every case populates every scope property it
reads. So nothing here depends on which dialect a runtime ships or what its
missing-property policy is.

That is what lets both families run this corpus **today**, through the evaluator
they already have. The Storylet Engine separates its dialect from its evaluator;
Patterplay fuses them. A corpus needing a test dialect would have been blocked
on Patterplay splitting its dialect out first, which is a much larger change.

`gone` is the one scope a case names and no case populates. A scope the dialect
knows about and the context does not carry resolves to false in the CORE, before
any missing-property policy is consulted, so the corpus can pin that behaviour
without pinning a policy.

## What a port's runner must do

`src/runner.ts` is the normative version; this is it in prose.

**For a `prng` case:**

1. Seed a generator with `seed`. The three non-finite doubles travel as the
   strings `"NaN"`, `"Infinity"` and `"-Infinity"`, because JSON has no literal
   for them and they are exactly the interesting coercion cases.
2. Compare the state before any draw against `expectSeedState`.
3. Draw `expectStates.length` times. After each draw compare the state against
   `expectStates[i]`, and `round(draw * 2^32)` against `expectDraws[i]`. Assert
   the draw itself is in `[0, 1)`, so a port cannot pass the integer checks
   while handing its caller something else.

**For an `expressions` case:**

1. Deserialise `ast`. Never parse `src`; it is there to be read by people.
2. Build the context from `scopes`. A scope not present in `scopes` must be
   absent from the context, not present and empty.
3. Evaluate, catching whatever your language uses for a refusal.
4. A case carries exactly one of `expected` or `expectError`. An error where a
   value was expected is a failure; **a value where an error was expected is
   equally a failure.** That second half is the whole typing contract: a runtime
   that never raises passes all 42 value cases and is wrong about the language.
5. Compare with value equality, not identity: flags compare element-wise, in
   order. A port comparing by reference reports false for two identical lists;
   one comparing as sets reports true for a reordering. Both are cases here.

**For a `registry` case:**

1. Build the declarations. Each is the shared kernel's ScopeDeclaration shape:
   `name`, `type`, `default`, and an optional `writable`.
2. If the case has no `scope`, seed a PropertyBag from them and call its `set`
   with `set.name` / `set.value`.
3. If it has a `scope` and your runtime has a ScopeRegistry, mount the
   declarations as a FOREIGN scope over a plain record, with `scope.writable`
   (default true) as the scope default, and write through the registry. That
   exercises the registry's own `decl.writable ?? scopeWritable`.
   If your runtime has no registry - Patterplay's ports mount host scopes by
   hand - fold the default first: for each declaration with no `writable` of
   its own, set it to `scope.writable` when that is present. Then run it as a
   bag case. **The fold IS the rule**, and a harness that does it pins the bag
   against the same nine cases; say in the harness that this is the bag being
   pinned, not a registry the port does not have.
4. Catch whatever your language uses for a refusal. `expectError` means the
   write must be refused AND the message must contain `is read-only` (the bag
   says `'x' is read-only`, a registry says `'@scope.x' is read-only`; both
   satisfy it). No `expectError` means any refusal is a failure.
5. Read the value back and compare it to `expected` with value equality, on
   BOTH outcomes.

**And a rule about the fixture itself.** A missing `expr-corpus.json` must be a
FAILURE, not a skip. This codebase has shipped several checks that could not
fail, and a parity gate that quietly does nothing when its fixture is absent is
that shape exactly.

## Where it runs

Authored here, vendored into each consuming repo by
`../../scripts/sync-conformance.mjs`, so a port test host runs with no
assumption that `../expr` is checked out beside it. Each consumer's CI diffs its
vendored copy against this one and fails on drift.

| Runtime | Host |
|---|---|
| JS reference | `test/conformance.test.ts` here |
| Storylets C++ | `storylets/ports/unreal/TestHost` |
| Storylets C# | `storylets/ports/unity/TestHost` |
| Storylets GDScript | `storylets/ports/godot/test/test_corpus.gd` |
| Patter C++ | `patter/ports/unreal/TestHost` |
| Patter C# | `patter/ports/unity/TestHost` |
| Patter GDScript | `patter/ports/godot/test/test_corpus.gd` |

All seven pass all 77 cases. The two Godot ports now run the SAME evaluator:
`expr/ports/godot/expr_eval.gd`, vendored into both addons and byte-identical in
each, with a thin `class_name` shim per family. See
[docs/port-sharing.md](../../docs/port-sharing.md).

## Adding a case

Fixtures live in `src/cases.ts` and expectations are **hand-written from the
language's rules**, never read off a running evaluator. That is the point, not a
formality: an expectation copied from the implementation cannot disagree with
it.

The PRNG numbers came from an independent BigInt implementation written from
ECMA-262 7.1.6 and mulberry32's published form, then cross-checked against the
host's own `seed >>> 0` on every seed JavaScript can represent.

Run `npm test` here to rebuild `corpus.json`, then
`node scripts/sync-conformance.mjs` at the repo root to update the vendored
copies, and commit all three.

Probe anything you add. `test/conformance.test.ts` hands each runner a case it
must reject, because a corpus whose runner always passes is worse than no
corpus: it reads as coverage.
