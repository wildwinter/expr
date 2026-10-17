# @wildwinter/expr

## Unreleased

### Added

- **`qualityDeclarationProblems(stages, default?)`**, the family's one rule for declaring a
  quality: at least two stages, none empty, none listed twice; a default is optional, and
  when given it must be a stage. It returns structured problems (`too-few-stages`,
  `empty-stage`, `duplicate-stage`, `default-not-a-stage`) for each caller to word.
  Patter wanted two stages and the Storylet compiler one; both now call this.
- **`stageIndex`, `compareStages` and `nextStage`**, a quality's order outside an expression,
  for a host comparing a field's stage with a property's or stepping one. Each takes a ladder
  or a declaration with `stages`; `compareStages` and `nextStage` throw the evaluator's own
  error for a value that is not a stage, and `nextStage` stays on the top rung as `advance()`
  does. The native kernel has the same three (C# `Stages`, C++ `StageIndex` / `CompareStages`
  / `NextStage`, GDScript `stage_index` / `compare_stages` / `next_stage`), and the expr
  corpus (version 4) gains a `qualities` family and a `stages` family that pin both.

## 0.5.1

### Fixed

- **Names an author writes are looked up as own entries only** (October 2026 kernel review).
  Every lookup by name read a plain object, which also answers the names every JavaScript
  object inherits. The tokeniser read `constructor` and `__proto__` as something other than
  identifiers, so `@world.constructor` would not parse; a static scope bag answered such a
  name with a built-in value instead of "missing"; and a dialect's function table offered
  `Object` (as `constructor`) and `toString` as functions to call. The parser, evaluator and
  validator now read own entries only, through one helper.

## 0.5.0

Three additions and one behaviour change, all of them things both consuming
product families were carrying their own copies of.

### Changed

- **Flags compare as a SET.** `==` and `!=` on a flags value now ignore order:
  `["red","blue"]` equals `["blue","red"]`. They are compared as multisets, so a
  duplicate still counts.

  Order was significant before, and that was a bug rather than a decision: a
  flags value IS a set, and its stored order is an artefact of the order
  somebody happened to add things in, which no author can see and none intends.
  `set_flags(@f, +red)` then `+blue` compared UNEQUAL to the same two flags added
  the other way round. One consumer papered over it by sorting on write, which
  only holds while every producer sorts, and a declared default or a host-supplied
  list does not.

  **Migration**: none for most content. An expression relying on two equal-membered
  flag values comparing unequal will change answer, which is the point.

### Added

- **`makePrng` / `toUint32` / `shuffleInPlace`** (`prng.ts`): mulberry32, the
  contractual PRNG behind `random()` and every shuffle. It existed thirteen times
  across the two consuming families. `toUint32` is ECMA-262 7.1.6, spelled out
  because it is the obligation a port in a language without JavaScript's shift
  semantics has to reproduce.
- **`latchOf` / `terms` / `disjuncts` / `scopedRef`** (`latches.ts`): the latch
  grammar behind a monotonic-latch reachability check. Which shapes assert a
  latch (`@x`, `@x == true`, `check_flags(@x, +f)`) is a fact about this language,
  and was written twice, character for character.
- **`propertyNameify` / `isValidPropertyName` / `isCaseOnlyPropertyName` /
  `RESERVED_PROPERTY_NAMES` / `KEYWORD_NAMES`** (`names.ts`): what makes a name
  legal in an expression. `RESERVED_PROPERTY_NAMES` is DERIVED from the
  tokeniser's own keyword table, so a keyword added here cannot leave a stale
  hand-written copy downstream, which is what both families had.

### Notes

There is now a cross-language conformance corpus for this package
(`packages/conformance`), run by six native hand ports across two product
families as well as by the reference runtime here. It pins seed coercion, the
PRNG draw and state sequence, operator typing, short-circuiting, value equality
and the comparison rules.
