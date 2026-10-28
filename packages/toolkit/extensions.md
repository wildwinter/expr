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
  targets: {
    storylets: {                  // a host: "patter" or "storylets"
      card: {                     // a node kind of that host
        fields: [ /* field declarations, below */ ],
      },
    },
  },
}
```

- **Identity**: `id`, `name`, `version`, and optionally `docs`, a link to the extension's own documentation.
- **Targets**, by host and node kind:

  | Host | Node kinds | References |
  |---|---|---|
  | `patter` | `scene`, `block`, `snippet`, `line`, `text`, `gameEvent`, `option`, `project` | `cast`, `scene`, `block`, `snippet`, `line` |
  | `storylets` | `box`, `tagGroup`, `tag`, `deck`, `card`, `outcome`, `handTemplate`, `hand`, `project` | `box`, `deck`, `card`, `outcome`, `tag` |

- **Fields** per target, in the order the editor shows them. An extension's data is always its own: it never puts
  its control on a field the host already has. A value the whole project shares is a field on the `project` target.

### Views and reads

A manifest can declare views: web components in the extension's installed package, each opened by a host in a
floating window of its own, sandboxed, talking to the host only through the host API (`@wildwinter/app-shell`'s
`view-client`). The project's copy of the manifest declares them; the code comes from the package installed on the
machine, never from the project folder.

```json5
views: [
  { id: "sheet", name: "Performance sheet", entry: "view/sheet.js", element: "pattershot-sheet", hosts: ["patter"] },
],
reads: ["patterstage"],
```

- `id`: lower case, digits and hyphens, unique among the views; `name`: the window's title and the menu item.
- `entry`: the component's script, a relative `.js` path inside the package, with no `.` or `..` segment
  (`isViewEntry`). `element`: the custom element it defines, lower case with a hyphen, unique among the views.
- `hosts`: the hosts that offer the view. When absent, every host the manifest targets does; naming a host the
  manifest targets nothing in is a warning. `viewsFor(manifest, host)` lists what a host offers.
- `reads`: other extensions whose data the views read, by id. An extension always reads its own; naming itself is a
  warning.

### Requirements

```json5
requires: ["patterstage"],
```

`requires` names other extensions, by id, that a project must take for this one to work: Pattershot's runner
attaches to Patterstage's Director, so a project with Pattershot and no Patterstage can't play its performances.
Each id appears once, and never the extension's own. A host refuses to add an extension whose requirements the
project doesn't take (or offers to add them first), its validation warns of a project that takes one without them,
and it tells the extension's views which are missing. `missingRequirements(manifest, taken)` lists them.

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
  editor: "sheet",                // a map of records only: one of the manifest's views edits it
}
```

- `label`, `help`, `valueHelp` (one sentence per enum or flags value, quality stage, or a pick's fixed word) and
  `group` are for the editor, and never reach a bundle.
- `required`, `min` and `max` (numbers only) are validation.
- `editorOnly` is allowed on a target's own fields only, not inside a record.
- `editor` names one of the manifest's views, by id, that edits the field: the host's inspector opens that view at
  the node instead of its own grid for a map of records. It's allowed on a target's own fields only, the view must
  open in that target's host, and on a field that isn't a map of records it's warned of and ignored, as such a field
  is edited in place.

### Removed keys

Earlier versions of the spec had `settings`, each naming a host field, and `claims` on a target, presenting that
host field with the manifest's control. Both are gone: a manifest that still carries one is warned of by name
(`removed-key`) and the key is ignored. Declare a field of the extension's own instead, which the runtimes hand
the game with every other extension value.

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
| `pick` | One choice from the sources in `from` (below), as text, or `""` (automatic) | `""` | Three-way; validated against its sources |
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

### Picks

A pick is a single choice whose choices come from sources the manifest names, in the order they're shown:

```json5
{ name: "to", type: "pick", from: [{ words: ["all"] }, { to: "cast" }, { list: "pointsOfInterest" }] }
```

- `words`: fixed words, named once each.
- `to`: the nodes of a reference kind (the table above), held by id as a reference holds them.
- `list`: a list of text (`{ type: "list", of: { type: "text" } }`, no `id`) on the extension's own `project`
  target, by that field's name; the project node's value, else the field's default (`pickLists`).

Empty is automatic: no word for it is stored, and an editor shows it as "auto". A pick isn't an `enum` whose values
change: an enum's values are fixed and checked against the manifest, a pick's are the project's.

`valueHelp` may describe a pick's fixed `words`, never its nodes or lists, which are the project's.

`valueProblems` reports a value no source holds (`not-a-choice`, an error), given the host's nodes (`exists`) and
lists (`list`) in its context; a source it can't see is not checked, so a value is reported missing only when every
source can say. A value two sources hold is ambiguous (`pick-ambiguous`, a warning), and `pickClashes` reports each
such name once for the project (`pick-clash`). `pickChoices` lists the choices, source by source, for an editor to
draw.

A host that renames a node of a `to` source rewrites the values naming it, as it rewrites references. A renamed
entry of a project list isn't followed: a list of text can't tell a rename from a removal and an addition, so a value
naming the old entry is reported missing.

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

`mergeTree(strategy, base, ours, theirs)` is the three-way merge both formats' shards use, a tree of six
behaviours (lifted from the Storylets format's strategy table):

- `atomic`: one value, classic three-way.
- `map(of)`: an open string-keyed map, each value merged by `of`.
- `set`: a list of strings as a set: additions union, deletions respected.
- `keyed(key, of)`: a list of objects keyed by the string field `key`; a delete against an edit and the same key added
  twice with different content are clashes. `order: "sorted"` (the default) sorts by key; `"preserve"` keeps the
  authored order, taking the side that reordered, and clashes when both did.
- `object(fields)`: named keys get their own strategy, every other key is atomic.
- `comments`: a list of comment threads, keyed by id, merged message by message (`mergeComments`). Messages are
  keyed by author and timestamp and are the union of both sides', oldest first; a withdrawn message stays
  withdrawn, and one a side removed, or lost with its thread, counts as withdrawn by that side; one message edited
  two ways clashes. A thread's own fields merge one by one, and a thread with nothing readable left goes. Threads
  come back oldest first.

### The unresolved mark

**An unresolved merge is marked in the merged shard, in both formats.** `markUnresolved` writes the clashes into the
shard under the reserved key `unresolved` (`UNRESOLVED_KEY`), each with its path, its kind and the three values; a
mark already on either side is carried until somebody resolves it. Validation, and so CI, refuses a shard carrying
the mark (`unresolvedProblems`); resolving removes it. A resolver reads the clashes with `unresolvedOf` and, as each
is settled, takes it out with `clearUnresolved`, which drops the key with the last one. The mark travels with the
file in every version control system and needs no ignore rule. Conflict sidecars, where a format writes them, stay
uncommitted.

This covers every shard of a format, not only extension shards.

## Conformance

`conformance/extensions/*.json` are the contract: hand-written cases for manifest validation, value validation,
defaults, stage renames, picks and the merge, with their expectations. `test/extensions.test.ts` runs them. A host that
reimplements any part runs the same files.

This entry needs `@wildwinter/expr` and `@wildwinter/scoperegistry` (the kernel's value and ladder rules, and
`defaultFor`). They are optional peer dependencies of the toolkit, so a host that imports only the toolkit's main
entry installs nothing more.
