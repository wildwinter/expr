// ---------------------------------------------------------------------------
// Values against their declarations: the checks, the defaults, what a bundle
// carries, and stage renames.
//
// The scalar checks are the kernel's (`valueFits`, `stagesEitherSide`), so a
// value an extension holds is judged by the rule every field and property in
// both formats is. What this file adds is the structured types, which walk
// down to scalars, and the extension's own constraints (ranges, required
// fields, references).
// ---------------------------------------------------------------------------

import { stagesEitherSide, valueFits } from "@wildwinter/expr";
import { defaultFor } from "@wildwinter/scoperegistry";
import { atIndex, atKey, isObject, own } from "./path.js";
import type { FieldDecl, Problem, TargetDecl, TypeDecl } from "./types.js";

/** What the host knows about its nodes, for references. */
export interface ValueContext {
  /** Does a node of `kind` with `id` exist? Absent, references are not checked
   *  (a host checking a manifest's default, say, has no nodes to hand). */
  readonly exists?: (kind: string, id: string) => boolean;
}

const typeWord = (v: unknown): string =>
  (Array.isArray(v) ? "a list" : v === null ? "null" : isObject(v) ? "an object" : `a ${typeof v}`);

const where = (path: string): string => (path === "" ? "the value" : `"${path}"`);

const err = (code: string, path: string, message: string, options?: readonly string[]): Problem =>
  ({ severity: "error", code, path, message, ...(options !== undefined ? { options } : {}) });

/** Every problem with `value` as a value of `decl`, paths relative to the value. */
export function valueProblems(decl: TypeDecl, value: unknown, ctx: ValueContext = {}, path = ""): Problem[] {
  const out: Problem[] = [];
  const wrong = (expected: string): void => {
    out.push(err("wrong-type", path, `${where(path)} should be ${expected}, not ${typeWord(value)}`));
  };
  switch (decl.type) {
    case "text":
    case "multiline":
      if (typeof value !== "string") wrong("text");
      break;
    case "boolean":
      if (typeof value !== "boolean") wrong("true or false");
      break;
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) { wrong("a number"); break; }
      if (typeof decl.min === "number" && value < decl.min) {
        out.push(err("below-min", path, `${where(path)} is ${value}, below the least it may be, ${decl.min}`));
      }
      if (typeof decl.max === "number" && value > decl.max) {
        out.push(err("above-max", path, `${where(path)} is ${value}, above the most it may be, ${decl.max}`));
      }
      break;
    case "enum":
      if (typeof value !== "string") { wrong("one of its values"); break; }
      if (!valueFits(decl, value, { noneChosen: true })) {
        out.push(err("not-a-value", path, `${where(path)} is "${value}", which is not one of its values`, [...(decl.values ?? [])]));
      }
      break;
    case "flags":
      if (!Array.isArray(value) || !value.every((f) => typeof f === "string")) { wrong("a list of its flags"); break; }
      if (!valueFits(decl, value)) {
        const odd = value.filter((f) => !(decl.values ?? []).includes(f as string));
        out.push(err("not-a-value", path, `${where(path)} names ${odd.map((f) => `"${f}"`).join(", ")}, not among its flags`, [...(decl.values ?? [])]));
      }
      break;
    case "quality": {
      if (typeof value !== "string") { wrong("one of its stages"); break; }
      if (valueFits(decl, value)) break;
      const renamed = renamedStage(decl, value);
      if (renamed !== undefined) {
        // A warning: a host compiles the value through the rename, and the
        // project takes the new name when it takes the version (`renameStages`).
        out.push({ severity: "warning", code: "renamed-stage", path, options: [renamed],
          message: `${where(path)} is "${value}", a stage this extension has since renamed "${renamed}"` });
      } else {
        out.push(err("not-a-stage", path, `${where(path)} is "${value}", which is not one of its stages`, stagesEitherSide(decl, value)));
      }
      break;
    }
    case "reference":
      if (typeof value !== "string") { wrong(`the id of a ${decl.to ?? "node"}`); break; }
      if (value !== "" && ctx.exists && decl.to !== undefined && !ctx.exists(decl.to, value)) {
        out.push(err("no-such-node", path, `${where(path)} names ${decl.to} "${value}", which does not exist`));
      }
      break;
    case "record":
      if (!isObject(value)) { wrong("an object"); break; }
      out.push(...fieldsProblems(decl.fields ?? [], value, ctx, path));
      break;
    case "map": {
      if (!isObject(value)) { wrong("an object"); break; }
      const key = decl.key;
      for (const [k, v] of Object.entries(value)) {
        const at = atKey(path, k);
        if (key?.type === "reference" && ctx.exists && key.to !== undefined && !ctx.exists(key.to, k)) {
          out.push(err("no-such-node", at, `${where(at)} is keyed by ${key.to} "${k}", which does not exist`));
        }
        if (decl.of) out.push(...valueProblems(decl.of, v, ctx, at));
      }
      break;
    }
    case "list": {
      if (!Array.isArray(value)) { wrong("a list"); break; }
      const seen = new Set<string>();
      value.forEach((item, i) => {
        const at = atIndex(path, i);
        if (decl.id !== undefined && isObject(item)) {
          const id = item[decl.id];
          const idAt = atKey(at, decl.id);
          if (typeof id !== "string" || id === "") {
            out.push(err("missing-id", idAt, `${where(at)} has no "${decl.id}", which keys every item of this list`));
          } else if (seen.has(id)) {
            out.push(err("duplicate-id", idAt, `${where(at)} repeats the id "${id}"`));
          } else {
            seen.add(id);
          }
        }
        if (decl.of) out.push(...valueProblems(decl.of, item, ctx, at));
      });
      break;
    }
    default:
      // A type this build does not know constrains nothing: a newer manifest's
      // field is the manifest check's to report, not a reason to refuse data.
      break;
  }
  return out;
}

