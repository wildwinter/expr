// ---------------------------------------------------------------------------
// Manifest checks.
//
// A manifest is pinned and referenced, and nobody in the project edits it, so
// a fault in one is the extension author's. The checks still run in every
// project that takes it, because a project's validation is the only thing
// standing between a broken manifest and a host reading it.
// ---------------------------------------------------------------------------

import { qualityDeclarationProblems } from "@wildwinter/expr";
import { parseSource } from "../source.js";
import { atIndex, atKey, isObject, own } from "./path.js";
import { HOSTS, MANIFEST_SCHEMA, SCALAR_TYPES, VALUE_TYPES } from "./types.js";
import type { ClaimDecl, FieldDecl, HostName, Manifest, Problem, SettingDecl, TargetDecl, TypeDecl } from "./types.js";
import { isTextList, valueProblems } from "./values.js";

const ID = /^[a-z][a-z0-9-]*$/;
const VERSION = /^\d+\.\d+\.\d+$/;
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** The keys a declaration may carry. Anything else is most likely a misspelling. */
const TYPE_KEYS = ["type", "values", "stages", "renamedStages", "to", "from", "fields", "key", "of", "id", "min", "max", "valueHelp", "default"];
const FIELD_KEYS = new Set([...TYPE_KEYS, "name", "label", "help", "required", "group", "editorOnly"]);
const CLAIM_KEYS = new Set([...TYPE_KEYS, "setting", "label", "help", "required"]);
const BARE_KEYS = new Set(TYPE_KEYS);
const MANIFEST_KEYS = new Set(["schema", "id", "name", "version", "docs", "settings", "targets"]);

const err = (code: string, path: string, message: string): Problem => ({ severity: "error", code, path, message });

/** Read a manifest file's text (JSON, or JSON5). Throws on text that will not parse. */
export function parseManifest(text: string): Manifest {
  return parseSource(text) as Manifest;
}

/** Every problem with a manifest, by path. An empty list means it is sound. */
export function manifestProblems(manifest: unknown): Problem[] {
  const out: Problem[] = [];
  if (!isObject(manifest)) return [err("not-an-object", "", "a manifest is a JSON object")];
  const m = manifest;
  unknownKeys(m, MANIFEST_KEYS, "", out);
  if (m["schema"] !== MANIFEST_SCHEMA) {
    out.push(err("schema", "schema", `the schema tag is ${JSON.stringify(m["schema"])}, not "${MANIFEST_SCHEMA}"`));
  }
  if (typeof m["id"] !== "string" || !ID.test(m["id"])) {
    out.push(err("id", "id", "the id is lower case letters, digits and hyphens, starting with a letter"));
  }
  if (typeof m["name"] !== "string" || m["name"].trim() === "") out.push(err("name", "name", "the manifest has no name"));
  if (typeof m["version"] !== "string" || !VERSION.test(m["version"])) {
    out.push(err("version", "version", "the version is major.minor.patch, such as 1.0.0"));
  }
  if (m["docs"] !== undefined && typeof m["docs"] !== "string") out.push(err("docs", "docs", "docs is a link, as text"));

  const settings = settingsProblems(m["settings"], out);

  const targets = m["targets"];
  if (!isObject(targets) || Object.keys(targets).length === 0) {
    out.push(err("no-targets", "targets", "the manifest targets no host"));
    return out;
  }
  for (const [host, kinds] of Object.entries(targets)) {
    const hostPath = atKey("targets", host);
    const spec = own(HOSTS, host) ? HOSTS[host as HostName] : undefined;
    if (spec === undefined) {
      out.push(err("unknown-host", hostPath, `"${host}" is not a host; a manifest targets "patter" or "storylets"`));
      continue;
    }
    if (!isObject(kinds)) { out.push(err("not-an-object", hostPath, "a host's targets are an object, by node kind")); continue; }
    for (const [kind, target] of Object.entries(kinds)) {
      const kindPath = atKey(hostPath, kind);
      if (!spec.kinds.includes(kind)) {
        out.push(err("unknown-kind", kindPath, `"${kind}" is not a node kind of ${host}; it has ${spec.kinds.join(", ")}`));
        continue;
      }
      targetProblems(host as HostName, kind, target, kindPath, settings, out);
    }
    pickListProblems(kinds, hostPath, out);
  }
  return out;
}

