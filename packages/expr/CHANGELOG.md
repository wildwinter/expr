# @wildwinter/expr

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
