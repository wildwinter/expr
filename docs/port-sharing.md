# Sharing the ports: what can be one implementation, and what cannot

Written 2026-09-01, answering the question
`storylet-studio/design/port-parity-session-brief.md` left open and asked to be
recorded either way: **a game may install both plugins, so can the two families
share port code at all?**

Short answer: **yes, and the mechanism is the same on all three engines.** Do
not share an installed artifact. Share a source of truth, and vendor a copy into
each plugin with that plugin's identity stamped on it at vendor time.

## The constraint, stated precisely

Patterplay and the Storylet Engine can sit in one Unity project, one Unreal
project, one Godot project. Today they do that safely, because they share
nothing: `patter::` and `storylets::`, `Patterkit.Patterplay` and
`StoryletStudio.StoryletEngine`, `Patter*` and `Storylet*` class names.

The collision only appears the moment both vendor something under ONE name. So
the question is not "can we share code" but "can a shared thing avoid declaring
the same name twice". It can.

## What actually collides, per engine

Worth checking rather than assuming, because the three differ and only one is a
hard error.

**C++ (Unreal).** Two header-only copies of `wildwinter::expr` in two modules.
If the vendored text is token-identical, ODR permits it. If the two plugins are
at different versions, it is an ODR violation and the linker picks one silently:
the worst failure mode here, because it is invisible.

**C# (Unity).** Two assemblies may both define `Wildwinter.Expr.Evaluator`
legally; a third assembly referencing both and naming the type unqualified gets
CS0433, and no game would. The hard error is elsewhere and simpler: **Unity
requires assembly definition names to be unique project-wide**, so shipping the
shared code as its own `.asmdef` breaks the moment both plugins are installed.

**GDScript (Godot).** `class_name` registers in a PROJECT-WIDE global namespace.
Two addons declaring the same one is a hard editor error, not a warning.

There is a live instance of this already: Patterplay's Godot addon declared a
bare `class_name Mulberry32`, the only unprefixed global name in either addon. It
did not collide with the Storylet Engine, which uses `StoryletMulberry32`, but it
squatted a generic name against every other addon and the game's own code. It is
now `PatterMulberry32`.

## The answer: identity belongs to the installing plugin

One source of truth in `expr/ports/`. A vendor step copies it into each plugin
and substitutes the identity:

| | authored once as | vendored as |
|---|---|---|
| C++ | `namespace WILDWINTER_EXPR_NS` | `patter::expr` / `storylets::expr` |
| C# | `namespace WILDWINTER_EXPR_NS` | `Patterkit.Patterplay.Expr` / `StoryletStudio.StoryletEngine.Expr` |
| GDScript | no `class_name`, relative preloads | `addons/patterplay/runtime/expr/` / `addons/storyletengine/runtime/expr/` |

It is a copy plus a namespace substitution: a dozen lines of script. "Vendoring"
is a more honest word for it than "generation".

Family-scoping rather than version-scoping (`wildwinter::expr::v0_4`, the
abseil-style trick) is deliberate, for three reasons.

1. **It is uniform.** C# and GDScript force family-scoping anyway. Version
   scoping would make C++ the one platform with its own mental model.
2. **It is unconditional.** Version scoping only collapses safely when both
   families vendor byte-identical text. Any divergence and you are back to two
   copies under one name. `patter::expr` cannot collide, ever.
3. **The supposed benefit is a hazard.** If two identical copies did collapse to
   one set of symbols, Patterplay and the Storylet Engine would share one
   evaluator at runtime, and a bug in one would silently reach the other. Two
   separately versioned products want independent copies.

## Vendor at commit time, not build time

The copies are checked in, and CI runs the vendor step and fails on
`git diff --exit-code`.

- A game developer installs these as a UPM package or a plugin zip. There is no
  build step you control in their project, so the copy must already be in the
  shipped artifact.
- Each port repo stays self-contained: it builds and tests with no assumption
  that `../expr` is checked out beside it.
- The copies stay readable, greppable and debuggable, rather than existing only
  inside a build directory.