/** A pick's `from`: a list of sources, each exactly one of `words`, `to` and `list`. */
function pickSourcesSound(host: HostName, from: unknown, path: string, out: Problem[]): boolean {
  if (!Array.isArray(from) || from.length === 0) {
    out.push(err("pick-from", path, "a pick lists its sources in \"from\": { \"words\": [...] }, { \"to\": a node kind }, or { \"list\": a project list }"));
    return false;
  }
  let sound = true;
  from.forEach((s: unknown, i) => {
    const at = atIndex(path, i);
    const keys = isObject(s) ? Object.keys(s).filter((k) => k === "words" || k === "to" || k === "list") : [];
    if (!isObject(s) || keys.length !== 1) {
      out.push(err("pick-source", at, "a source is one of { \"words\": [...] }, { \"to\": a node kind }, { \"list\": a project list }"));
      sound = false;
      return;
    }
    unknownKeys(s, new Set(keys), at, out);
    if (keys[0] === "words") {
      const words = s["words"];
      const seen = new Set<string>();
      if (!Array.isArray(words) || words.length === 0) { out.push(err("pick-words", atKey(at, "words"), "fixed words are a list of at least one")); sound = false; return; }
      words.forEach((w, j) => {
        if (typeof w !== "string" || w.trim() === "") { out.push(err("value-empty", atIndex(atKey(at, "words"), j), "a word has a name")); sound = false; }
        else if (seen.has(w)) { out.push(err("value-duplicate", atIndex(atKey(at, "words"), j), `"${w}" is listed twice`)); sound = false; }
        else seen.add(w);
      });
    } else if (keys[0] === "to") {
      if (typeof s["to"] !== "string" || !HOSTS[host].references.includes(s["to"])) {
        out.push(err("reference-to", atKey(at, "to"), `a source's nodes are of a kind, one of ${HOSTS[host].references.join(", ")}`));
        sound = false;
      }
    } else if (typeof s["list"] !== "string" || !NAME.test(s["list"])) {
      out.push(err("pick-list", atKey(at, "list"), "a list source names a field of the extension's project node"));
      sound = false;
    }
  });
  return sound;
}

/** Each pick's `list` sources against the extension's project target: a list of text the project node holds. */
function pickListProblems(kinds: Record<string, unknown>, hostPath: string, out: Problem[]): void {
  const project = isObject(kinds["project"]) && Array.isArray(kinds["project"]["fields"]) ? kinds["project"]["fields"] as unknown[] : [];
  const lists = new Set(project.filter((f): f is FieldDecl => isObject(f) && isTextList(f as unknown as TypeDecl)).map((f) => f.name));
  const walk = (decl: unknown, path: string): void => {
    if (!isObject(decl)) return;
    const d = decl as unknown as TypeDecl;
    if (d.type === "pick" && Array.isArray(d.from)) {
      d.from.forEach((s, i) => {
        if (isObject(s) && typeof (s as { list?: unknown }).list === "string" && !lists.has((s as { list: string }).list)) {
          const name = (s as { list: string }).list;
          out.push(err("pick-list", atKey(atIndex(atKey(path, "from"), i), "list"),
            `"${name}" is not a list of text on the extension's project node; declare it there, as { "name": "${name}", "type": "list", "of": { "type": "text" } }`));
        }
      });
    }
    if (Array.isArray(d.fields)) d.fields.forEach((f, i) => walk(f, atIndex(atKey(path, "fields"), i)));
    if (d.of !== undefined) walk(d.of, atKey(path, "of"));
  };
  for (const [kind, target] of Object.entries(kinds)) {
    if (!isObject(target) || !Array.isArray(target["fields"])) continue;
    (target["fields"] as unknown[]).forEach((f, i) => walk(f, atIndex(atKey(atKey(hostPath, kind), "fields"), i)));
  }
}

