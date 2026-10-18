# @wildwinter/toolkit/extensions

The shared spec and merge for Patter extensions and Storylet extensions: the manifest an extension ships, the
types its values take, the checks both editors and both command lines run, and the type-driven three-way merge
both formats use for extension data. Nothing here is UI and nothing runs in a game.

A Patter extension extends Patter projects and Patterpad; a Storylet extension extends Storylets projects and
Storyletter; one that does both is both. This package is the part they share. Each format stores extension data in
shards of its own, compiles it into its own bundle and delivers it on its own runtimes.

**The host's rule: a host knows that extension data exists, and its shape, but never its meaning.**

## The manifest

A manifest is declarative: no code runs. A project keeps a copy of each manifest it takes, so every machine and CI
read the same one. It is JSON (JSON5 is read too), and is called `<id>.extension.json`
(`MANIFEST_FILE_SUFFIX`).

```json5
{
  schema: "wildwinter/extension@0",
  id: "pattershot",               // lower case, digits and hyphens, starting with a letter
  name: "Pattershot",
  version: "1.2.0",               // major.minor.patch
  docs: "https://example.com/pattershot",
  settings: [                     // project settings, each naming a host field a claim presents
    { name: "moodField", label: "Mood field", help: "The card field holding the mood.", default: "mood" },
  ],
  targets: {
    storylets: {                  // a host: "patter" or "storylets"
      card: {                     // a node kind of that host
        fields: [ /* field declarations, below */ ],
        claims: [ /* claims on host fields, below */ ],
      },
    },
  },
}
```

- **Identity**: `id`, `name`, `version`, and optionally `docs`, a link to the extension's own documentation.
- **Targets**, by host and node kind:

  | Host | Node kinds | References | Kinds with host fields (claimable) |
  |---|---|---|---|
  | `patter` | `scene`, `block`, `snippet`, `line`, `text`, `gameEvent`, `option`, `project` | `cast`, `scene`, `block`, `snippet`, `line` | every kind but `project` (game data) |
  | `storylets` | `box`, `tagGroup`, `tag`, `deck`, `card`, `outcome`, `handTemplate`, `hand`, `project` | `box`, `deck`, `card`, `outcome`, `tag` | `card`, `outcome` (fields) |

- **Fields** per target, in the order the editor shows them.
- **Claims** on host fields, named through a project setting.

### Field declarations

```json5
{
  name: "mood",                   // an identifier, unique within the target (or the record)
  label: "Mood",                  // shown beside the control; the name when absent
  help: "How the line is played.",
  type: "enum",
  values: ["calm", "tense"],
  valueHelp: { calm: "Unhurried.", tense: "Clipped." },
  default: "calm",                // optional: the type's default when absent (below)
  required: true,                 // a node of this kind must set it
  group: "Delivery",              // a heading within the extension's group, in field order
  editorOnly: true,               // stripped at compile; editor data, never in the bundle
}
```

- `label`, `help`, `valueHelp` (one sentence per enum or flags value or quality stage) and `group` are for the
  editor, and never reach a bundle.
- `required`, `min` and `max` (numbers only) are validation.
- `editorOnly` is allowed on a target's own fields only, not inside a record.

### Claims on host fields

A claim presents a field the host already has, with this manifest's control, help and validation, without moving the
data. It names the field through a setting, so a project whose field has another name says so once:

```json5
{ setting: "moodField", type: "enum", values: ["calm", "tense"], label: "Mood", help: "..." }
```

A claim is a scalar. The project names the extension's settings when it opts in (each host's project shard says
how); a setting the project leaves out takes the setting's `default`. A claimed field keeps the host's own merge
rule, ladder and renames. Two extensions claiming one field is an error naming both (`claimClashes`); a host
whose field has a type other than the claim's is an error naming where (the host checks: in Storylets, per box).

## The types

| Type | Holds | Default when none is given | Merges |
|---|---|---|---|
| `text`, `multiline` | A string | `""` | Three-way: one side's change wins; two different changes clash |
| `number` | A number, within `min` and `max` when given | `0` | Three-way |
| `boolean` | `true` or `false` | `false` | Three-way |
| `enum` | One of `values`, or `""` (none chosen) | The first value | Three-way |
| `flags` | A set of `values` | `[]` | As a set, value by value |
| `quality` | One stage of `stages` (at least two, none empty, none twice) | The first stage | Three-way |
| `reference` | The id of a node of the kind named by `to` | `""` | Three-way; validated to exist |
| `record` | Named `fields`, each a field declaration | Each field's default | Field by field |
| `map` | Entries keyed by `key` (`{ type: "text" }` or `{ type: "reference", to }`), each of type `of` | `{}` | Key by key, then by the value's own type |
| `list` with `id` | Records, each carrying the text field named by `id`, unique in the list | `[]` | Union by id, each item by its own type; order kept |
| `list` without `id` | Values of type `of` | `[]` | Whole: two different changes clash |

