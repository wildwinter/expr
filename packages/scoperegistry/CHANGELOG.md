# Changelog

## [Unreleased]

### Fixed

- **The GDScript evaluator no longer leaks every evaluation that calls a function** (native
  ports only; no npm change, and the C++ kernel id stays `k492cf234`). 0.8.1's per-evaluation
  helpers made a reference cycle (the helpers' lambda captured the evaluation's state, which
  held the helpers), and Godot's reference counting never collects one: each such evaluation
  leaked its context and everything the context held. The evaluation now breaks the cycle as
  it returns. The GDScript registry corpus runner had a cycle of its own in its `listen` steps,
  broken the same way. A new GDScript check in the runner fails if an evaluation keeps its
  context alive. Found by the Storylet Engine's leak counts.

## [0.8.1] - 2026-10-06

Four kernel problems from the October 2026 review of the Storylet Engine, fixed here once so
they reach every engine through one kernel release. The native copies in `ports/` change
with this package, and the registry corpus (version 2) pins the contract on every platform.

### Fixed

- **A listener's own error reaches the caller as itself.** `set` on an owned scope caught
  whatever the bag's write raised and reported it as `'@scope.name' is read-only`, so a
  game's audit hook or subscriber that threw read as a rule the game had never made. The
  registry now asks the bag first (`PropertyBag.writable`, new) and catches nothing. The C#
  and C++ registries had the same catch; GDScript reports refusals by return value and was
  not affected.
- **Every listener registered when a write starts hears it, once.** The bag iterated its live
  listener sets, so unsubscribing ANOTHER listener during a write silenced it for that write.
  It now notifies the listeners as they stood when the write began, as the C# and C++ bags
  already did. The GDScript bag walked its live array (a listener that unsubscribed itself
  made the next one miss the write) and called a freed listener (a script error that stopped
  the write's remaining notifications); it now walks a copy and skips and drops a freed
  listener.
- **A scope answers only its own properties.** A bag's values had a prototype, so
  `@world.constructor` read the built-in `Object` function rather than "missing", and a write
  to `__proto__` vanished. The values record now has no prototype. The native bags were
  never affected.

### Changed

- **Fewer allocations on the hot path, with identical results.** The C# and GDScript
  evaluators no longer build a missing-value policy table and a closure per evaluation, or a
  helpers object per function call; the C# bag no longer copies its listener lists on every
  write (they are copy-on-write). In C#, one evaluation of a condition with a function call
  went from 496 bytes to 280, and a bag write with two listeners from 120 to 56.

### Added

- `PropertyBag.writable(name)` (C# `IsWritable`, GDScript `is_writable`): whether a story
  write to a property is allowed.
- The registry corpus, version 2: `listen` and `heard` steps, and a case's `needs`. A port
  whose language lacks a need skips the case and says so (GDScript, for the one case where a
  listener throws).

## [0.8.0] - 2026-09-25

### Added

- **Shared game scopes, for editing tools** (`@wildwinter/scoperegistry/scopes`, a separate entry
  point that game runtimes don't carry). A game keeps one `game-scopes/` folder, each editing tool
  writes its own `<tool>.scopes.json`, and every tool reads the others to check, suggest, and
  preview names it doesn't own: `parseScopesFile`, `serialiseScopesFile` (canonical text),
  `findGameScopes` (walk up to the folder, over file access the caller supplies), `mergeScopes`,
  `scopesSchema`, `scopesCatalogue`, `declarationsOf`, `referenceNote`, and `standInRegistry`.
- `ScopeDeclaration.purpose`: the author's note on a property, which another tool's picker shows.
  The registry ignores it.

## [0.7.0] - 2026-09-24

One registry per game: everything a game's engines need to share a single
registry, saved and loaded as one.

### Changed

- **Breaking: `load()` parks sections for keys nobody has registered**, where it
  used to drop them. Registering the key later claims them, laid over the new
  bag's seeded defaults, and values still parked are included in the next
  `save()`. A caller that handed a registry another registry's sections and
  relied on them being ignored now finds them parked and saved again; call
  `discardParked()` if that is not wanted. Each `load()` replaces whatever an
  earlier load parked, and a section for a foreign scope is still ignored.
- A foreign scope's names are normalised by the scope's own policy (lower case by
  default), and quality ladders and the validation schema are keyed the scope's
  way too. Before, all three were folded to lower case whatever the scope said, so
  a case-significant scope was only case-significant in its owned bag.

### Added

- `remove(token, { keep? })`: unregister a scope. With `keep`, an owned scope's
  values are parked for the next registration of the same key, which is how a
  rebuilt engine hands its state to its replacement.
- `discardParked(prefix?)`: drop the parked values nobody claimed, or only
  those whose key starts with `prefix`.
- `load(blob, { keepParked: true })`: add to what earlier loads parked instead
  of replacing it.
- `revision`: a counter that moves on each registration or removal, so a caller
  caching an evaluation context knows when to rebuild it.
- Aliases: `toEvalContext(host, { aliases })` and `toSchema({ aliases })` map an
  expression token to a registered key for one context, applied to scopes,
  quality ladders, and validation alike. An alias to a key that is not registered
  throws.
- An owner label: `defineOwned`, `mountOwned`, and `defineForeign` take an
  optional `owner`. A clash names the owner that got there first, and
  `listProperties()` rows carry it.
- `defineOwned`'s third argument and `defineForeign`'s fourth may be an options
  object (`pathPrefix`, `normalise`, `owner`; `writable`, `normalise`, `owner`).
  The earlier forms, a path prefix string and a writable boolean, still work.
- `PropertyBag.normalise(name)`: a name as the bag keys it.
- A conformance corpus, `corpus.json`, run by this package's tests and by every
  native copy of the registry.

### Deprecated

- `saveFragment()`, `loadFragment()`, `OwnedStateFragment`, and
  `SAVE_FRAGMENT_VERSION`, to be removed at the next breaking release. Versioning
  belongs to the save that embeds the registry's values; embed `save()` in your
  own versioned save.
