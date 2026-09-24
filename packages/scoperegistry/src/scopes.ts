// ---------------------------------------------------------------------------
// Shared game scopes (patterkit/design/shared-scopes.md): the EDITING side of
// one registry per game.
//
// A game keeps one `game-scopes/` folder. Each tool writes its own
// `<tool>.scopes.json` there (its game-wide scopes and their declarations), the
// game keeps `game.scopes.json` (the scopes it provides itself, `@world` among
// them), and every tool reads the others to check, suggest, and preview names
// it doesn't own. Nothing here runs in a game: at run time the registry knows
// every scope because each engine registers what it owns.
//
// Pure functions only. The tools reach files in their own ways, and this
// package also ships inside game runtimes, so file access is the caller's:
// discovery takes the three file-system calls it needs as arguments.
// ---------------------------------------------------------------------------

import { ScopeRegistry } from "./index.js";
import type { ExpressionSchema, PropertyType, ScalarValue, ScopeDeclaration, ScopeRegistrySpec, ScopeSpec } from "./index.js";

/** The folder a game keeps its scopes in, found by walking up from a project. */
export const GAME_SCOPES_DIR = "game-scopes";
/** Every scopes file ends so; the part before it names the file's writer. */
export const SCOPES_FILE_SUFFIX = ".scopes.json";
/** The game's own file: the scopes the game provides itself (`@world` and any others). */
export const GAME_SCOPES_FILE = "game.scopes.json";
/** The scopes-file versions this build reads. */
export const SCOPES_FILE_VERSION = 1;

/** One tool's (or the game's) scopes: a `ScopeRegistrySpec` with the name of who wrote it. */
export interface ScopesFile extends ScopeRegistrySpec {
  /** Who owns these scopes, as a game developer knows it ("Patter", "Storylet Engine", "Game"). */
  owner: string;
}

/** A scopes file with the name it was read from, for issues and for ownership. */
export interface NamedScopesFile {
  fileName: string;
  file: ScopesFile;
}

/** A problem with a scopes file or with the folder as a whole. */
export interface ScopesIssue {
  severity: "error" | "warning";
  /** The file it concerns, as the caller named it. */
  file: string;
  message: string;
}

const TYPES: readonly PropertyType[] = ["boolean", "number", "string", "enum", "flags", "quality"];
const isScalar = (v: unknown): v is ScalarValue =>
  typeof v === "boolean" || typeof v === "number" || typeof v === "string"
  || (Array.isArray(v) && v.every((x) => typeof x === "string"));
const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

/**
 * Read one scopes file. Returns the file with only the fields this format knows, or no file and
 * issues naming what is wrong: a file another tool wrote badly is reported, never thrown.
 */
export function parseScopesFile(text: string, fileName: string): { file?: ScopesFile; issues: ScopesIssue[] } {
  const issues: ScopesIssue[] = [];
  const fail = (message: string): { issues: ScopesIssue[] } => ({ issues: [...issues, { severity: "error", file: fileName, message }] });
  let raw: unknown;
  try { raw = JSON.parse(text); } catch (e) { return fail(`not valid JSON: ${e instanceof Error ? e.message : String(e)}`); }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail("a scopes file is a JSON object");
  const o = raw as Record<string, unknown>;
  if (o.version !== SCOPES_FILE_VERSION) return fail(`unsupported version ${JSON.stringify(o.version)} (this build reads ${SCOPES_FILE_VERSION})`);
  if (typeof o.owner !== "string" || o.owner.trim() === "") return fail("owner must name who wrote the file");
  if (!Array.isArray(o.scopes)) return fail("scopes must be an array");

  const scopes: ScopeSpec[] = [];
  const tokens = new Set<string>();
  for (const [i, s] of o.scopes.entries()) {
    if (!s || typeof s !== "object") return fail(`scopes[${i}] must be an object`);
    const sr = s as Record<string, unknown>;
    if (typeof sr.token !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(sr.token)) return fail(`scopes[${i}] needs a token (letters, digits, underscores)`);
    if (tokens.has(sr.token)) return fail(`scope '@${sr.token}' is declared twice`);
    tokens.add(sr.token);
    if (sr.writable !== undefined && typeof sr.writable !== "boolean") return fail(`@${sr.token}: writable must be true or false`);
    const scope: ScopeSpec = { token: sr.token, ...(sr.writable !== undefined ? { writable: sr.writable as boolean } : {}) };
    if (sr.declarations !== undefined) {
      if (!Array.isArray(sr.declarations)) return fail(`@${sr.token}: declarations must be an array`);
      const names = new Set<string>();
      const decls: ScopeDeclaration[] = [];
      for (const d of sr.declarations) {
        const dr = (d && typeof d === "object" ? d : {}) as Record<string, unknown>;
        if (typeof dr.name !== "string" || dr.name === "") return fail(`@${sr.token}: every declaration needs a name`);
        const at = `@${sr.token}.${dr.name}`;
        if (names.has(dr.name.toLowerCase())) return fail(`${at} is declared twice`);
        names.add(dr.name.toLowerCase());
        if (!TYPES.includes(dr.type as PropertyType)) return fail(`${at}: type must be one of ${TYPES.join(", ")}`);
        if (dr.values !== undefined && !isStrings(dr.values)) return fail(`${at}: values must be a list of strings`);
        if (dr.stages !== undefined && !isStrings(dr.stages)) return fail(`${at}: stages must be a list of strings`);
        if (dr.default !== undefined && !isScalar(dr.default)) return fail(`${at}: default must be a boolean, number, string, or list of strings`);
        if (dr.writable !== undefined && typeof dr.writable !== "boolean") return fail(`${at}: writable must be true or false`);
        if (dr.purpose !== undefined && typeof dr.purpose !== "string") return fail(`${at}: purpose must be text`);
        decls.push({
          name: dr.name, type: dr.type as PropertyType,
          ...(dr.values !== undefined ? { values: dr.values as string[] } : {}),
          ...(dr.stages !== undefined ? { stages: dr.stages as string[] } : {}),
          ...(dr.default !== undefined ? { default: dr.default as ScalarValue } : {}),
          ...(dr.writable !== undefined ? { writable: dr.writable as boolean } : {}),
          ...(dr.purpose !== undefined ? { purpose: dr.purpose as string } : {}),
        });
      }
      scope.declarations = decls;
    }
    scopes.push(scope);
  }
  return { file: { version: SCOPES_FILE_VERSION, owner: o.owner, scopes }, issues };
}