The scalars are the family's field types, spelled as the family spells them: `text`, never `string`. A scalar's
default is the kernel's (`defaultFor` in `@wildwinter/scoperegistry`); a structured type's is built from its parts.
A default that is given must fit the type. Defaults are optional in source and resolved in each bundle
(`resolvedFields`), so a host's defaults helper always returns every declared field. A node's values stay raw and
sparse: "the node sets nothing" is told apart from "the node sets the default".

A value that does not fit is reported by `valueProblems`, through the kernel's `valueFits`. A quality value that
names no stage carries the stages either side of it as `options` (the kernel's `stagesEitherSide`, the whole
ladder for a stage that is gone).

### Stage renames

An extension's ladder belongs to its manifest. A version that renames a stage says so on the field:
`renamedStages: { "old": "new" }`, every name a stage has ever had to the stage it is now (a value of the map is a
current stage, a key is not). A host applies the renames (`renameStages`) to the extension's data when the project
takes the new version, as one step with the new pin, and compiles values through them meanwhile.

## Extension data

Each format keeps one shard per extension per scene (Patter) or per box (Storylets), plus one for the project. The
format-neutral part of a shard is:

```json5
{
  extension: "pattershot",        // the extension's id
  entries: {                      // by node kind, then node id
    card: {
      c_7k2: { mood: "tense", beats: [{ id: "b1", at: 2 }] },
    },
  },
  unresolved: [ /* the clashes of a merge nobody has resolved yet; absent otherwise */ ],
}
```

Everything under `entries` is the extension's, and a host's canonical form must not reorder it. An entry naming a
node that no longer exists is kept, and reported by the host's validation as a warning (`orphanedEntries`), never
silently dropped. A project that names an extension whose manifest is missing opens with a warning, and its data is
left untouched.

## Merge

`mergeExtensionData(base, ours, theirs, manifest?)`:

1. **By node id**: entries for different nodes never clash.
2. **Within a node, by the manifest's types**, as in the table above (`strategyForType`).
3. **A real clash** keeps our side and is named in the shard's `unresolved` entry.
4. **Without the manifest** (removed, unreadable, or itself in conflict in the same merge), a node's whole entry merges
   as one value: different nodes still merge cleanly, and two changes to the same node's entry clash.
5. An entry deleted on one side while it changes on the other clashes like any other value: ours stands, and the mark
   holds theirs. Data left without a node is kept and reported.

The merge reads the manifest from the project, never from what is installed, so every machine gives the same
result. A git merge driver receives three files and a path: it finds the project from the path and reads the
manifest from the working tree.

### The engine

`mergeTree(strategy, base, ours, theirs)` is the three-way merge both formats' shards use, a tree of five
behaviours (lifted from the Storylets format's strategy table):

- `atomic`: one value, classic three-way.
- `map(of)`: an open string-keyed map, each value merged by `of`.
- `set`: a list of strings as a set: additions union, deletions respected.
- `keyed(key, of)`: a list of objects keyed by the string field `key`; a delete against an edit and the same key added
  twice with different content are clashes. `order: "sorted"` (the default) sorts by key; `"preserve"` keeps the
  authored order, taking the side that reordered, and clashes when both did.
- `object(fields)`: named keys get their own strategy, every other key is atomic.

### The unresolved mark

**An unresolved merge is marked in the merged shard, in both formats.** `markUnresolved` writes the clashes into the
shard under the reserved key `unresolved` (`UNRESOLVED_KEY`), each with its path, its kind and the three values; a
mark already on either side is carried until somebody resolves it. Validation, and so CI, refuses a shard carrying
the mark (`unresolvedProblems`); resolving removes it. The mark travels with the file in every version control
system and needs no ignore rule. Conflict sidecars, where a format writes them, stay uncommitted.

This covers every shard of a format, not only extension shards.

## Conformance

`conformance/extensions/*.json` are the contract: hand-written cases for manifest validation, value validation,
defaults, stage renames and the merge, with their expectations. `test/extensions.test.ts` runs them. A host that
reimplements any part runs the same files.

This entry needs `@wildwinter/expr` and `@wildwinter/scoperegistry` (the kernel's value and ladder rules, and
`defaultFor`). They are optional peer dependencies of the toolkit, so a host that imports only the toolkit's main
entry installs nothing more.