function unknownKeys(obj: Record<string, unknown>, known: ReadonlySet<string>, path: string, out: Problem[]): void {
  for (const k of Object.keys(obj)) {
    if (!known.has(k)) {
      out.push({ severity: "warning", code: "unknown-key", path: atKey(path, k), message: `"${k}" means nothing here; it is ignored` });
    }
  }
}

function settingsProblems(settings: unknown, out: Problem[]): Set<string> {
  const names = new Set<string>();
  if (settings === undefined) return names;
  if (!Array.isArray(settings)) { out.push(err("not-a-list", "settings", "settings are a list")); return names; }
  settings.forEach((s: unknown, i) => {
    const at = atIndex("settings", i);
    if (!isObject(s)) { out.push(err("not-an-object", at, "a setting is an object")); return; }
    const name = s["name"];
    if (typeof name !== "string" || !NAME.test(name)) {
      out.push(err("setting-name", atKey(at, "name"), "a setting's name is an identifier"));
    } else if (names.has(name)) {
      out.push(err("setting-duplicate", atKey(at, "name"), `setting "${name}" is declared twice`));
    } else {
      names.add(name);
    }
    const dflt = (s as Partial<SettingDecl>).default;
    if (typeof dflt !== "string" || !NAME.test(dflt)) {
      out.push(err("setting-default", atKey(at, "default"), "a setting names a host field by default, so its default is a field name"));
    }
  });
  return names;
}

function targetProblems(host: HostName, kind: string, target: unknown, path: string, settings: ReadonlySet<string>, out: Problem[]): void {
  if (!isObject(target)) { out.push(err("not-an-object", path, "a target is an object")); return; }
  unknownKeys(target, new Set(["fields", "claims"]), path, out);
  const t = target as TargetDecl;
  if (t.fields !== undefined) fieldListProblems(host, t.fields, atKey(path, "fields"), true, out);
  if (t.claims === undefined) return;
  if (!Array.isArray(t.claims)) { out.push(err("not-a-list", atKey(path, "claims"), "claims are a list")); return; }
  const claimable = HOSTS[host].claimable.includes(kind);
  const claimed = new Set<string>();
  t.claims.forEach((c: unknown, i) => {
    const at = atIndex(atKey(path, "claims"), i);
    if (!claimable) {
      out.push(err("claim-kind", at, `a ${kind} has no host fields to claim; ${host} has them on ${HOSTS[host].claimable.join(", ")}`));
      return;
    }
    if (!isObject(c)) { out.push(err("not-an-object", at, "a claim is an object")); return; }
    const claim = c as unknown as ClaimDecl;
    unknownKeys(c, CLAIM_KEYS, at, out);
    if (!(SCALAR_TYPES as readonly string[]).includes(claim.type)) {
      out.push(err("claim-type", atKey(at, "type"), "a claim presents a host field, which is a scalar"));
    } else {
      typeProblems(host, claim, at, false, out, true);
    }
    if (typeof claim.setting !== "string" || !settings.has(claim.setting)) {
      out.push(err("claim-setting", atKey(at, "setting"), `a claim names its field through a setting, and "${String(claim.setting)}" is not one of the manifest's settings`));
    } else if (claimed.has(claim.setting)) {
      out.push(err("claim-duplicate", atKey(at, "setting"), `setting "${claim.setting}" is claimed twice for one kind`));
    } else {
      claimed.add(claim.setting);
    }
  });
}

