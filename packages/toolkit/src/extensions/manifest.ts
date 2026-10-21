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
import { HOSTS, MANIFEST_SCHEMA, VALUE_TYPES } from "./types.js";
import type { FieldDecl, HostName, Manifest, Problem, TargetDecl, TypeDecl, ViewDecl } from "./types.js";
import { isTextList, valueProblems } from "./values.js";

const ID = /^[a-z][a-z0-9-]*$/;
const VERSION = /^\d+\.\d+\.\d+$/;
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** The keys a declaration may carry. Anything else is most likely a misspelling. */
const TYPE_KEYS = ["type", "values", "stages", "renamedStages", "to", "from", "fields", "key", "of", "id", "min", "max", "valueHelp", "default"];
const FIELD_KEYS = new Set([...TYPE_KEYS, "name", "label", "help", "required", "group", "editorOnly", "editor"]);
const BARE_KEYS = new Set(TYPE_KEYS);
const MANIFEST_KEYS = new Set(["schema", "id", "name", "version", "docs", "targets", "views", "reads", "requires"]);
/** Keys the spec once had and has since removed: warned of by name, with what to do instead, and ignored. */
const REMOVED_MANIFEST_KEYS: Readonly<Record<string, string>> = {
  settings: "settings were removed with claims; declare the extension's own fields, or a project field for a project-wide value",
};
const REMOVED_TARGET_KEYS: Readonly<Record<string, string>> = {
  claims: "claims on host fields were removed; declare a field of the extension's own, which the runtimes hand the game",
};
const VIEW_KEYS = new Set(["id", "name", "entry", "element", "hosts"]);
/** A custom element name: lower case, starting with a letter, with a hyphen. */
const ELEMENT = /^[a-z][a-z0-9._]*-[a-z0-9._-]*$/;

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
  unknownKeys(m, MANIFEST_KEYS, "", out, REMOVED_MANIFEST_KEYS);
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

  viewsProblems(m["views"], m["targets"], out);
  readsProblems(m["reads"], m["id"], out);
  requiresProblems(m["requires"], m["id"], out);

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
      targetProblems(host as HostName, target, kindPath, out);
    }
    pickListProblems(kinds, hostPath, out);
    editorProblems(host as HostName, kinds, m["views"], Object.keys(targets), hostPath, out);
  }
  return out;
}

