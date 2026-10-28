// ---------------------------------------------------------------------------
// The type-driven three-way merge, and the unresolved mark.
//
// Lifted from the Storylets format's strategy table (storylets
// packages/ops/src/merge.ts), which merged every shard of that format as a tree
// of five behaviours, and generalised two ways: a strategy can be built from a
// manifest's types, and a keyed list can keep its authored order rather than
// sorting by key (patterkit design/family-parity-2026-10.md item 4: a list the
// editor lets you reorder must not be re-sorted by a merge).
//
// Pure: data in, data out.
// ---------------------------------------------------------------------------

import { isObject } from "./path.js";
import { targetOf } from "./manifest.js";
import type { ConflictKind, FieldDecl, HostName, Manifest, Problem, TargetDecl, TypeDecl, UnresolvedEntry } from "./types.js";

/**
 * A merge strategy, as data:
 *   atomic          one value, classic three-way (objects compare by content)
 *   map(of)         an open string-keyed map, each value merged by `of`
 *   set             a list of strings as a set: additions union, deletions respected
 *   keyed(key, of)  a list of objects keyed by the string field `key`; output
 *                   sorted by key, or in the authored order with `order: "preserve"`
 *   object(fields)  named keys by their own strategy, every other key by `other`
 *                   (atomic when absent)
 *   comments        a list of comment threads, merged message by message
 *                   (`mergeComments`)
 */
export type Strategy =
  | { readonly kind: "atomic" }
  | { readonly kind: "map"; readonly of: Strategy }
  | { readonly kind: "set" }
  | { readonly kind: "keyed"; readonly key: string; readonly of: Strategy; readonly order?: "sorted" | "preserve"; readonly renameWarning?: string }
  | { readonly kind: "object"; readonly fields: Readonly<Record<string, Strategy>>; readonly other?: Strategy }
  | { readonly kind: "comments" };

export const ATOMIC: Strategy = { kind: "atomic" };
export const SET: Strategy = { kind: "set" };
export const COMMENTS: Strategy = { kind: "comments" };
export const mapOf = (of: Strategy): Strategy => ({ kind: "map", of });
export const keyedBy = (key: string, of: Strategy, opts?: { order?: "sorted" | "preserve"; renameWarning?: string }): Strategy =>
  ({ kind: "keyed", key, of, ...(opts?.order !== undefined ? { order: opts.order } : {}),
    ...(opts?.renameWarning !== undefined ? { renameWarning: opts.renameWarning } : {}) });
export const objectOf = (fields: Readonly<Record<string, Strategy>>, other?: Strategy): Strategy =>
  ({ kind: "object", fields, ...(other !== undefined ? { other } : {}) });

/** One clash; the merged value holds OURS for it. */
export interface Conflict {
  /** The entity key involved (a keyed item's key, a map's key), or "" at the top. */
  readonly id: string;
  /** Where, from the root: `entries.card.c_1.perf.v_ann.look`, `cards[c_1].priority`. */
  readonly path: string;
  readonly base: unknown;
  readonly ours: unknown;
  readonly theirs: unknown;
  readonly kind: ConflictKind;
}

/** A note on a merge that went through but that a person should check. */
export interface MergeWarning {
  readonly id: string;
  readonly path: string;
  readonly message: string;
}

export interface TreeMergeResult {
  readonly merged: unknown;
  readonly conflicts: Conflict[];
  readonly warnings: MergeWarning[];
}

export interface TreeMergeOptions {
  /** Whether two values say the same thing. Content equality with keys in any
   *  order by default; a format whose canonical form is looser passes its own. */
  readonly equal?: (a: unknown, b: unknown) => boolean;
}

