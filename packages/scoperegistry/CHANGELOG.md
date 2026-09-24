# Changelog

## [Unreleased]

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