You get one implementation and a build that fails the moment someone hand-edits
a copy. This is the guard `patter/scripts/check-shell-css-mirror.mjs` already
uses, and it is the guard the parity corpus is vendored under today
(`expr/scripts/sync-conformance.mjs`, and the `expr-corpus-sync` job in both
repos' `ports.yml`).

## What belongs in which tier

**Tier 1, one implementation, vendored.** Identical logic carrying no product
content:

- the `expr` evaluator, once Patterplay has a dialect seam (see below)
- mulberry32, which is a fixed published algorithm ported six times, plus four
  more copies in Patterplay's own JavaScript
- the Godot editor plugin boilerplate. The audit ruled this "leave duplicated,
  it is forty lines", and that was right without a vendoring mechanism on the
  table. It is 88-100% identical, and the export-plugin bug (`patterkit/patter#45`)
  was already found once and fixed twice by hand. Once copying is a script
  rather than a person, "only forty lines" stops being an argument for two
  copies.
- probably the C++ mini JSON parser

**Tier 2, same shape, different content.** Cannot share code, because the
payloads genuinely differ (cards and decks against scenes and flows), but the
discipline should be identical and is currently identical only by coincidence:

- the save envelope: a tagged `<family>/save@N`, foreign blobs refused
- assembly and module layout: the asmdef split
  (`Runtime` / `Runtime.Json` / `Runtime.Unity` / `Editor`), the UE
  Runtime/Editor module pair, the Godot `runtime/ editor/ ui/` layout
- the state logger's line format, the live-link handshake, the TestHost layout
  and build scripts

The mechanism for tier 2 is not shared code, it is a **shape check**: a script
asserting both port trees match one agreed skeleton. That is the cross-family
version of `patter/scripts/check-runtime-api-parity.mjs`, which already does this
within one family.

**Tier 3, legitimately different.** Engine, Bundle, Save's payload. The audit
measured 1-10% similarity and was right that this is two products being two
products. Leave them.

**Already solved, worth knowing.** Parsing is not duplicated anywhere. No port
contains a parser: bundles ship compiled ASTs and the ports only evaluate. That
is why the parity corpus can carry `ast` and hold six runtimes to it without any
of them needing `parser.ts`.

## The order this has to happen in, and where it got to

All four steps are done, on all three platforms.

1. **The parity corpus.** It is what stops new drift, and it was worth doing
   first because it is the only step that pays off without any of the others:
   every step below was checked against it as it landed.
2. **Patterplay's evaluator must be able to refuse.** Its GDScript port called
   `push_error()` and returned a fallback value (`0.0` for a division by zero or
   a mixed-type `+`, `false` for an unknown operator), so a caller could not tell
   a refusal from an answer. It now returns the same `EvalError` object the
   Storylet Engine has always used. Its C++ and C# ports already threw.
3. **Split Patterplay's dialect out of its evaluator.** Done in all three:
   `Dialect.h`, `Dialect.cs`, `dialect.gd`, mirroring the Storylet Engine's.
   Patterplay declares its scopes list EMPTY, which reproduces its
   graceful-false behaviour exactly, so one evaluator serves both policies.
4. **Vendor the evaluator.** `ports/godot`, `ports/unreal` and `ports/unity`
   hold the only copies. `scripts/vendor-ports.mjs` writes them into both
   plugins and `--check` fails CI on any difference.

| Platform | Shared source | Vendored as |
|---|---|---|
| Godot | `values.gd`, `mulberry32.gd`, `expr_eval.gd`, `expr_specificity.gd`, `bundle_export_plugin.gd` | byte-identical in both addons |
| Unreal | `Value.h`, `Mulberry32.h`, `Ast.h`, `Expr.h`, `Specificity.h` | `__EXPR_NS__` / `__EXPR_VALUE__` / `__EXPR_KIND__` |
| Unity | `Value.cs`, `Mulberry32.cs`, `Ast.cs`, `Expr.cs`, `Specificity.cs` | same, to each root namespace |
| JavaScript | `packages/expr/src/prng.ts` | imported, not vendored |

The **value type** went the same way. Both families had their own (68% alike on
Unity, with a character-identical `ValueEquals`), and the shared evaluator
already required both to expose the same predicates and accessors, so most of
the difference was spelling. The shape is Patterplay's, public fields with
accessors beside them, because its own code reads `v.kind` and `v.n` thirty-five
times to the Storylet Engine's three. Truthiness moved onto it, so the rule the
two families had drifted on now has exactly one home per platform.

**And it turned out the number rendering was wrong in five of the six ports.**
Both codebases call `JsNumber` the cross-runtime number-rendering contract, and
it did not hold:

| | 0.1+0.2 | 1e16 | 1e20 | 1/3 |
|---|---|---|---|---|
| JavaScript | `0.30000000000000004` | `10000000000000000` | `100000000000000000000` | `0.3333333333333333` |
| Patterplay C++ | `0.3` | `1e+16` | `1e+20` | `0.333333333333333` |
| both C# | ok | ok | `9223372036854775807` | ok |
| both GDScript | `0.3` | `10000000000000000.0` | `100000000000000000000.0` | `0.33333333333333` |

Four different failures. Patterplay's C++ used a 1e15 integral cutoff and a
fixed `%.15g`; both C# ports cast to `long`, which overflows above 2^63; both
GDScript ports used `String.num`'s 14-decimal default and its trailing `.0`, and
Patterplay's had no NaN guard so it printed `nan`. Only the Storylet Engine's
C++ was faithful, and that is what the shared source carries: integral values
below 1e21 with no decimal point and no exponent, everything else the shortest
representation that round-trips. It matters because this renders `{@ref}`
interpolation, so a player could read `1e+16` in displayed text.

The **AST deserialiser** went the same way, and it is the case that best shows
what "needs its own implementation" was actually hiding. There were SIX, and
within a language they were 77-92% identical once the JSON accessor idiom was
normalised away. The one real outlier (8-16%) was Patterplay's Unreal loader,
and it was an outlier only because it read `FJsonValue` directly instead of
normalising first. So the tag dispatch is now shared and parameterised on how to
READ a node: C++ through an `AstJson<J>` traits struct (six accessors, and
Unreal's specialisation is twelve lines), C# through a normalised
`IReadOnlyList<object>` tree. Every host also gained the per-tag arity checks
that only Patterplay's Unreal loader had.

The **specificity scorer** went the same way, and was a purer case than the
evaluator: it takes truthiness as a callback, so it never needed to know a value
type, a dialect or a scope. The Storylet Engine had it as a module in all three
ports and Patterplay had it inline in Flow / Engine, which is the dialect story
over again. Patterplay now has `PatterSpecificity` in Godot and calls
`MatchedSpecificity` in C++ and C#; the Storylet Engine's three files became a
one-line include, a ten-line shim, and a deletion.

The vendor step also writes Unity's `.meta` sidecars, with GUIDs derived from
the asset path so they are stable across regeneration. A random GUID would make
`--check` fail on every run, which is the same class of mistake as a check that
cannot fail, pointing the other way.

## What each family still owns, and why

The shared source is the algorithm. Three things cannot be in it, and each
family keeps its own:

- **The value type.** `StoryletValue` and `PatterValue` carry family-specific
  rendering and JSON. They already expose the same predicate and accessor set,
  which is what lets one evaluator read both.
- **The error type.** The shared evaluator throws `EvalError`; each family
  declares it, so the Storylet Engine keeps `EvalError : StoryletError` and a
  host can still catch its own hierarchy.
- **Scope adapters.** `BagScope` reaches into the Storylet Engine's `OrderedMap`;
  Patterplay's wraps a plain dictionary and a resolver callback. Both satisfy the
  shared `IScopeSource`.
- **The dialect**, which is the whole point of the seam.

**On the Godot `class_name` wrappers.** Those ARE ceremony: about ten lines each,
existing only because Godot has no namespaces and the shared file must not claim
a global `class_name`. They buy one stable global name (`StoryletExpression`,
`PatterExpr`) instead of a `preload` const in every calling file, and they keep
both plugins' existing public names. A wrapper that turned out to hold nothing
at all, Patterplay's C++ `Expression.h`, was deleted rather than kept for
symmetry.

**Also settled along the way**: truthiness. `expr-specificity` calls it
host-bound, and it is, but the two families had drifted to different answers
(the Storylet Engine admitted only booleans and numbers; Patterplay also
admitted a non-empty string or flag list). That was an accident of writing the
two engines at different times, not a decision, and it mattered because the two
share a property registry: the same value read from the same registry answered a
condition differently depending on which engine asked. The Storylet Engine now
matches Patterplay, in JavaScript and all three ports, pinned by four new cases
in its own corpus. Truthiness still lives in each family's values module rather
than in the shared evaluator, because it is applied to a condition rather than
computed by the evaluator.

## Finding the next one

`scripts/find-duplication.py` pairs every Storylets source file with its
Patterplay opposite number, normalises the family identifiers away, and ranks by
similarity weighted by size. Run it after any port work.

Its caveat matters as much as its output: HIGH similarity is strong evidence of
duplication, but LOW similarity is NOT evidence of its absence. Two files can
solve one problem in two ways and share not a token, which is exactly the
complaint. It ranks what to READ; nothing it prints is a conclusion until both
files have been read.

It found two things a person had missed. **mulberry32 existed thirteen times**
across the two families: three native ports each, the Storylet Engine's
`prng.ts`, and on the Patterplay side an inline copy in `engine.ts`, another in
C++ `Engine.h`, another in C# `Flow.cs` (both ignoring the `Mulberry32` class
that shipped beside them), and three more in its own harnesses. It is a fixed,
published algorithm that neither family owns, so it now lives in
`@wildwinter/expr` itself as `prng.ts`, with one vendored port per platform.
And **the Godot bundle export plugin was byte-identical bar its comments** -
the file whose absence shipped as `patterkit/patter#45`, was fixed there, and
then had to be fixed a second time by hand here.

## What is still duplicated, and why

Everything below has been read, not just measured. The scanner ranks; these are
the conclusions.

**Left for a reason:**

- **The dialects** (53% C++, 52% C#). Differing IS their purpose: the seam
  exists so one evaluator can serve two products. They overlap on three
  built-ins out of eight, and the 52% the scanner sees is `FunctionDef` literal
  scaffolding, which is the shape rather than the content.
- **The `tsup` configs** (97-100%). They differ for a stated reason: the
  Storylet Engine inlines its dependencies because it is not published and the
  release zip IS the distribution; Patterplay leaves them external because
  `npm i` fetches them. The scanner's caveat, exactly.
- **The Unreal editor and Blueprint boilerplate** (`EditorModule.cpp` 91%,
  `BundleDetails.h` 98%, `Save.h` 96%). Unreal reflection: the variance is the
  module export macro and the reflected type names, both structurally required,
  and UHT generates a `.generated.h` per header. No logic, no bug history.
- **`newId`** (79%), fifteen identical lines with no natural home. A published
  package for it costs versioning, releasing and a dependency edge in both
  repos, against code that has never changed. Revisit when a SECOND generic
  utility wants sharing; make the package then, not for this alone.
- **The Godot plugin entry points**. Now identical after renaming, but each
  names three addon-specific paths, so sharing needs three factories to save
  twenty-five lines. Their teardown order was the only real difference and is
  aligned.
- **The debug registries** (`Debug.cpp` 61%) and **bundle Resources** (74%).
  Generic structure over Unreal reflection types in the first; genuinely
  different validation placement in the second (the Storylet Engine delegates to
  its bundle loader, Patterplay parses inline).

**`reachability.ts` was on that list and has been read.** It is JS only, never
ported: an authoring-time check that no runtime runs. It came from the Storylet
Studio side as a brief in 2026-08-30 and was implemented independently, which is
the family protocol working as designed, so the two are the same IDEA over two
different models: decks and boxes on one side, scenes and snippets with property
defaults and `temporary` reseeding on the other. Genuinely different, and the
headers say so.

But its LATCH GRAMMAR was not. Which shapes assert a latch (`@x`, `@x == true`,
`check_flags(@x, +f)`), how a condition splits on `or`, and how terms carry
negation, were character-identical in both, including the flag key format. That
is analysis of the expression language, so it is now
`@wildwinter/expr`'s `latches.ts`, generic in whatever a host uses to scope a
ref. Similarity went 50% to 44%, and the remaining 44% is the model traversal
that should differ.

It is the grammar rather than the traversal because the grammar is what drifts:
teach one family that `@x != false` asserts what `@x` does and the other
silently does not learn it, so the same content reports a fault in one product
and not the other.

**And it had no test on either side.** Both reachability suites (18 cases and
24) passed with the `@x == true` shape disabled entirely: each tests its own
model's traversal and reaches the grammar only incidentally, which is exactly
the hole the cross-language corpus exists to fill, in a different language. The
grammar now has its own 18 cases in `expr`, and they fail when that shape is
removed.

**`bundle_view.gd` and `BundleDetails.cpp` have been read.** They are the same
feature in two engines: show a bundle's summary in the Inspector. Both split the
same way, and the numbers are the interesting part:

| | shared | family |
|---|---|---|
| Godot | `_ready`, `set_bundle_resource`, `_add_section`, `_add_row` all **100%** | `_refresh` body 27% |
| Unreal | `MakeInstance`, `AddLine` both **100%** | `CustomizeDetails` body 38% |

The FRAME is identical and the CONTENT differs, which is right: one shows boxes,
decks, cards, hands and tag groups, the other locales, strings and characters.
So Godot's frame is now shared (`ports/godot/bundle_view.gd`) with each family
overriding `_render` and nothing else. Unreal's frame is fourteen lines of
`IDetailCustomization` boilerplate and is left alone.

**The frame was worth sharing because this pair had already drifted, twice, in
the same place.** Patterplay's Unreal view learned to distinguish "failed to
load" from "never parsed" and say so either way; the Storylet Engine's did not,
so an unparsed bundle with an empty `LoadError` fell through to a
default-constructed description and showed a BLANK Inspector rather than a
fault. And Patterplay's Godot test covered the broken-bundle state while the
Storylet Engine's did not. Same two files, same state, one improved and one left
behind, on two engines. The Unreal one is fixed and both Godot tests now cover
the states the frame owns, probed by breaking the frame and watching both
families fail.

`totals` against `counts` in the describe layer looked like gratuitous
divergence and is not: the Storylet Engine has both, bundle-wide totals AND
per-box counts, because it has a level of structure Patterplay does not.

**Still not read**: the state panels (44% Godot, 39% Unity) and `pack.ts` (46%).

## Flags compare as a set

Resolved 2026-09-01, and it was a real bug rather than a difference.

Flags equality was ORDER-SENSITIVE everywhere, including upstream in
`evaluate.ts`. So `set_flags(@f, +red)` then `+blue` compared UNEQUAL to the
same two flags added the other way round: a difference no author can see and
none intends. The Storylet Engine papered over it by sorting in `set_flags`,
which only holds while every producer sorts, and a bundle's declared default or
a host handing a list in does not. Patterplay did not sort, so it had the bug
in the open.

A flags value IS a set, so the fix belongs in the COMPARISON, not in every
producer: `valueEquals` now compares sorted copies, in `expr` and in all six
ports. Multisets rather than sets, so a duplicated flag still counts; a
well-formed value has none, but equality should not be what decides otherwise.

Three corpus cases pin it, and all six ports failed them before the fix:

    FAIL flags in a different order are still equal: expected true, got false
    FAIL flags inequality is order-insensitive too: expected false, got true

The Storylet Engine keeps its `set_flags` sort, for a reason that survives the
change: a deterministic stored order keeps save bytes and cross-runtime
comparisons stable. It is no longer what makes equality work, so Patterplay not
sorting now costs nothing.

Two places deliberately stay order-sensitive, and say so: Patterplay's property
inspector, which asks whether a displayed ROW needs redrawing and renders the
list in stored order, and the state loggers' rendering.
