# @wildwinter/toolkit

Small shared pieces of the **authoring tooling** behind
[Storylet Studio](https://github.com/storylet-studio) and
[Patter](https://patterkit.com): opaque ids, a stable hash, JSON5 source parsing,
find/replace matching, and the archive guards.

**Nothing here runs in a game.** This is the editor/CLI/pipeline side. The
runtime language lives in [`@wildwinter/expr`](../expr), and unlike that package
these pieces carry no shared semantics between the two product families: they
are simply the same code, so a fix lands once.

Each was found duplicated, almost but not exactly, across both families. That
"almost" is the point. A zip-slip guard that is correct in two places today is
one careless edit away from being correct in one, and nobody reads the diff of a
file they believe is a copy.

ESM + CJS + types. `json5` is the only dependency.

```ts
import { newId, slug, fnv32, parseSource, findMatcher } from "@wildwinter/toolkit";

newId("scn");                     // "scn_8f3kq2z1"
slug("The Long Dark!");           // "the-long-dark"
fnv32("hello");                   // 1335831723
parseSource('{ a: 1, /* ok */ }'); // JSON5, tolerating a byte-order mark
findMatcher({ query: "a.b" });    // /a\.b/gi  (the query is escaped, not a pattern)
```

## Ids

`newId(prefix = "", length = 8)` generates a stable, immutable, **opaque** id.
It is never derived from content or position, so it survives moving, renaming
and reordering the thing it names. The base-36 token is rejection-sampled, so
every character is equally likely: a plain `byte % 36` over-weights the first
four.

`slug(name, fallback = "project")` is the human-facing counterpart, a url-ish
label with a fallback for when nothing usable is left.

## Hash

`fnv32(text)` is FNV-1a over a string's UTF-16 code units, as an unsigned 32-bit
integer. A published, fixed algorithm, deliberately **not** cryptographic: it is
for short stable handles and change detection, where the properties that matter
are that it is the same everywhere and does not move between runs.

## Source

`parseSource(text)` parses JSON5, tolerating a leading byte-order mark, because
editors on Windows add one and JSON5 will not accept it. Throws on malformed
input.

## Find

`findMatcher({ query, caseSensitive?, wholeWord? })` builds the find/replace
matcher, or `null` for an empty query. The query is **escaped**: somebody typing
`a.b` means those three characters, not "a, anything, b". Always global, so
every occurrence in a string is replaced rather than only the first.

## Archive

A separate, node-only entry point, because it imports `node:path`:

```ts
import {
  isUnsafeEntry, escapesTarget, ARCHIVE_ENTRY_OPTS, ARCHIVE_GENERATE_OPTS,
} from "@wildwinter/toolkit/archive";
```

`isUnsafeEntry(name)` is the cheap first pass on a name alone: absolute,
drive-lettered, or climbing out with `..`. `escapesTarget(dir, name)` is the
resolved check against a target directory. Together they are the zip-slip
guard, and unpacking should refuse an entry either one rejects.

`ARCHIVE_ENTRY_OPTS` and `ARCHIVE_GENERATE_OPTS` are the settings that make a
pack **deterministic**: a fixed entry timestamp, no folder entries, no streaming.
A pack of an unchanged project must be byte-identical to the last one, or every
delivery churns. That is easy to leave out, and silent when you do.

## Licence

MIT
