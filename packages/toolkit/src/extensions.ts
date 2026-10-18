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
  ClaimDecl, ConflictKind, ExtensionData, FieldDecl, HostName, HostSpec, JsonValue, Manifest, Problem, ScalarType,
  SettingDecl, TargetDecl, TypeDecl, UnresolvedEntry, ValueType,
} from "./extensions/types.js";
export {
  claimClashes, manifestProblems, parseManifest, resolvedClaims, settingValues, targetOf,
} from "./extensions/manifest.js";
export type { ResolvedClaim } from "./extensions/manifest.js";
export {
  compileEntry, compiledTarget, defaultOf, entryProblems, renameStages, valueProblems,
} from "./extensions/values.js";
export type { StageRename, ValueContext } from "./extensions/values.js";
export {
  ATOMIC, SET, UNRESOLVED_KEY, extensionDataStrategy, keyedBy, mapOf, markUnresolved, mergeExtensionData, mergeTree,
  objectOf, orphanedEntries, stableStringify, strategyForTarget, strategyForType, unresolvedOf, unresolvedProblems,
  withoutMark,
} from "./extensions/merge.js";
export type { Conflict, DataMergeResult, MergeWarning, Strategy, TreeMergeOptions, TreeMergeResult } from "./extensions/merge.js";
export { atIndex, atKey } from "./extensions/path.js";
