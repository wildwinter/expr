# @wildwinter/scoperegistry

The state layer that sits on top of [`@wildwinter/expr`](../expr). expr is a
stateless calculator; this package holds the state it calculates over.

A registry holds the state as a set of named **scopes**, each either:

- **owned**: a property bag this registry stores, seeds from declaration
  defaults, and saves; or
- **foreign**: values the game keeps in its own state and lends to the story
  through a `{ get, set? }` resolver. The registry reads and writes them but
  never stores or saves them (read-only if the resolver has no `set`).

It produces the two things expr consumes: **`toEvalContext()`**, the context for
`evaluate`, and **`toSchema()`**, the schema for `validateExpr`.

`expr` never depends on this package; this package depends one way on `expr`.
It knows nothing about any engine or game: no product's tokens appear in it.

## One registry per game

A game has **one** registry. It holds every property from every engine in the
game, except those the game keeps itself (foreign scopes), and it is saved and
loaded as one.

- **The game owns the registry** and hands it to each engine. An engine given
  none makes its own and acts as its own game, so a single-engine game needs no
  wiring.
- **Every property bag goes in it.** An engine registers each bag when it comes
  into being and removes it when it goes away. Game-wide scopes register under
  their expression token (`game`, say). Per-instance bags (one per scene, per
  deck, per flow) register under keys the engine chooses, prefixed with its own
  name so two engines cannot collide: `my-engine/flow-2/scene/tavern`.
- **The engine says which instance a token means, per evaluation**, with an
  alias: `toEvalContext(host, { aliases: { scene: "my-engine/flow-2/scene/tavern" } })`.
  The alias applies to scopes, quality ladders, and validation alike.
- **A token is taken once.** There is no reserved-token list; a clash fails at
  registration, the moment a game combines its engines. Each engine documents
  the tokens it registers.
- **Every expression can read every scope.** A condition in one engine can read
  another engine's game-wide scope; the writable rules are unchanged.
- **The game saves the registry once**, by embedding `save()` in its own save.
  Each engine's own save keeps only what is not a property (cursors, visits,
  boards, clocks).

```ts
import { ScopeRegistry } from "@wildwinter/scoperegistry";

const registry = new ScopeRegistry()
  .defineForeign("world", { get: (n) => game.read(n), set: (n, v) => game.write(n, v) }, worldDecls, { owner: "Game" });

const engineA = new EngineA(bundleA, { registry });   // registers its own scopes
const engineB = new EngineB(bundleB, { registry });

// One save for the whole game: the registry's values, and each engine's
// non-property state.
const save = { registry: registry.save(), a: engineA.saveGame(), b: engineB.saveGame() };
```

### Loading in any order: parked values

`load()` lays each section over the scope registered under its key. A section
for a key **nobody has registered yet** is parked, and handed over when that key
registers: laid over the new bag's seeded defaults, so a property the save
predates keeps its default. A game can therefore load its registry before its
engines have reopened their flows or decks.

Values still parked are included in the next `save()`, so nothing loaded is lost
to an instance that simply has not reopened yet. A game that knows they are dead
calls `discardParked()`. Each `load()` replaces whatever an earlier load parked.
A section for a foreign scope is ignored: those values are the game's.

### Live reload: `remove` with `keep`

`remove(key)` unregisters a scope. With `{ keep: true }` an owned scope's values
are parked and handed back when the same key registers again, which is how an
engine rebuilt from new content hands its state to its replacement. A key is free
again once removed.

### Who registered what: the owner label

`defineOwned`, `mountOwned`, and `defineForeign` take an optional `owner`, a
free string such as an engine's name. A clash names the owner that got there
first (`scope '@story' is already registered by Engine A`), and
`listProperties()` rows carry it, so one examiner can group a combined game's
properties by engine.

## The API

- **`defineOwned(token, declarations, { pathPrefix?, normalise?, owner? })`**:
  an owned scope the registry builds. (The third argument may still be the path
  prefix alone, as before 0.7.)
- **`mountOwned(token, bag, { owner? })`**: an owned scope over a bag an engine
  holds. It claims any values parked for that key.
- **`defineForeign(token, resolver, declarations?, { writable?, normalise?, owner? })`**:
  a scope the game keeps. `writable` is the scope-level default for its
  declarations. (The fourth argument may still be that boolean alone.)
- **`remove(token, { keep? })`**, **`discardParked(prefix?)`**, **`has(token)`**.
  With a prefix, `discardParked` drops only the parked keys that start with it,
  so an engine resetting itself leaves other engines' values alone.
- **`revision`**: a counter that moves on each registration or removal and at no
  other time. A caller caching a context from `toEvalContext()` rebuilds it when
  the counter moves; the values a context reads are live, its set of scopes is
  not.
