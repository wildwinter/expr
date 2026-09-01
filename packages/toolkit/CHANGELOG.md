# @wildwinter/toolkit

## 0.1.0

First release. Small shared pieces of the authoring tooling, each of which
arrived by being found duplicated across the two consuming product families
rather than by being anticipated.

Nothing here runs in a game, and nothing here is about the expression language:
that is `@wildwinter/expr`, and game-side sharing is the vendored source in
`expr/ports`, because C++, C# and GDScript cannot consume an npm package.

### Added

- **`newId` / `slug`** (`ids.ts`): opaque, rejection-sampled base-36 ids, so
  every alphabet character is equally likely. A plain `byte % 36` over-weights
  the first four.
- **`fnv32`** (`hash.ts`): FNV-1a, for short stable handles and change
  detection. Not cryptographic.
- **`parseSource`** (`source.ts`): JSON5 with a tolerated byte-order mark, which
  JSON5 alone will not accept and Windows editors add.
- **`findMatcher`** (`find.ts`): the escaped, global find regex behind find and
  replace, so a query of `a.b` means those three characters.
- **`@wildwinter/toolkit/archive`**: the zip entry guards (`isUnsafeEntry`,
  `escapesTarget`) and the settings that make an archive byte-reproducible. A
  separate entry point because it needs `node:path`, and the main entry stays
  isomorphic so a browser bundle can take it.

  The guards were correct in both families before this, which is the state
  BEFORE a drift rather than evidence there will not be one: a subtle weakening
  of one copy is a vulnerability nobody reads a diff for.
