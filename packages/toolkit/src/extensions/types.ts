// ---------------------------------------------------------------------------
// The manifest's shapes, and what each host is.
//
// A manifest is data a project keeps a copy of, so every shape here is read
// from JSON as it came: the checks in manifest.ts say what is wrong with one,
// and nothing else in this package assumes a manifest is sound without them.
// ---------------------------------------------------------------------------

/** The manifest schema tag this build reads and writes. */
export const MANIFEST_SCHEMA = "wildwinter/extension@0";

/** What a manifest file is called: `<id>.extension.json`. */
export const MANIFEST_FILE_SUFFIX = ".extension.json";

/** The hosts an extension can target. */
export type HostName = "patter" | "storylets";

export interface HostSpec {
  /** The node kinds a target may name. */
  readonly kinds: readonly string[];
  /** The node kinds a `reference` may point at. */
  readonly references: readonly string[];
}

/** Each host's node kinds and references. */
export const HOSTS: Readonly<Record<HostName, HostSpec>> = {
  patter: {
    kinds: ["scene", "block", "snippet", "line", "text", "gameEvent", "option", "project"],
    references: ["cast", "scene", "block", "snippet", "line"],
  },
  storylets: {
    kinds: ["box", "tagGroup", "tag", "deck", "card", "outcome", "handTemplate", "hand", "project"],
    references: ["box", "deck", "card", "outcome", "tag"],
  },
};

/** The family's seven scalar types, spelled as the family spells them. */
export const SCALAR_TYPES = ["text", "multiline", "number", "boolean", "enum", "flags", "quality"] as const;
export type ScalarType = typeof SCALAR_TYPES[number];

/** Every type a value can take. */
export const VALUE_TYPES = [...SCALAR_TYPES, "reference", "pick", "record", "map", "list"] as const;
export type ValueType = typeof VALUE_TYPES[number];

/** A JSON value, as extension data holds it. */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/**
 * A value's type, with the constraints that belong to it. A target's fields
 * and a record's fields add a name and the editor's words (`FieldDecl`); the
 * `of` of a map or a list is a bare type.
 */
export interface TypeDecl {
  readonly type: string;
  /** An enum's values, or the flags a flags value may hold. */
  readonly values?: readonly string[];
  /** A quality's ladder. */
  readonly stages?: readonly string[];
  /** A quality's renames: every name a stage has had, to the stage it is now. */
  readonly renamedStages?: Readonly<Record<string, string>>;
  /** A reference's node kind. */
  readonly to?: string;
  /** A pick's sources, in the order its choices are shown. */
  readonly from?: readonly PickSource[];
  /** A record's fields. */
  readonly fields?: readonly FieldDecl[];
  /** A map's key. */
  readonly key?: { readonly type: string; readonly to?: string };
  /** A map's or a list's value type. */
  readonly of?: TypeDecl;
  /** A list's id field: the text field of its records that keys each item. */
  readonly id?: string;
  /** A number's bounds. */
  readonly min?: number;
  readonly max?: number;
  /** One sentence per enum or flags value, or quality stage. Editor only. */
  readonly valueHelp?: Readonly<Record<string, string>>;
  /** Optional in source: the type's own default when absent (`defaultOf`). */
  readonly default?: unknown;
}

/**
 * Where a pick's choices come from: fixed words, the nodes of a reference kind (by id, as a reference holds
 * them), or a list of text on the extension's own project node, by that field's name.
 */
export type PickSource =
  | { readonly words: readonly string[] }
  | { readonly to: string }
  | { readonly list: string };

/** A named field: a target's, or a record's. */
export interface FieldDecl extends TypeDecl {
  readonly name: string;
  readonly label?: string;
  readonly help?: string;
  /** A node of this kind must set it. */
  readonly required?: boolean;
  /** A heading within the extension's group in the editor. */
  readonly group?: string;
  /** Stripped at compile: editor data, never in a bundle. A target's own fields only. */
  readonly editorOnly?: boolean;
}

/** What an extension declares for one node kind of one host. */
export interface TargetDecl {
  readonly fields?: readonly FieldDecl[];
}

export interface Manifest {
  readonly schema: string;
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly docs?: string;
  readonly targets: Readonly<Partial<Record<HostName, Readonly<Record<string, TargetDecl>>>>>;
  /** Views the extension's installed package supplies (tier 2), each a web component a host opens in a window. */
  readonly views?: readonly ViewDecl[];
  /** Other extensions whose data this one's views read, by id. */
  readonly reads?: readonly string[];
}

/** A view: a web component in the extension's installed package, opened by a host in a floating window. */
export interface ViewDecl {
  /** Lower case, digits and hyphens, unique within the manifest. */
  readonly id: string;
  /** The window's title and the menu item. */
  readonly name: string;
  /** The component's script, a relative path within the package, such as `view/sheet.js`. */
  readonly entry: string;
  /** The custom element the script defines, such as `pattershot-sheet`. */
  readonly element: string;
  /** The hosts that offer it; every host the manifest targets when absent. */
  readonly hosts?: readonly HostName[];
}

/** One thing wrong, with where it is. A host words it in its own report shape. */
export interface Problem {
  readonly severity: "error" | "warning";
  /** A stable name for the kind of problem, for tests and quick fixes. */
  readonly code: string;
  /** Where, relative to what was checked: `targets.storylets.card.fields[2].stages`. */
  readonly path: string;
  readonly message: string;
  /** The values a quick fix may offer (an enum's values, the stages either side). */
  readonly options?: readonly string[];
}

/** The format-neutral part of an extension data shard. */
export interface ExtensionData {
  readonly extension: string;
  /** By node kind, then node id, then field name. */
  readonly entries: Readonly<Record<string, Readonly<Record<string, Readonly<Record<string, unknown>>>>>>;
  readonly unresolved?: readonly UnresolvedEntry[];
}

/** How a three-way merge failed to agree on one value. */
export type ConflictKind =
  | "both-changed"      // both sides changed the same value differently
  | "delete-vs-edit"    // one side deleted it, the other edited it
  | "added-both"        // both sides added it, with different content
  | "structural";       // a format's own post-merge check failed (a duplicate id)

/** One clash, as the reserved `unresolved` key of a merged shard holds it. */
export interface UnresolvedEntry {
  readonly path: string;
  readonly kind: ConflictKind;
  readonly base?: unknown;
  readonly ours?: unknown;
  readonly theirs?: unknown;
}
