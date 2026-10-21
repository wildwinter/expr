// ---------------------------------------------------------------------------
// @wildwinter/toolkit/extensions: the shared spec and merge for Patter
// extensions and Storylet extensions. extensions.md is the spec;
// conformance/extensions/ is the contract.
//
// A subpath of its own because it needs the kernel (`@wildwinter/expr` and
// `@wildwinter/scoperegistry`, optional peer dependencies every host of it
// already has) and the rest of the toolkit does not.
// ---------------------------------------------------------------------------

export {
  HOSTS, MANIFEST_FILE_SUFFIX, MANIFEST_SCHEMA, SCALAR_TYPES, VALUE_TYPES,
} from "./extensions/types.js";
export type {
  ConflictKind, ExtensionData, FieldDecl, HostName, HostSpec, JsonValue, Manifest, PickSource, Problem, ScalarType,
  TargetDecl, TypeDecl, UnresolvedEntry, ValueType, ViewDecl,
} from "./extensions/types.js";
export {
  isViewEntry, manifestProblems, parseManifest, targetOf, viewsFor,
} from "./extensions/manifest.js";
export {
  compileEntry, compiledTarget, defaultOf, entryProblems, isTextList, pickChoices, pickClashes, pickLists, renameStages,
  valueProblems,
} from "./extensions/values.js";
export type { PickChoice, PickSources, StageRename, ValueContext } from "./extensions/values.js";
export {
  ATOMIC, COMMENTS, SET, UNRESOLVED_KEY, extensionDataStrategy, keyedBy, mapOf, markUnresolved, mergeComments, mergeExtensionData,
  mergeTree, objectOf, orphanedEntries, stableStringify, strategyForTarget, strategyForType, unresolvedOf,
  unresolvedProblems, withoutMark,
} from "./extensions/merge.js";
export type { Conflict, DataMergeResult, MergeWarning, Strategy, TreeMergeOptions, TreeMergeResult } from "./extensions/merge.js";
export { atIndex, atKey } from "./extensions/path.js";