- **`get(scope, name)`** and **`set(scope, name, value, { host? })`**.
  `writable: false` is the *story's* promise: a story write is refused, and the
  game's own write, passing `{ host: true }`, is not. A declaration's own flag
  beats its scope's default in both directions. A foreign scope whose resolver
  has no `set` is refused for everyone.
- **`toEvalContext(host?, { aliases? })`** and **`toSchema({ aliases? })`**. An
  alias to a key that is not registered throws.
- **`listProperties()`**: examiner rows across owned scopes and declared foreign
  scopes, each with its `scope`, `owner` (when given), `path`, `value`, and
  `writable`.
- **`save()`** and **`load(blob, { keepParked? })`**: bare values of owned
  scopes, keyed by token, plus parked values. Each load replaces what an earlier
  load parked, unless `keepParked` says to add to it: for an engine moving an
  older save's values into a registry the game has already loaded.
- **`readScopeRegistrySpec(json)`**: extract a `scopeRegistrySpec` (the interop
  format one owner exports so another engine can validate references into its
  scopes) from any parsed JSON value.

Names fold to lower case unless a scope says otherwise: pass
`normalise: (n) => n` for a case-significant scope. The policy is honoured
everywhere the scope's names appear, including quality ladders and the schema.

### `PropertyBag`

The unit of state, usable on its own: typed declarations and defaults, the
firing rule (engine writes notify `subscribe`rs; host writes pass
`{ silent: true, reason }` and reach only the always-on `onAudit` hook),
examiner `rows()`, one sanctioned `clone()`, in-place `reseed`, and bare-value
`save()` / `load()`. Its `pathPrefix` gives each row its address.

### Deprecated

`saveFragment()`, `loadFragment()`, `OwnedStateFragment`, and
`SAVE_FRAGMENT_VERSION` are deprecated and will be removed at the next breaking
release. Versioning belongs to the save that embeds the registry's values, not to
the registry; embed `save()` in your own versioned save instead.

## Shared game scopes, for editing tools

`@wildwinter/scoperegistry/scopes` is the editing side of one registry per game. A game keeps one
`game-scopes/` folder. Each editing tool writes its own `<tool>.scopes.json` there (its game-wide
scopes and their declarations), the game keeps `game.scopes.json` (the scopes it provides itself,
`@world` among them), and every tool reads the others, so a storylet can check and suggest
`@patter.visits` and a Patter line `@story.act`, with no import step.

```ts
import { findGameScopes, parseScopesFile, mergeScopes, scopesCatalogue, serialiseScopesFile } from "@wildwinter/scoperegistry/scopes";

const { dir } = findGameScopes(projectDir, { exists, parent, join });   // your file access
const files = readTheFolder(dir).map(([fileName, text]) => ({ fileName, file: parseScopesFile(text, fileName).file! }));
const merged = mergeScopes(files);                          // clashes come back as issues
const picker = scopesCatalogue(merged, { except: ["story"] });   // everything but your own
writeFile(`${dir}/storylets.scopes.json`, serialiseScopesFile(mine));   // canonical text
```

- **The file** is a `scopeRegistrySpec` with an `owner`: game-wide scopes only, each declaration
  with an optional `purpose` another tool's picker shows. `serialiseScopesFile` is canonical (fixed
  key order, no timestamps), so a file changes only when its content does, and comparing it with
  the text on disk is the staleness check.
- **Discovery**: `findGameScopes` walks up from the project folder to the nearest `game-scopes/`,
  stopping at the version-control root, or takes an override relative to the project. None found
  means the tool works alone.
- **Reading**: `mergeScopes` (one spec, and an issue for a token two files declare), `scopesSchema`
  and `scopesCatalogue` (for a validator and an editor's picker, leaving out your own tokens),
  `referenceNote` (a name another tool doesn't declare, or a write to a property it marks
  read-only), and `standInRegistry` (the other tools' scopes seeded from their defaults, so a
  preview can play content that names them).

Pure functions only: the caller reads and writes the files, since this package also ships inside
game runtimes. Nothing here runs in a game. Design: `patterkit/design/shared-scopes.md`.

## The conformance corpus

`corpus.json`, beside this README in the repository, is the registry's contract:
a language-agnostic list of scripted cases (register, write, save, load, park,
remove, alias, evaluate) with what must happen at each step. This package's tests
run it, and so does every native copy of the registry (C#, C++, and GDScript),
from the same file. Its cases use no product's tokens.

Design rationale: `design/scope-registry.md` and `design/one-registry-handover.md`
in the Patterkit design repository.