/** Named fields against an object: required fields, unknown ones, each value. */
function fieldsProblems(fields: readonly FieldDecl[], value: Record<string, unknown>, ctx: ValueContext, path: string): Problem[] {
  const out: Problem[] = [];
  const named = new Map(fields.map((f) => [f.name, f]));
  for (const f of fields) {
    if (f.required === true && !own(value, f.name)) {
      const at = atKey(path, f.name);
      out.push(err("required", at, `${where(at)} is required and not set`));
    }
  }
  for (const [k, v] of Object.entries(value)) {
    const at = atKey(path, k);
    const f = named.get(k);
    if (f === undefined) {
      out.push({ severity: "warning", code: "unknown-field", path: at,
        message: `${where(at)} is not a field this extension declares; it is kept, and not compiled` });
      continue;
    }
    out.push(...valueProblems(f, v, ctx, at));
  }
  return out;
}

/** Every problem with one node's entry, against its target. */
export function entryProblems(target: TargetDecl, entry: unknown, ctx: ValueContext = {}, path = ""): Problem[] {
  if (!isObject(entry)) {
    return [err("wrong-type", path, `${where(path)} should be an object of field values, not ${typeWord(entry)}`)];
  }
  return fieldsProblems(target.fields ?? [], entry, ctx, path);
}

// --- defaults -------------------------------------------------------------------

/**
 * A declaration's default: the one it gives, else its type's. A scalar's is
 * the kernel's (`defaultFor`: false, 0, "", the first enum value, no flags,
 * the first stage), a reference's is none (""), a record's is each of its
 * fields' defaults, a map's and a list's are empty.
 */
export function defaultOf(decl: TypeDecl): unknown {
  if (decl.default !== undefined) return decl.default;
  switch (decl.type) {
    case "reference": return "";
    case "record": return Object.fromEntries((decl.fields ?? []).map((f) => [f.name, defaultOf(f)]));
    case "map": return {};
    case "list": return [];
    default:
      return defaultFor({
        type: decl.type,
        ...(decl.values !== undefined ? { values: decl.values } : {}),
        ...(decl.stages !== undefined ? { stages: decl.stages } : {}),
      });
  }
}

// --- what a bundle carries ------------------------------------------------------

/** The editor's words, and the manifest's own bookkeeping: never in a bundle. */
const EDITOR_KEYS = new Set(["label", "help", "valueHelp", "group", "editorOnly", "renamedStages"]);

