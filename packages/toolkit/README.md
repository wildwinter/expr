# @wildwinter/toolkit

Small shared pieces of the **authoring tooling** behind
[Storylet Studio](https://github.com/storylet-studio) and
[Patter](https://patterkit.com): opaque ids, Game IDs, a stable hash, JSON5 source parsing,
find/replace matching, the archive guards, version-control setup (in `./vcs`), and (in
`./extensions`) the spec and merge for Patter extensions and Storylet extensions.

**Nothing here runs in a game.** This is the editor/CLI/pipeline side. The
runtime language lives in [`@wildwinter/expr`](../expr), and unlike that package
these pieces carry no shared semantics between the two product families: they
are simply the same code, so a fix lands once.

Each was found duplicated, almost but not exactly, across both families. That
"almost" is the point. A zip-slip guard that is correct in two places today is
one careless edit away from being correct in one, and nobody reads the diff of a
file they believe is a copy.

ESM + CJS + types. `json5` is the only dependency of the main entry.

## Extensions (`@wildwinter/toolkit/extensions`)

The one part with shared semantics: the manifest a Patter extension or a Storylet extension ships, the types its
values take, the checks both editors and both command lines run, and the type-driven three-way merge both formats
use for extension data, with the `unresolved` mark an unresolved merge leaves in a shard. The spec is
[extensions.md](extensions.md) and its contract the hand-written cases in `conformance/extensions/`.

It is built on the kernel's own value and ladder rules, so it needs `@wildwinter/expr` and
`@wildwinter/scoperegistry`: optional peer dependencies, which every host of it already has.

```ts
import { manifestProblems, mergeExtensionData } from "@wildwinter/toolkit/extensions";
```

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

## Game IDs

`gameIdify(text)` turns a name into a Game ID, the address a game uses for a
scene, a card or a deck: lower case, apostrophes dropped, every other run of
anything but a-z, 0-9 and hyphens made one hyphen, and no hyphen at either end
(`"Torin's Offer!"` is `torins-offer`). It can be empty, and a caller falls back
as it sees fit. `isValidGameId(gameId)` checks one an author typed. Both families
address things by this rule, and a Storylet card finds its Patter scene by it.

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

Find by field value, the Field tab both families' Find windows have. Each app
walks its own project for the values; these say what a query means, so
`mood = tense` reads the same in both:

- `parseFieldQuery(query)`: `mood`, `mood = tense`, `mood != tense`,
  `ext.field = "two words"`, or `null` when it is not a field name.
- `fieldNameMatches(name, query)`: names compare without case.
- `fieldValueMatches(type, value, query)`: by the field's type. Text, enum and
  quality compare without case, flags match when the list includes the flag
  (`= ""` is none set), numbers numerically, booleans as `true` or `false`.
  `!=` is the opposite, and no operator matches any value. Pass the value that
  holds, the default where the node sets none.
- `fieldValueText(type, value)`: the value as a row shows it.

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

## Version control

A separate, node-only entry point, because `runMergetool` starts the team's own merge tool:

```ts
import { VCS_KINDS, vcsConfigFiles, bundlePostureOf, runMergetool } from "@wildwinter/toolkit/vcs";
```

A format says what it is called and what its files are (`VcsFormat`: the tool, the git driver's name, the source
extensions, the bundle, the packed document, the conflict sidecar). `vcsConfigFiles(format, vcs, posture)` is then
everything a project is set up with for git, Perforce, Plastic SCM or SVN: the `vcs-setup.md` guide, git's
`.gitattributes`, and the system's ignore file, with the compiled bundle committed or ignored. `bundlePostureOf`
reads the posture back, so a switch of system keeps it. `runMergetool` is the one global merge tool Perforce,
Plastic SCM and SVN allow: the format's source goes to its structured merge, anything else to the team's own tool.

## Licence

MIT