function fieldListProblems(host: HostName, fields: unknown, path: string, topLevel: boolean, out: Problem[]): void {
  if (!Array.isArray(fields)) { out.push(err("not-a-list", path, "fields are a list")); return; }
  const names = new Set<string>();
  fields.forEach((f: unknown, i) => {
    const at = atIndex(path, i);
    if (!isObject(f)) { out.push(err("not-an-object", at, "a field is an object")); return; }
    const field = f as unknown as FieldDecl;
    unknownKeys(f, FIELD_KEYS, at, out);
    if (typeof field.name !== "string" || !NAME.test(field.name)) {
      out.push(err("field-name", atKey(at, "name"), "a field's name is an identifier: letters, digits and underscores, not starting with a digit"));
    } else if (names.has(field.name)) {
      out.push(err("duplicate-field", atKey(at, "name"), `field "${field.name}" is declared twice`));
    } else {
      names.add(field.name);
    }
    typeProblems(host, field, at, true, out);
    if (field.editorOnly !== undefined && !topLevel) {
      out.push(err("editor-only-nested", atKey(at, "editorOnly"), "only a target's own fields can be editor-only, not a record's"));
    }
    for (const flag of ["required", "editorOnly"] as const) {
      if (field[flag] !== undefined && typeof field[flag] !== "boolean") {
        out.push(err("not-a-boolean", atKey(at, flag), `${flag} is true or false`));
      }
    }
  });
}

/**
 * A declaration's type and constraints. `named` is false for a map's or a list's bare `of`. `claim` is true for
 * a claim on a host field, which may leave out an enum's or flags' values and a quality's stages: the host's
 * declaration then gives them (`effectiveClaim`), and its value help may describe values the host does not
 * declare, which are simply unused.
 */
