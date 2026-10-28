# @wildwinter/toolkit

## 0.4.0

### Added

- **Game IDs**: `gameIdify(text)` turns a name into a Game ID, and `isValidGameId(gameId)` checks an authored one. Both
  families had the same copy of each, and Storyletter matches a card to its Patter scene by them, so they now live in
  one place. The rule is unchanged: lower case, apostrophes dropped, every other run of anything but a-z, 0-9 and
  hyphens made one hyphen, and no hyphen at either end. What a family derives an address from stays its own.
- **Resolving the unresolved mark** (`./extensions`): `clearUnresolved(shard, paths)` returns the shard with the named
  clashes taken out of its `unresolved` mark, and without the key once nothing is left in it. `unresolvedOf` already
  reads the mark as each clash's path, kind and three sides, for a resolver to show.

## 0.3.1

### Added

- **Requirements in a manifest** (`./extensions`): `requires` names the other extensions, by id, that a project must
  take for this one to work. The manifest check holds it to ids, each once, never the extension's own.
  `missingRequirements(manifest, taken)` lists those a project lacks, for a host's Add Extension, its validation,
  and its views.
- **A view as a field's editor** (`./extensions`): a target's own map of records can name one of the manifest's views
  as its `editor`, which a host opens in place of its own record grid. The check holds it to a declared view that
  opens in that host, and warns of one on any other kind of field, where it means nothing.

## 0.3.0

### Removed

- **Claims and settings** (`./extensions`): a manifest's `settings` and a target's `claims`, and with them
  `ClaimDecl`, `SettingDecl`, `HostSpec.claimable`, `settingValues`, `resolvedClaims`, `claimClashes`, and
  `effectiveClaim`. An extension's data is always its own; a project-wide value is a field on the `project` target.
  A manifest that still has `settings` or `claims` is warned of by name (`removed-key`), and the key is ignored.

## 0.2.7

### Added

- **Value help on a pick** (`./extensions`): a pick's `valueHelp` describes its fixed `words`, a sentence each; the
  manifest check holds each key to one of them, since the project's lists and nodes are the project's to describe.

## 0.2.6

### Added

- **Views and reads in a manifest** (`./extensions`, tier 2): `views` declares the web components an extension's
  installed package supplies, each with an `id`, a `name`, an `entry` script inside the package, the custom `element`
  it defines, and optionally the `hosts` that offer it; `reads` names the other extensions whose data the views read.
  The manifest check holds both to their shape. `viewsFor(manifest, host)` lists the views a host offers, and
  `isViewEntry` keeps an entry inside its package.

## 0.2.5

### Added

- **A `pick` value type** (`./extensions`): one choice from the sources a manifest names in `from`, in order:
  fixed `words`, the nodes of a reference kind (`to`), and a list of text on the extension's own project node
  (`list`). The value is text; empty is automatic. The manifest check holds each source to its shape and each
  `list` to a list of text on the project target. `valueProblems` reports a value no source holds
  (`not-a-choice`) and one two sources hold (`pick-ambiguous`, a warning), given the host's lists in the new
  `ValueContext.list`. `pickChoices` lists the choices for an editor, `pickClashes` reports each name two sources
  hold once for the project, and `pickLists` reads the lists off the project entry.

## 0.2.4

### Added

- **Find by field value**: `parseFieldQuery`, `fieldNameMatches`, `fieldValueMatches` and `fieldValueText`, so the
  Field tabs in Storyletter's and Patterpad's Find windows read `mood = tense` by one rule. A value matches by its
  field's type (text, enum and quality without case, flags by membership, numbers numerically, booleans by word),
  `!=` negates, and a bare field name matches any value.

## 0.2.3

### Added

- **`@wildwinter/toolkit/vcs`: version-control setup for git, Perforce, Plastic SCM and SVN**, lifted from Patter so
  both families take one copy. `vcsConfigFiles(format, vcs, posture)` writes the `vcs-setup.md` guide, git's
  `.gitattributes` and the system's ignore file for a format that says what its files are (`VcsFormat`);
  `bundlePostureOf` reads back whether the compiled bundle is committed or ignored; `runMergetool` is the wrapper a
  system with one global merge tool calls, sending the format's source to its structured merge and anything else to
  the team's own tool. Node-only, as `./archive` is.

## 0.2.2

### Added

- **Comment threads merge message by message** (`./extensions`): `mergeComments(base, ours, theirs)`, and the
  `comments` strategy (`COMMENTS`) for `mergeTree`, lifted from Patter's merge so both families take one rule.
  Two replies to one thread both land, oldest first; a withdrawn message stays withdrawn, and one a side removed
  outright, or lost with its thread, counts as withdrawn by that side; one message edited two ways is a clash.
  A thread's own fields (anchor, marker, `resolved`) merge one by one, and a thread with nothing readable left
  goes. Threads come back oldest first.

## 0.2.1

### Changed

- **A claim may leave out an enum's or flags' `values`, and a quality's `stages`** (`./extensions`): the host
  field's declaration is then the vocabulary, and the claim adds its label, help and value help, which may
  describe values the host does not declare. `effectiveClaim(claim, hostDecl)` merges the two. An extension's
  own fields still list their values.

## 0.2.0

### Added

- **`@wildwinter/toolkit/extensions`**: the shared spec and merge for Patter extensions and Storylet
  extensions ([extensions.md](extensions.md)). The manifest and its checks (`manifestProblems`), the value types
  and their checks (`valueProblems`, `entryProblems`) on the kernel's `valueFits`, `qualityDeclarationProblems`
  and `stagesEitherSide`, defaults (`defaultOf`, through `defaultFor`), what a bundle carries (`compiledTarget`,
  `compileEntry`), stage renames (`renameStages`), claims on host fields (`resolvedClaims`, `claimClashes`), the
  three-way merge engine (`mergeTree`) and its manifest-built strategies (`mergeExtensionData`), the
  `unresolved` mark (`markUnresolved`, `unresolvedProblems`) and orphaned entries (`orphanedEntries`).
  Hand-written conformance cases in `conformance/extensions/`. `@wildwinter/expr` and
  `@wildwinter/scoperegistry` are optional peer dependencies, needed by this entry only.

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