/** One declaration as a bundle carries it: the editor's words gone, the default resolved, all the way down. */
function compiledDecl<D extends TypeDecl>(decl: D): D {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(decl)) if (!EDITOR_KEYS.has(k)) out[k] = v;
  if (decl.fields !== undefined) out["fields"] = decl.fields.map((f) => compiledDecl(f));
  if (decl.of !== undefined) out["of"] = compiledDecl(decl.of);
  out["default"] = defaultOf(decl);
  return out as D;
}

/** A target's fields with every default resolved and the editor's words gone, as a bundle carries them;
 *  editor-only fields are left out. */
export function compiledTarget(target: TargetDecl): FieldDecl[] {
  return (target.fields ?? []).filter((f) => f.editorOnly !== true).map((f) => stripOfDefaults(compiledDecl(f)));
}

/** The `of` of a map or a list is a bare type: its items are each node's own. */
function stripOfDefaults<D extends TypeDecl>(decl: D): D {
  const out: Record<string, unknown> = { ...(decl as TypeDecl) };
  if (decl.of !== undefined) {
    const { default: _drop, ...rest } = decl.of as TypeDecl & { default?: unknown };
    out["of"] = stripOfDefaults(rest as TypeDecl);
  }
  if (decl.fields !== undefined) out["fields"] = decl.fields.map((f) => stripOfDefaults(f));
  return out as D;
}

/**
 * A node's values as a bundle carries them: raw and sparse, with editor-only
 * and undeclared fields left out and renamed stages renamed. Undefined when
 * nothing is left, so a host writes no `extensions` entry for the node.
 */
export function compileEntry(target: TargetDecl, entry: Readonly<Record<string, unknown>>): Record<string, unknown> | undefined {
  const renamed = renameStages(target, entry).entry;
  const out: Record<string, unknown> = {};
  const named = new Map((target.fields ?? []).map((f) => [f.name, f]));
  for (const k of Object.keys(renamed).sort()) {
    const f = named.get(k);
    if (f === undefined || f.editorOnly === true) continue;
    out[k] = renamed[k];
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

// --- stage renames --------------------------------------------------------------

/** The stage an old name was renamed to, when the declaration says it was. */
function renamedStage(decl: TypeDecl, value: string): string | undefined {
  const map = decl.renamedStages;
  if (map === undefined || !own(map, value)) return undefined;
  const to = map[value];
  return typeof to === "string" && (decl.stages ?? []).includes(to) ? to : undefined;
}

export interface StageRename {
  readonly path: string;
  readonly from: string;
  readonly to: string;
}

/** Rename every stage the manifest says was renamed, at any depth. Returns the
 *  entry (a new object when anything changed) and the renames made. */
export function renameStages(target: TargetDecl, entry: Readonly<Record<string, unknown>>): { entry: Record<string, unknown>; renames: StageRename[] } {
  const renames: StageRename[] = [];
  const walk = (decl: TypeDecl, value: unknown, path: string): unknown => {
    switch (decl.type) {
      case "quality": {
        if (typeof value !== "string" || (decl.stages ?? []).includes(value)) return value;
        const to = renamedStage(decl, value);
        if (to === undefined) return value;
        renames.push({ path, from: value, to });
        return to;
      }
      case "record":
        return isObject(value) ? walkFields(decl.fields ?? [], value, path) : value;
      case "map":
        if (!isObject(value) || decl.of === undefined) return value;
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(decl.of!, v, atKey(path, k))]));
      case "list":
        if (!Array.isArray(value) || decl.of === undefined) return value;
        return value.map((v, i) => walk(decl.of!, v, atIndex(path, i)));
      default:
        return value;
    }
  };
  const walkFields = (fields: readonly FieldDecl[], value: Readonly<Record<string, unknown>>, path: string): Record<string, unknown> => {
    const named = new Map(fields.map((f) => [f.name, f]));
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const f = named.get(k);
      out[k] = f === undefined ? v : walk(f, v, atKey(path, k));
    }
    return out;
  };
  const out = walkFields(target.fields ?? [], entry, "");
  return { entry: renames.length > 0 ? out : { ...entry }, renames };
}