function typeProblems(host: HostName, decl: TypeDecl, path: string, named: boolean, out: Problem[], claim = false): void {
  const typeAt = atKey(path, "type");
  if (decl.type === "string") {
    out.push(err("string-type", typeAt, "the text type is spelled \"text\""));
    return;
  }
  if (typeof decl.type !== "string" || !(VALUE_TYPES as readonly string[]).includes(decl.type)) {
    out.push(err("unknown-type", typeAt, `${JSON.stringify(decl.type)} is not a type; the types are ${VALUE_TYPES.join(", ")}`));
    return;
  }
  const at = (k: string): string => atKey(path, k);
  let sound = true;
  switch (decl.type) {
    case "enum":
    case "flags": {
      const values = decl.values;
      if (claim && values === undefined) break;
      if (!Array.isArray(values) || values.length === 0) {
        out.push(err("values-empty", at("values"), `an ${decl.type === "enum" ? "enum" : "flags field"} lists its values`));
        sound = false;
        break;
      }
      const seen = new Set<string>();
      values.forEach((v, i) => {
        if (typeof v !== "string" || v.trim() === "") { out.push(err("value-empty", atIndex(at("values"), i), "a value has a name")); sound = false; }
        else if (seen.has(v)) { out.push(err("value-duplicate", atIndex(at("values"), i), `"${v}" is listed twice`)); sound = false; }
        else seen.add(v);
      });
      break;
    }
    case "quality": {
      if (claim && decl.stages === undefined) break;
      // The kernel's one rule; the default is checked below, with every type's.
      for (const p of qualityDeclarationProblems(decl.stages)) {
        out.push(err(`quality-${p.kind === "default-not-a-stage" ? "default" : p.kind}`, at("stages"),
          p.kind === "too-few-stages" ? "a quality's ladder has at least two stages"
            : p.kind === "empty-stage" ? `stage ${p.index + 1} has no name`
              : p.kind === "duplicate-stage" ? `stage "${p.stage}" is listed twice` : "the default is not a stage"));
        sound = false;
      }
      break;
    }
    case "reference":
      if (typeof decl.to !== "string" || !HOSTS[host].references.includes(decl.to)) {
        out.push(err("reference-to", at("to"), `a reference names the kind it points at, one of ${HOSTS[host].references.join(", ")}`));
        sound = false;
      }
      break;
    case "pick":
      if (!pickSourcesSound(host, decl.from, at("from"), out)) sound = false;
      break;
    case "record":
      if (!Array.isArray(decl.fields) || decl.fields.length === 0) {
        out.push(err("record-empty", at("fields"), "a record declares its fields"));
        sound = false;
      } else {
        const before = out.length;
        fieldListProblems(host, decl.fields, at("fields"), false, out);
        if (out.slice(before).some((p) => p.severity === "error")) sound = false;
      }
      break;
    case "map": {
      const key = decl.key;
      const keyOk = isObject(key) && (key["type"] === "text"
        || (key["type"] === "reference" && typeof key["to"] === "string" && HOSTS[host].references.includes(key["to"])));
      if (!keyOk) {
        out.push(err("map-key", at("key"), `a map is keyed by { type: "text" } or a reference, { type: "reference", to: "${HOSTS[host].references[0]}" }`));
        sound = false;
      }
      if (!ofProblems(host, decl, at, out)) sound = false;
      break;
    }
    case "list": {
      if (decl.id !== undefined) {
        const of = decl.of;
        const idField = isObject(of) && of["type"] === "record" && Array.isArray(of["fields"])
          ? (of["fields"] as unknown[]).find((f) => isObject(f) && f["name"] === decl.id) as FieldDecl | undefined
          : undefined;
        if (typeof decl.id !== "string" || idField === undefined || idField.type !== "text") {
          out.push(err("list-id", at("id"), "a list with ids holds records, and its id names a text field of them"));
          sound = false;
        }
      }
      if (!ofProblems(host, decl, at, out)) sound = false;
      break;
    }
  }

  // The constraints that belong to some types only.
  if (decl.min !== undefined || decl.max !== undefined) {
    const which = decl.max !== undefined ? "max" : "min";
    if (decl.type !== "number") {
      out.push(err("range", at(which), "a range applies to a number"));
    } else if (typeof decl.min === "number" && typeof decl.max === "number" && decl.min > decl.max) {
      out.push(err("range", at("max"), `the range runs from ${decl.min} down to ${decl.max}`));
      sound = false;
    }
  }
  if (decl.renamedStages !== undefined) renamedStagesProblems(decl, at("renamedStages"), out);
  if (decl.valueHelp !== undefined && claim) {
    if (!isObject(decl.valueHelp) || !(["enum", "flags", "quality"] as const).includes(decl.type as "enum")) {
      out.push(err("value-help", at("valueHelp"), "value help describes the values of an enum or flags field, or a quality's stages"));
    }
  } else if (decl.valueHelp !== undefined) {
    const vocabulary = decl.type === "quality" ? decl.stages : decl.type === "enum" || decl.type === "flags" ? decl.values : undefined;
    if (vocabulary === undefined || !isObject(decl.valueHelp)) {
      out.push(err("value-help", at("valueHelp"), "value help describes the values of an enum or flags field, or a quality's stages"));
    } else {
      for (const k of Object.keys(decl.valueHelp)) {
        if (!vocabulary.includes(k)) out.push(err("value-help", atKey(at("valueHelp"), k), `"${k}" is not one of its values`));
      }
    }
  }
  if (named && decl.default !== undefined && sound) {
    const misfit = valueProblems(decl, decl.default).filter((p) => p.severity === "error");
    if (misfit.length > 0) out.push(err("default-misfit", at("default"), `the default does not fit: ${misfit[0]!.message}`));
  }
}

function ofProblems(host: HostName, decl: TypeDecl, at: (k: string) => string, out: Problem[]): boolean {
  if (!isObject(decl.of)) {
    out.push(err("missing-of", at("of"), `a ${decl.type} says what it holds, in "of"`));
    return false;
  }
  const before = out.length;
  unknownKeys(decl.of as Record<string, unknown>, BARE_KEYS, at("of"), out);
  typeProblems(host, decl.of, at("of"), false, out);
  return !out.slice(before).some((p) => p.severity === "error");
}