/**
 * The canonical text of a scopes file: fixed key order, declarations in the order given, two-space
 * indent, a final newline, no timestamps. Every tool writes through this, so a file changes only when
 * its content does, and comparing the text a tool would write with the text on disk is the staleness
 * check.
 */
export function serialiseScopesFile(file: ScopesFile): string {
  const out = {
    version: SCOPES_FILE_VERSION,
    owner: file.owner,
    scopes: file.scopes.map((s) => ({
      token: s.token,
      ...(s.writable !== undefined ? { writable: s.writable } : {}),
      ...(s.declarations !== undefined ? {
        declarations: s.declarations.map((d) => ({
          name: d.name, type: d.type,
          ...(d.values !== undefined ? { values: d.values } : {}),
          ...(d.stages !== undefined ? { stages: d.stages } : {}),
          ...(d.default !== undefined ? { default: d.default } : {}),
          ...(d.writable !== undefined ? { writable: d.writable } : {}),
          ...(d.purpose !== undefined ? { purpose: d.purpose } : {}),
        })),
      } : {}),
    })),
  };
  return JSON.stringify(out, null, 2) + "\n";
}

/** The three file-system calls discovery needs, supplied by the tool. */
export interface ScopesFs {
  /** Whether a file or folder exists at the path. */
  exists(path: string): boolean;
  /** The folder above, or undefined (or the same path) at the top. */
  parent(path: string): string | undefined;
  /** A path inside a folder; also resolves a relative override (`../shared/game-scopes`). */
  join(dir: string, name: string): string;
}

/**
 * Find a project's game scopes folder. With an override (a path relative to the project folder), that
 * folder, which must exist. Otherwise walk up from the project folder, the folder itself first, to the
 * first one holding `game-scopes/`, stopping at the version-control root (a folder holding `.git`) or
 * the top of the file system, so a folder above the repository is never picked up. No folder is not
 * an error: the tool works alone.
 */
export function findGameScopes(projectDir: string, fs: ScopesFs, opts: { override?: string } = {}): { dir?: string; issue?: string } {
  if (opts.override !== undefined) {
    const dir = fs.join(projectDir, opts.override);
    return fs.exists(dir) ? { dir } : { issue: `the project names a game scopes folder that doesn't exist: ${dir}` };
  }
  let dir = projectDir;
  for (;;) {
    const here = fs.join(dir, GAME_SCOPES_DIR);
    if (fs.exists(here)) return { dir: here };
    if (fs.exists(fs.join(dir, ".git"))) return {};
    const up = fs.parent(dir);
    if (up === undefined || up === dir) return {};
    dir = up;
  }
}

/** Every scope in the folder, merged into one spec, with who declared each. */
export interface MergedScopes {
  spec: ScopeRegistrySpec;
  /** Token -> the file that declares it and its owner. */
  owners: Map<string, { owner: string; fileName: string }>;
  issues: ScopesIssue[];
}

/**
 * Merge the folder's files into one spec. A token two files declare is an error naming both (the
 * same rule the registry enforces when a game combines its engines, surfaced while editing); the file
 * that sorts first keeps it, so the result doesn't depend on the order the caller read them in.
 */