/** A pick's fixed words, across its `words` sources: what its value help may describe. */
function pickWords(from: unknown): string[] {
  if (!Array.isArray(from)) return [];
  return from.flatMap((s: unknown) => (isObject(s) && Array.isArray(s["words"]) ? s["words"].filter((w): w is string => typeof w === "string") : []));
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

/** A package path a view's entry may name: relative, forward slashes, no `.` or `..` segment, a `.js` file. */
export function isViewEntry(entry: unknown): entry is string {
  if (typeof entry !== "string" || !entry.endsWith(".js") || entry.includes("\\")) return false;
  const parts = entry.split("/");
  return parts.every((p) => p !== "" && p !== "." && p !== "..");
}

function viewsProblems(views: unknown, targets: unknown, out: Problem[]): void {
  if (views === undefined) return;
  if (!Array.isArray(views)) { out.push(err("not-a-list", "views", "views are a list")); return; }
  const ids = new Set<string>();
  const elements = new Set<string>();
  const targeted = isObject(targets) ? Object.keys(targets) : [];
  views.forEach((v: unknown, i) => {
    const at = atIndex("views", i);
    if (!isObject(v)) { out.push(err("not-an-object", at, "a view is an object")); return; }
    unknownKeys(v, VIEW_KEYS, at, out);
    const id = v["id"];
    if (typeof id !== "string" || !ID.test(id)) out.push(err("view-id", atKey(at, "id"), "a view's id is lower case letters, digits and hyphens, starting with a letter"));
    else if (ids.has(id)) out.push(err("view-duplicate", atKey(at, "id"), `two views are called "${id}"`));
    else ids.add(id);
    if (typeof v["name"] !== "string" || v["name"].trim() === "") out.push(err("view-name", atKey(at, "name"), "a view has a name, shown as its window's title"));
    if (!isViewEntry(v["entry"])) {
      out.push(err("view-entry", atKey(at, "entry"), "a view's entry is a .js file in the extension's package, as a relative path such as view/sheet.js"));
    }
    const element = v["element"];
    if (typeof element !== "string" || !ELEMENT.test(element)) {
      out.push(err("view-element", atKey(at, "element"), "a view's element is a custom element name: lower case, starting with a letter, with a hyphen, such as probe-view"));
    } else if (elements.has(element)) out.push(err("view-duplicate", atKey(at, "element"), `two views define <${element}>`));
    else elements.add(element);
    const hosts = v["hosts"];
    if (hosts === undefined) return;
    if (!Array.isArray(hosts) || hosts.length === 0) { out.push(err("view-hosts", atKey(at, "hosts"), "a view's hosts are a list of at least one host")); return; }
    hosts.forEach((h: unknown, j) => {
      const hp = atIndex(atKey(at, "hosts"), j);
      if (typeof h !== "string" || !own(HOSTS, h)) out.push(err("unknown-host", hp, `${JSON.stringify(h)} is not a host; a view opens in "patter" or "storylets"`));
      else if (!targeted.includes(h)) out.push({ severity: "warning", code: "view-host-untargeted", path: hp, message: `the view opens in ${h}, but the manifest targets nothing there` });
    });
  });
}

function readsProblems(reads: unknown, self: unknown, out: Problem[]): void {
  if (reads === undefined) return;
  if (!Array.isArray(reads)) { out.push(err("not-a-list", "reads", "reads is a list of extension ids")); return; }
  const seen = new Set<string>();
  reads.forEach((r: unknown, i) => {
    const at = atIndex("reads", i);
    if (typeof r !== "string" || !ID.test(r)) out.push(err("reads-id", at, "an extension read is named by its id: lower case letters, digits and hyphens"));
    else if (r === self) out.push({ severity: "warning", code: "reads-self", path: at, message: "an extension always reads its own data; this entry is ignored" });
    else if (seen.has(r)) out.push(err("reads-duplicate", at, `"${r}" is listed twice`));
    else seen.add(r);
  });
}

function requiresProblems(requires: unknown, self: unknown, out: Problem[]): void {
  if (requires === undefined) return;
  if (!Array.isArray(requires)) { out.push(err("not-a-list", "requires", "requires is a list of extension ids")); return; }
  const seen = new Set<string>();
  requires.forEach((r: unknown, i) => {
    const at = atIndex("requires", i);
    if (typeof r !== "string" || !ID.test(r)) out.push(err("requires-id", at, "a required extension is named by its id: lower case letters, digits and hyphens"));
    else if (r === self) out.push(err("requires-self", at, "an extension can't require itself"));
    else if (seen.has(r)) out.push(err("requires-duplicate", at, `"${r}" is listed twice`));
    else seen.add(r);
  });
}

/** The extensions a manifest requires that a project doesn't take, by id, in the manifest's order. An entry that
 *  fails its checks is left out. */
export function missingRequirements(manifest: Manifest, taken: Iterable<string>): string[] {
  const have = new Set(taken);
  const out: string[] = [];
  for (const r of Array.isArray(manifest.requires) ? manifest.requires : []) {
    if (typeof r === "string" && ID.test(r) && r !== manifest.id && !have.has(r) && !out.includes(r)) out.push(r);
  }
  return out;
}

/** Each of a host's target fields naming a view as its editor: a view the manifest declares, opening in that host,
 *  on a map of records (the one kind of field the editors open elsewhere). */
function editorProblems(host: HostName, kinds: Record<string, unknown>, views: unknown, targeted: readonly string[], hostPath: string, out: Problem[]): void {
  const declared = Array.isArray(views) ? views.filter((v): v is Record<string, unknown> => isObject(v) && typeof v["id"] === "string") : [];
  for (const [kind, target] of Object.entries(kinds)) {
    if (!isObject(target) || !Array.isArray(target["fields"])) continue;
    (target["fields"] as unknown[]).forEach((f, i) => {
      if (!isObject(f) || f["editor"] === undefined) return;
      const at = atKey(atIndex(atKey(atKey(hostPath, kind), "fields"), i), "editor");
      const editor = f["editor"];
      const view = typeof editor === "string" ? declared.find((v) => v["id"] === editor) : undefined;
      if (view === undefined) {
        out.push(err("editor-view", at, typeof editor === "string"
          ? `the manifest declares no view called "${editor}"; an editor names one of its views by id`
          : "an editor names one of the manifest's views by its id"));
        return;
      }
      const opensIn = Array.isArray(view["hosts"]) ? view["hosts"] : targeted;
      if (!opensIn.includes(host)) { out.push(err("editor-host", at, `the view "${editor}" doesn't open in ${host}`)); return; }
      const d = f as unknown as TypeDecl;
      if (!(d.type === "map" && isObject(d.of) && d.of.type === "record")) {
        out.push({ severity: "warning", code: "editor-ignored", path: at, message: "only a map of records opens in an editor; this field is edited in place, so the editor is ignored" });
      }
    });
  }
}

/** The views a host offers from a manifest: those naming the host, or every view when it names none and the
 *  manifest targets the host. A view that fails its checks is left out. */
export function viewsFor(manifest: Manifest, host: HostName): ViewDecl[] {
  const targeted = Object.keys(manifest.targets ?? {});
  return (Array.isArray(manifest.views) ? manifest.views : []).filter((v) =>
    isObject(v) && typeof v.id === "string" && ID.test(v.id) && typeof v.name === "string" && isViewEntry(v.entry)
    && typeof v.element === "string" && ELEMENT.test(v.element)
    && (v.hosts === undefined ? targeted.includes(host) : Array.isArray(v.hosts) && v.hosts.includes(host)));
}

function unknownKeys(obj: Record<string, unknown>, known: ReadonlySet<string>, path: string, out: Problem[],
  removed: Readonly<Record<string, string>> = {}): void {
  for (const k of Object.keys(obj)) {
    if (own(removed, k)) {
      out.push({ severity: "warning", code: "removed-key", path: atKey(path, k), message: `"${k}" is ignored: ${removed[k]}` });
    } else if (!known.has(k)) {
      out.push({ severity: "warning", code: "unknown-key", path: atKey(path, k), message: `"${k}" means nothing here; it is ignored` });
    }
  }
}

function targetProblems(host: HostName, target: unknown, path: string, out: Problem[]): void {
  if (!isObject(target)) { out.push(err("not-an-object", path, "a target is an object")); return; }
  unknownKeys(target, new Set(["fields"]), path, out, REMOVED_TARGET_KEYS);
  const t = target as TargetDecl;
  if (t.fields !== undefined) fieldListProblems(host, t.fields, atKey(path, "fields"), true, out);
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
    if (field.editor !== undefined && !topLevel) {
      out.push(err("editor-nested", atKey(at, "editor"), "only a target's own fields open in a view, not a record's"));
    }
    for (const flag of ["required", "editorOnly"] as const) {
      if (field[flag] !== undefined && typeof field[flag] !== "boolean") {
        out.push(err("not-a-boolean", atKey(at, flag), `${flag} is true or false`));
      }
    }
  });
}