function renamedStagesProblems(decl: TypeDecl, path: string, out: Problem[]): void {
  if (decl.type !== "quality" || !isObject(decl.renamedStages)) {
    out.push(err("renamed-stages", path, "renamed stages belong to a quality, as { \"old\": \"new\" }"));
    return;
  }
  const stages = decl.stages ?? [];
  for (const [from, to] of Object.entries(decl.renamedStages)) {
    if (stages.includes(from)) {
      out.push(err("renamed-stages", atKey(path, from), `"${from}" is still a stage, so it cannot also be an old name`));
    } else if (typeof to !== "string" || !stages.includes(to)) {
      out.push(err("renamed-stages", atKey(path, from), `"${from}" is renamed to ${JSON.stringify(to)}, which is not a stage`));
    }
  }
}

// --- settings and claims across a project --------------------------------------

/** The host field each of a manifest's settings names, the project's choice
 *  first, else the setting's default. */
export function settingValues(manifest: Manifest, chosen?: Readonly<Record<string, unknown>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of manifest.settings ?? []) {
    const v = chosen !== undefined && own(chosen, s.name) ? chosen[s.name] : undefined;
    out[s.name] = typeof v === "string" && v !== "" ? v : s.default;
  }
  return out;
}

/** A claim as a project resolves it: the host field it presents, by name. */
export interface ResolvedClaim {
  readonly extension: string;
  readonly host: HostName;
  readonly kind: string;
  /** The host field's name, through the setting. */
  readonly field: string;
  readonly claim: ClaimDecl;
}

/** Every claim of a manifest for one host, resolved through the project's settings. */
export function resolvedClaims(manifest: Manifest, host: HostName, chosen?: Readonly<Record<string, unknown>>): ResolvedClaim[] {
  const settings = settingValues(manifest, chosen);
  const out: ResolvedClaim[] = [];
  for (const [kind, target] of Object.entries(manifest.targets[host] ?? {})) {
    for (const claim of target.claims ?? []) {
      const field = settings[claim.setting];
      if (field !== undefined) out.push({ extension: manifest.id, host, kind, field, claim });
    }
  }
  return out;
}

/** Two extensions claiming one host field: an error naming both, once per pair. */
export function claimClashes(claims: readonly ResolvedClaim[]): Problem[] {
  const out: Problem[] = [];
  const first = new Map<string, ResolvedClaim>();
  for (const c of claims) {
    const key = `${c.host}\u0000${c.kind}\u0000${c.field}`;
    const prior = first.get(key);
    if (prior === undefined) { first.set(key, c); continue; }
    if (prior.extension === c.extension) continue;
    out.push(err("claim-clash", `${c.kind}.${c.field}`,
      `extensions "${prior.extension}" and "${c.extension}" both claim the ${c.kind} field "${c.field}"`));
  }
  return out;
}

/** One manifest's declarations for one host and node kind, or undefined. */
export function targetOf(manifest: Manifest | undefined, host: HostName, kind: string): TargetDecl | undefined {
  const kinds = manifest?.targets[host];
  return kinds !== undefined && own(kinds, kind) ? kinds[kind] : undefined;
}

/**
 * A claim as a host draws and checks its field: the claim's label, help, value help and constraints, over the
 * host's own declaration for what the claim leaves out (an enum's or flags' values, a quality's stages, the
 * default). The host's vocabulary stands when the claim names none, as the host's ladder always does.
 */
export function effectiveClaim<C extends ClaimDecl>(
  claim: C, hostDecl: { readonly type?: string; readonly values?: readonly string[]; readonly stages?: readonly string[]; readonly default?: unknown },
): C {
  return {
    ...claim,
    ...(claim.values === undefined && hostDecl.values !== undefined ? { values: hostDecl.values } : {}),
    ...(claim.stages === undefined && hostDecl.stages !== undefined ? { stages: hostDecl.stages } : {}),
    ...(claim.default === undefined && hostDecl.default !== undefined ? { default: hostDecl.default } : {}),
  };
}