export function mergeScopes(files: readonly NamedScopesFile[]): MergedScopes {
  const owners = new Map<string, { owner: string; fileName: string }>();
  const scopes: ScopeSpec[] = [];
  const issues: ScopesIssue[] = [];
  for (const { fileName, file } of [...files].sort((a, b) => a.fileName.localeCompare(b.fileName))) {
    for (const s of file.scopes) {
      const held = owners.get(s.token);
      if (held) {
        issues.push({ severity: "error", file: fileName,
          message: `scope '@${s.token}' is declared by both ${held.fileName} (${held.owner}) and ${fileName} (${file.owner})` });
        continue;
      }
      owners.set(s.token, { owner: file.owner, fileName });
      scopes.push(s);
    }
  }
  return { spec: { version: 1, scopes }, owners, issues };
}

const without = (merged: MergedScopes, except?: readonly string[]): ScopeSpec[] =>
  merged.spec.scopes.filter((s) => !(except ?? []).includes(s.token));

/** One scope's declarations, or undefined when nobody declares the token (or it is opaque). */
export function declarationsOf(merged: MergedScopes, token: string): ScopeDeclaration[] | undefined {
  return merged.spec.scopes.find((s) => s.token === token)?.declarations;
}

/**
 * The validator's schema for the merged scopes (names lower-cased, as the registry normalises them;
 * quality ladders carried). An opaque scope is left out, so its names stay unchecked, and so are the
 * `except` tokens: the calling tool's own scopes, which it knows better than its last-written file.
 */
export function scopesSchema(merged: MergedScopes, opts: { except?: readonly string[] } = {}): ExpressionSchema {
  const properties = new Map<string, Map<string, { type: PropertyType; enumValues?: string[]; stages?: string[] }>>();
  for (const s of without(merged, opts.except)) {
    if (!s.declarations) continue;
    const m = new Map<string, { type: PropertyType; enumValues?: string[]; stages?: string[] }>();
    for (const d of s.declarations) m.set(d.name.toLowerCase(), {
      type: d.type,
      ...(d.values !== undefined ? { enumValues: d.values } : {}),
      ...(d.stages !== undefined ? { stages: d.stages } : {}),
    });
    properties.set(s.token, m);
  }
  return { properties };
}

/** One property as an expression editor's picker offers it. */
export interface ScopesCatalogueEntry {
  scope: string;
  name: string;
  type: PropertyType;
  enumValues?: string[];
  stages?: string[];
  purpose?: string;
  /** Who declares it, for the picker's group or tip. */
  owner: string;
}

/** The merged scopes' properties for an editor's picker, in declaration order (see `scopesSchema` for `except`). */
export function scopesCatalogue(merged: MergedScopes, opts: { except?: readonly string[] } = {}): ScopesCatalogueEntry[] {
  const out: ScopesCatalogueEntry[] = [];
  for (const s of without(merged, opts.except)) {
    const owner = merged.owners.get(s.token)?.owner ?? "";
    for (const d of s.declarations ?? []) out.push({
      scope: s.token, name: d.name, type: d.type,
      ...(d.values !== undefined ? { enumValues: d.values } : {}),
      ...(d.stages !== undefined ? { stages: d.stages } : {}),
      ...(d.purpose !== undefined ? { purpose: d.purpose } : {}),
      owner,
    });
  }
  return out;
}

/**
 * What an editor or compiler should say about a reference into another tool's scope, or undefined when
 * there is nothing to say: a token nobody declares (the shared vocabulary accepts it, unchecked), an
 * opaque scope, or a declared name read (or written, when writable). A type mismatch is the validator's
 * to find, from `scopesSchema`.
 */
export function referenceNote(merged: MergedScopes, token: string, name: string, opts: { write?: boolean } = {}): string | undefined {
  const scope = merged.spec.scopes.find((s) => s.token === token);
  if (!scope?.declarations) return undefined;
  const who = merged.owners.get(token);
  const from = who ? `${who.owner} (${GAME_SCOPES_DIR}/${who.fileName})` : "its owner";
  const decl = scope.declarations.find((d) => d.name.toLowerCase() === name.toLowerCase());
  if (!decl) return `@${token}.${name} is not declared by ${from}`;
  if (opts.write && (decl.writable ?? scope.writable ?? true) === false) return `@${token}.${name} is read-only: ${from} declares it so`;
  return undefined;
}

/**
 * A registry for a PREVIEW in one tool: every merged scope except the tool's own, each owned and
 * seeded from its declared defaults, so content that names another engine's scope can play before
 * that engine is present. An opaque scope stands in empty. Never for a game: a game's registry holds
 * the real engines.
 */
export function standInRegistry(merged: MergedScopes, opts: { except?: readonly string[] } = {}): ScopeRegistry {
  const registry = new ScopeRegistry();
  for (const s of without(merged, opts.except)) {
    // A scope-level `writable: false` binds each declaration that doesn't say otherwise, as it does
    // in a foreign scope, so a preview refuses the writes a game would.
    const decls = (s.declarations ?? []).map((d) =>
      d.writable === undefined && s.writable !== undefined ? { ...d, writable: s.writable } : d);
    registry.defineOwned(s.token, decls, { owner: merged.owners.get(s.token)?.owner ?? "Game" });
  }
  return registry;
}