/** A declaration's type and constraints. `named` is false for a map's or a list's bare `of`. */
function typeProblems(host: HostName, decl: TypeDecl, path: string, named: boolean, out: Problem[]): void {
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
  if (decl.valueHelp !== undefined) {
    const vocabulary = decl.type === "quality" ? decl.stages : decl.type === "enum" || decl.type === "flags" ? decl.values
      : decl.type === "pick" ? pickWords(decl.from) : undefined;
    if (vocabulary === undefined || !isObject(decl.valueHelp)) {
      out.push(err("value-help", at("valueHelp"), "value help describes the values of an enum or flags field, a quality's stages, or a pick's words"));
    } else {
      for (const k of Object.keys(decl.valueHelp)) {
        if (!vocabulary.includes(k)) {
          out.push(err("value-help", atKey(at("valueHelp"), k), decl.type === "pick"
            ? `"${k}" is not one of its words: value help describes a pick's fixed words, never the project's lists or nodes`
            : `"${k}" is not one of its values`));
        }
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

// --- a manifest's declarations ---------------------------------------------------

/** One manifest's declarations for one host and node kind, or undefined. */
export function targetOf(manifest: Manifest | undefined, host: HostName, kind: string): TargetDecl | undefined {
  const kinds = manifest?.targets[host];
  return kinds !== undefined && own(kinds, kind) ? kinds[kind] : undefined;
}