/** JSON with every object's keys sorted: two values with this text say the same thing. */
export function stableStringify(value: unknown): string {
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? "null" : stableStringify(v))).join(",")}]`;
  if (isObject(value)) {
    const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

const defaultEqual = (a: unknown, b: unknown): boolean => stableStringify(a) === stableStringify(b);
const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

interface Ctx {
  readonly eq: (a: unknown, b: unknown) => boolean;
  readonly conflicts: Conflict[];
  readonly warnings: MergeWarning[];
}

/** Three-way merge `base`, `ours` and `theirs` by `strategy`. A clash keeps ours. */
export function mergeTree(strategy: Strategy, base: unknown, ours: unknown, theirs: unknown, opts?: TreeMergeOptions): TreeMergeResult {
  const ctx: Ctx = { eq: opts?.equal ?? defaultEqual, conflicts: [], warnings: [] };
  const merged = mergeValue(strategy, base, ours, theirs, "", "", ctx);
  return { merged, conflicts: ctx.conflicts, warnings: ctx.warnings };
}

function deletedKind(base: unknown, ours: unknown, theirs: unknown): ConflictKind {
  if (base !== undefined && (ours === undefined || theirs === undefined)) return "delete-vs-edit";
  return base === undefined ? "added-both" : "both-changed";
}

function merge3(b: unknown, o: unknown, t: unknown, id: string, path: string, ctx: Ctx): unknown {
  if (ctx.eq(o, t)) return o;
  if (ctx.eq(b, o)) return t;
  if (ctx.eq(b, t)) return o;
  ctx.conflicts.push({ id, path, base: b, ours: o, theirs: t, kind: deletedKind(b, o, t) });
  return o;
}

/** Does a value fit a composite strategy's shape? One that does not (a scalar where a list was) merges whole. */
function hasShape(spec: Strategy, v: unknown): boolean {
  switch (spec.kind) {
    case "atomic": return true;
    case "set":
    case "keyed":
    case "comments": return Array.isArray(v);
    case "map":
    case "object": return isObject(v);
  }
}

function mergeValue(spec: Strategy, b: unknown, o: unknown, t: unknown, id: string, path: string, ctx: Ctx): unknown {
  // A composite strategy applies only when neither side deleted the whole
  // value; a delete against an edit is decided here, as one value.
  if (spec.kind === "atomic" || o === undefined || t === undefined || !hasShape(spec, o) || !hasShape(spec, t)) {
    return merge3(b, o, t, id, path, ctx);
  }
  switch (spec.kind) {
    case "set": {
      const strings = (v: unknown): Set<string> => new Set(asArr(v).filter((x): x is string => typeof x === "string"));
      const B = strings(b), O = strings(o), T = strings(t);
      const out = new Set<string>();
      for (const x of [...O, ...T]) if ((O.has(x) && T.has(x)) || !B.has(x)) out.add(x);
      return [...out].sort();
    }
    case "map": {
      const B = isObject(b) ? b : {}, O = o as Record<string, unknown>, T = t as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const k of Object.keys({ ...B, ...O, ...T }).sort()) {
        const v = mergeValue(spec.of, B[k], O[k], T[k], id || k, `${path}.${k}`, ctx);
        if (v !== undefined) out[k] = v;
      }
      return out;
    }
    case "object": {
      const B = isObject(b) ? b : {}, O = o as Record<string, unknown>, T = t as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const k of Object.keys({ ...B, ...O, ...T }).sort()) {
        const field = Object.prototype.hasOwnProperty.call(spec.fields, k) ? spec.fields[k]! : spec.other ?? ATOMIC;
        const v = mergeValue(field, B[k], O[k], T[k], id, path ? `${path}.${k}` : k, ctx);
        if (v !== undefined) out[k] = v;
      }
      return out;
    }
    case "keyed":
      return mergeKeyed(spec, asArr(b), o as unknown[], t as unknown[], path, ctx);
    case "comments":
      return mergeThreads(asArr(b), o as unknown[], t as unknown[], path, ctx);
  }
}

function mergeKeyed(spec: Extract<Strategy, { kind: "keyed" }>, B: unknown[], O: unknown[], T: unknown[], path: string, ctx: Ctx): unknown[] {
  const keyOf = (v: unknown): string | undefined => (isObject(v) && typeof v[spec.key] === "string" ? (v[spec.key] as string) : undefined);
  const keysOf = (arr: unknown[]): string[] => arr.map(keyOf).filter((k): k is string => k !== undefined);
  const toMap = (arr: unknown[]): Map<string, unknown> => {
    const m = new Map<string, unknown>();
    for (const v of arr) {
      const k = keyOf(v);
      if (k !== undefined) m.set(k, v);
    }
    return m;
  };
  const Bm = toMap(B), Om = toMap(O), Tm = toMap(T);
  const out = new Map<string, unknown>();
  const here = (k: string): string => `${path}[${k}]`;

  for (const k of new Set([...Bm.keys(), ...Om.keys(), ...Tm.keys()])) {
    const b = Bm.get(k), o = Om.get(k), t = Tm.get(k);
    const inB = Bm.has(k), inO = Om.has(k), inT = Tm.has(k);
    if (inO && inT) {
      if (!inB && !ctx.eq(o, t)) {
        ctx.conflicts.push({ id: k, path: here(k), base: undefined, ours: o, theirs: t, kind: "added-both" });
        out.set(k, o);
      } else {
        out.set(k, mergeValue(spec.of, b, o, t, k, here(k), ctx));
      }
    } else if (inO && !inT) {
      if (inB && !ctx.eq(o, b)) {
        ctx.conflicts.push({ id: k, path: here(k), base: b, ours: o, theirs: undefined, kind: "delete-vs-edit" });
        out.set(k, o);      // theirs deleted, ours edited: ours keeps it
      } else if (!inB) {
        out.set(k, o);      // ours added
      }                     // else ours unchanged and theirs deleted: gone
    } else if (!inO && inT) {
      if (inB && !ctx.eq(t, b)) {
        ctx.conflicts.push({ id: k, path: here(k), base: b, ours: undefined, theirs: t, kind: "delete-vs-edit" });
      } else if (!inB) {
        out.set(k, t);      // theirs added
      }
    }                       // else in the base only: both deleted
  }

  if (spec.renameWarning !== undefined) {
    for (const [k, v] of out) {
      const b = Bm.get(k);
      if (isObject(b) && isObject(v) && typeof b["gameId"] === "string" && typeof v["gameId"] === "string" && b["gameId"] !== v["gameId"]) {
        ctx.warnings.push({ id: k, path: here(k), message: `${spec.renameWarning} ("${b["gameId"]}" -> "${v["gameId"]}")` });
      }
    }
  }

  if (spec.order !== "preserve") return [...out.keys()].sort().map((k) => out.get(k));
  return preservedOrder(keysOf(B), keysOf(O), keysOf(T), out, path, ctx).map((k) => out.get(k));
}

/**
 * The authored order of a keyed list after a merge. The side that reordered
 * the items both sides kept is the skeleton (ours when neither did, and ours,
 * with a clash, when both did differently); the other side's additions then
 * go in after the item they followed there, or at the front when they led.
 */
function preservedOrder(B: string[], O: string[], T: string[], survivors: ReadonlyMap<string, unknown>, path: string, ctx: Ctx): string[] {
  const inAll = new Set(B.filter((k) => O.includes(k) && T.includes(k) && survivors.has(k)));
  const common = (seq: string[]): string[] => seq.filter((k) => inAll.has(k));
  const same = (a: string[], b: string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);
  const oMoved = !same(common(O), common(B)), tMoved = !same(common(T), common(B));
  if (oMoved && tMoved && !same(common(O), common(T))) {
    ctx.conflicts.push({ id: "", path: `${path}:order`, base: common(B), ours: common(O), theirs: common(T), kind: "both-changed" });
  }
  const [skeleton, other] = tMoved && !oMoved ? [T, O] : [O, T];
  const result = skeleton.filter((k) => survivors.has(k));
  for (let i = 0; i < other.length; i++) {
    const k = other[i]!;
    if (!survivors.has(k) || result.includes(k)) continue;
    let at = 0;
    for (let j = i - 1; j >= 0; j--) {
      const p = result.indexOf(other[j]!);
      if (p >= 0) { at = p + 1; break; }
    }
    result.splice(at, 0, k);
  }
  // Survivors neither list holds in order (cannot happen for well-formed input) go last, sorted.
  for (const k of [...survivors.keys()].sort()) if (!result.includes(k)) result.push(k);
  return result;
}

// --- comment threads ---------------------------------------------------------------

/**
 * Three-way merge two lists of comment threads, the shape both families'
 * comments share: `{ id, messages: [{ author, ts, body, deleted? }], resolved?,
 * ...}`. Lifted from Patter's merge (patterkit design/family-parity-2026-10.md
 * item 5), where a thread merged whole made two replies to one thread clash.
 *
 * - Messages are keyed by author and timestamp, and are the union of both
 *   sides', oldest first. A withdrawn message (a tombstone: body emptied,
 *   `deleted` set) stays withdrawn whichever side withdrew it, and a message a
 *   side removed outright, or lost with its whole thread, counts as withdrawn
 *   by that side. One message edited two ways is a clash that keeps ours.
 * - A thread's other fields (its anchor, its marker, `resolved`) merge one by
 *   one, a field changed two ways being a clash; a thread one side removed
 *   takes the other side's.
 * - A thread with nothing readable left goes, as the editors drop it.
 *
 * Threads come back oldest first, by their first message, then by id.
 */
export function mergeComments(base: unknown, ours: unknown, theirs: unknown, opts?: TreeMergeOptions): TreeMergeResult {
  return mergeTree(COMMENTS, base, ours, theirs, opts);
}

type Thread = Record<string, unknown>;

function mergeThreads(B: unknown[], O: unknown[], T: unknown[], path: string, ctx: Ctx): unknown[] {
  const index = (arr: unknown[]): Map<string, Thread> => {
    const m = new Map<string, Thread>();
    for (const c of arr) if (isObject(c) && typeof c["id"] === "string") m.set(c["id"], c);
    return m;
  };
  const Bm = index(B), Om = index(O), Tm = index(T);
  const out: Thread[] = [];
  for (const id of new Set([...Bm.keys(), ...Om.keys(), ...Tm.keys()])) {
    const b = Bm.get(id), o = Om.get(id), t = Tm.get(id);
    const here = `${path}[${id}]`;
    if (o === undefined && t === undefined) continue;   // gone on both sides
    // An entry with no messages anywhere (a comment from before threads) has nothing inside to merge.
    if (![b, o, t].some((c) => Array.isArray(c?.["messages"]))) {
      const v = o !== undefined && t !== undefined ? merge3(b, o, t, id, here, ctx)
        : (b !== undefined && ctx.eq(o ?? t, b) ? undefined : o ?? t);
      if (isObject(v)) out.push(v);
      continue;
    }
    const messages = mergeMessages(b, o, t, id, here, ctx);
    if (messages.length === 0 || messages.every((m) => m["deleted"] === true)) continue;
    // The thread's own fields: one by one when both sides have it, else the side that does.
    const fields: Thread = {};
    if (o !== undefined && t !== undefined) {
      const B0 = b ?? {};
      const flag = (c: Thread, k: string): unknown => (k === "resolved" ? (c[k] === true ? true : undefined) : c[k]);
      for (const k of new Set([...Object.keys(o), ...Object.keys(t), ...Object.keys(B0)])) {
        if (k === "messages") continue;
        const v = merge3(flag(B0, k), flag(o, k), flag(t, k), id, `${here}.${k}`, ctx);
        if (v !== undefined) fields[k] = v;
      }
    } else {
      for (const [k, v] of Object.entries((o ?? t)!)) if (k !== "messages") fields[k] = v;
    }
    out.push({ ...fields, messages });
  }
  const first = (c: Thread): string => {
    const m = asArr(c["messages"])[0];
    return isObject(m) && typeof m["ts"] === "string" ? m["ts"] : "";
  };
  return out.sort((x, y) => first(x).localeCompare(first(y)) || String(x["id"]).localeCompare(String(y["id"])));
}

function mergeMessages(b: Thread | undefined, o: Thread | undefined, t: Thread | undefined, id: string, here: string, ctx: Ctx): Thread[] {
  const keyOf = (m: Thread): string => `${String(m["author"] ?? "")}|${String(m["ts"] ?? "")}`;
  const index = (c: Thread | undefined): Map<string, Thread> => {
    const m = new Map<string, Thread>();
    for (const x of asArr(c?.["messages"])) if (isObject(x)) m.set(keyOf(x), x);
    return m;
  };
  const Bm = index(b), Om = index(o), Tm = index(t);
  const out: Thread[] = [];
  for (const k of new Set([...Bm.keys(), ...Om.keys(), ...Tm.keys()])) {
    const mb = Bm.get(k), mo = Om.get(k), mt = Tm.get(k);
    // Withdrawn on either side, or missing from a side that had it at the base.
    if ([mb, mo, mt].some((m) => m?.["deleted"] === true) || (mb !== undefined && (mo === undefined || mt === undefined))) {
      out.push({ ...(mo ?? mt ?? mb)!, body: "", deleted: true });
    } else if (mo !== undefined && mt !== undefined) {
      out.push(merge3(mb, mo, mt, id, `${here}.messages[${k}]`, ctx) as Thread);
    } else {
      out.push((mo ?? mt)!);
    }
  }
  const ts = (m: Thread): string => String(m["ts"] ?? "");
  return out.sort((x, y) => ts(x).localeCompare(ts(y)) || String(x["author"] ?? "").localeCompare(String(y["author"] ?? "")));
}

// --- strategies from a manifest ---------------------------------------------------

/** How a value of this type merges (the README's table). */
export function strategyForType(decl: TypeDecl): Strategy {
  switch (decl.type) {
    case "flags": return SET;
    case "record": return strategyForFields(decl.fields ?? []);
    case "map": return mapOf(decl.of !== undefined ? strategyForType(decl.of) : ATOMIC);
    case "list":
      return decl.id !== undefined
        ? keyedBy(decl.id, decl.of !== undefined ? strategyForType(decl.of) : ATOMIC, { order: "preserve" })
        : ATOMIC;
    default: return ATOMIC;
  }
}

function strategyForFields(fields: readonly FieldDecl[]): Strategy {
  return objectOf(Object.fromEntries(fields.map((f) => [f.name, strategyForType(f)])));
}

/** How one node's entry merges: field by field, each by its type. */
export function strategyForTarget(target: TargetDecl): Strategy {
  return strategyForFields(target.fields ?? []);
}

/**
 * How an extension data shard merges for one host. With the manifest, each
 * kind's entries merge node by node and each entry field by field; a kind the
 * manifest does not target, and every kind without the manifest, merges node
 * by node with each entry as one value.
 */
export function extensionDataStrategy(manifest: Manifest | undefined, host: HostName): Strategy {
  const perNode = mapOf(ATOMIC);
  const kinds: Record<string, Strategy> = {};
  for (const kind of Object.keys(manifest?.targets[host] ?? {})) {
    const target = targetOf(manifest, host, kind);
    if (target !== undefined) kinds[kind] = mapOf(strategyForTarget(target));
  }
  return objectOf({ entries: objectOf(kinds, perNode) });
}

// --- the unresolved mark ---------------------------------------------------------

/** The reserved key a merged shard carries its clashes under. */
export const UNRESOLVED_KEY = "unresolved";

/** A shard's mark, when it carries one. */
export function unresolvedOf(shard: unknown): readonly UnresolvedEntry[] | undefined {
  if (!isObject(shard) || !Object.prototype.hasOwnProperty.call(shard, UNRESOLVED_KEY)) return undefined;
  const mark = shard[UNRESOLVED_KEY];
  return Array.isArray(mark) ? (mark as UnresolvedEntry[]) : [];
}

/** A shard without its mark, for merging and for comparing content. */
export function withoutMark<T>(shard: T): T {
  if (!isObject(shard) || !Object.prototype.hasOwnProperty.call(shard, UNRESOLVED_KEY)) return shard;
  const { [UNRESOLVED_KEY]: _mark, ...rest } = shard;
  return rest as T;
}

const entryOf = (c: Conflict): UnresolvedEntry => ({
  path: c.path, kind: c.kind,
  ...(c.base !== undefined ? { base: c.base } : {}),
  ...(c.ours !== undefined ? { ours: c.ours } : {}),
  ...(c.theirs !== undefined ? { theirs: c.theirs } : {}),
});

/**
 * Write a merge's clashes into the merged shard under `unresolved`, carrying
 * any mark either side already had (a mark is a set by path: one side
 * resolving it, by removing it, resolves it). A clash found now replaces a
 * carried one at the same path. With nothing to mark, the key is absent.
 */
export function markUnresolved<T extends Record<string, unknown>>(
  merged: T, conflicts: readonly Conflict[], sides?: { base?: unknown; ours?: unknown; theirs?: unknown },
): T {
  const byPath = (mark: readonly UnresolvedEntry[] | undefined): Map<string, UnresolvedEntry> =>
    new Map((mark ?? []).filter((e) => isObject(e) && typeof e.path === "string").map((e) => [e.path, e]));
  const B = byPath(unresolvedOf(sides?.base)), O = byPath(unresolvedOf(sides?.ours)), T = byPath(unresolvedOf(sides?.theirs));
  const out = new Map<string, UnresolvedEntry>();
  for (const [p, e] of [...O, ...T]) {
    const kept = (O.has(p) && T.has(p)) || !B.has(p);   // on both sides still, or newly marked on one
    if (kept && !out.has(p)) out.set(p, e);
  }
  for (const c of conflicts) out.set(c.path, entryOf(c));
  const result = withoutMark(merged) as Record<string, unknown>;
  if (out.size === 0) return result as T;
  return { ...result, [UNRESOLVED_KEY]: [...out.keys()].sort().map((p) => out.get(p)!) } as unknown as T;
}

/**
 * A shard with the named clashes resolved: their entries leave its `unresolved` mark, and the key goes when
 * nothing is left in it. Pure: the shard passed in is not changed, and one with no mark comes back as it is.
 * An entry with no path can't be named, so it stays. Read the clashes to resolve with `unresolvedOf`.
 */
export function clearUnresolved<T>(shard: T, paths: Iterable<string>): T {
  const mark = unresolvedOf(shard);
  if (mark === undefined) return shard;
  const named = new Set(paths);
  const left = mark.filter((e) => !(isObject(e) && typeof e.path === "string" && named.has(e.path)));
  const rest = withoutMark(shard) as Record<string, unknown>;
  return (left.length === 0 ? rest : { ...rest, [UNRESOLVED_KEY]: left }) as T;
}

/** Validation's refusal of a marked shard: one error per clash, or one for an empty mark. */
export function unresolvedProblems(shard: unknown): Problem[] {
  const mark = unresolvedOf(shard);
  if (mark === undefined) return [];
  const message = "unresolved merge: this shard holds our side of a clash; resolve it, then remove the entry from \"unresolved\"";
  if (mark.length === 0) return [{ severity: "error", code: "unresolved", path: UNRESOLVED_KEY, message }];
  return mark.map((e) => ({
    severity: "error" as const, code: "unresolved",
    path: isObject(e) && typeof e.path === "string" ? e.path : UNRESOLVED_KEY,
    message: `${message} (${isObject(e) && typeof e.kind === "string" ? e.kind : "clash"})`,
  }));
}

// --- extension data ----------------------------------------------------------------

export interface DataMergeResult {
  /** The merged shard: ours where it clashed, with the mark written in. */
  readonly merged: Record<string, unknown>;
  readonly conflicts: Conflict[];
  readonly warnings: MergeWarning[];
}

/**
 * Three-way merge of one extension data shard. `manifest` is the project's copy,
 * read from the working tree, or undefined when it is missing, unreadable or
 * itself in conflict, which merges each node's entry as one value: always safe.
 * The shard's other keys (a format's schema tag, the extension id) merge as values.
 */
export function mergeExtensionData(
  base: Record<string, unknown>, ours: Record<string, unknown>, theirs: Record<string, unknown>,
  opts: { manifest?: Manifest; host: HostName } & TreeMergeOptions,
): DataMergeResult {
  const strategy = extensionDataStrategy(opts.manifest, opts.host);
  const { merged, conflicts, warnings } = mergeTree(strategy, withoutMark(base), withoutMark(ours), withoutMark(theirs),
    opts.equal !== undefined ? { equal: opts.equal } : undefined);
  return {
    merged: markUnresolved(merged as Record<string, unknown>, conflicts, { base, ours, theirs }),
    conflicts, warnings,
  };
}

/** Entries naming a node the host no longer has: kept, and reported as warnings. */
export function orphanedEntries(data: unknown, exists: (kind: string, id: string) => boolean): Problem[] {
  const out: Problem[] = [];
  const entries = isObject(data) ? data["entries"] : undefined;
  if (!isObject(entries)) return out;
  for (const [kind, nodes] of Object.entries(entries)) {
    if (!isObject(nodes)) continue;
    for (const id of Object.keys(nodes)) {
      if (!exists(kind, id)) {
        out.push({ severity: "warning", code: "orphan", path: `entries.${kind}.${id}`,
          message: `an entry for ${kind} "${id}", which no longer exists; it is kept, and not compiled` });
      }
    }
  }
  return out;
}
