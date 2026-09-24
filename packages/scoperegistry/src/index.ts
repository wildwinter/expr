// ---------------------------------------------------------------------------
// @wildwinter/scoperegistry - the scope registry / runtime state container that
// sits on top of @wildwinter/expr.
//
// expr is a stateless calculator: given an AST, an EvalContext (the state), and
// a Dialect, it computes. This package is the *state* layer: it owns the world
// state as a set of named scopes - each either an **owned** scope (a property
// bag this registry stores and saves) or a **foreign** scope (host- or
// other-engine-resolved at runtime, never stored here) - and produces the
// `EvalContext` (for evaluation) and `ExpressionSchema` (for validation) that
// expr consumes. Plus the `scopeRegistrySpec` interop format for importing a
// foreign owner's scope declarations.
//
// Design: design/scope-registry.md (in the patter repo). expr never depends on
// this; this depends one-way on expr.
// ---------------------------------------------------------------------------

import type {
  EvalContext, ExpressionSchema, PropertyType, ScalarValue, ScopeResolver,
} from "@wildwinter/expr";

export type { EvalContext, ExpressionSchema, PropertyType, ScalarValue, ScopeResolver } from "@wildwinter/expr";

// ---------------------------------------------------------------------------
// Declarations + the scopeRegistrySpec interop format
// ---------------------------------------------------------------------------

/**
 * A property declaration. `default` is used by an *owned* scope to seed its bag
 * (foreign scopes ignore it - the host owns the value). `writable: false` makes
 * a property read-only TO THE STORY; the HOST still writes it, by passing
 * `{ host: true }` (see `set`). Default is read/write. (`type`/`values` feed
 * validation.)
 *
 * The distinction is the whole point of the flag on a foreign scope, where the
 * value is the game's own: a flag carried in the story's bundle must not lock a
 * game out of its own state. Ruled 2026-09-05, after both products met it - the
 * Storylet Engine's venue clock and Patter's coverage driver were each blocked
 * from the one property they existed to move.
 */
export interface ScopeDeclaration {
  name: string;
  type: PropertyType;
  values?: string[];        // for enum / flags
  /** A quality's ordered ladder of stage names (quality.md). */
  stages?: string[];
  default?: ScalarValue;    // owned scopes: seed value
  writable?: boolean;       // default true
}

/** One scope in a `scopeRegistrySpec`: a token + (optional) declarations. */
export interface ScopeSpec {
  token: string;
  /** Scope-level read/write default for its declarations (default true). */
  writable?: boolean;
  /** Property declarations; omit for an opaque scope (any name, unchecked). */
  declarations?: ScopeDeclaration[];
}

/**
 * The interop format an owner (Storylet Studio, a host game) exports so another
 * engine can validate references into its scopes. Carried under the well-known
 * `scopeRegistrySpec` JSON key (inside a `.storyworld`, or a standalone file).
 */
export interface ScopeRegistrySpec {
  version: number;
  scopes: ScopeSpec[];
}

/** The spec versions this build understands. */
export const SUPPORTED_SPEC_VERSIONS = [1] as const;

/**
 * Extract + validate a `scopeRegistrySpec` from any JSON value (a parsed
 * `.storyworld` bundle, or a vanilla `{ scopeRegistrySpec: ... }` manifest).
 * Returns null when the key is absent (so callers can probe arbitrary files);
 * throws on a malformed or unsupported-version spec.
 */
export function readScopeRegistrySpec(source: unknown): ScopeRegistrySpec | null {
  if (!source || typeof source !== "object") return null;
  const raw = (source as Record<string, unknown>).scopeRegistrySpec;
  if (raw === undefined) return null;
  if (typeof raw !== "object" || raw === null) throw new Error("scopeRegistrySpec must be an object");
  const spec = raw as Record<string, unknown>;
  if (typeof spec.version !== "number") throw new Error("scopeRegistrySpec.version must be a number");
  if (!(SUPPORTED_SPEC_VERSIONS as readonly number[]).includes(spec.version)) {
    throw new Error(`unsupported scopeRegistrySpec version ${spec.version} (supported: ${SUPPORTED_SPEC_VERSIONS.join(", ")})`);
  }
  if (!Array.isArray(spec.scopes)) throw new Error("scopeRegistrySpec.scopes must be an array");
  for (const s of spec.scopes) {
    if (!s || typeof s !== "object" || typeof (s as ScopeSpec).token !== "string") {
      throw new Error("each scopeRegistrySpec scope needs a string token");
    }
  }
  return spec as unknown as ScopeRegistrySpec;
}

// ---------------------------------------------------------------------------
// PropertyBag - the state kernel's unit of state (added 0.2.0; design:
// storylets-new/design/engine-runtimes.md 3.1). A typed, declared property
// bag with defaults, the firing rule (engine writes notify subscribers;
// host writes are silent but always auditable), examiner rows, one
// sanctioned clone door, and bare-value save/load. Owned registry scopes
// are bags; products may also hold bag families of their own (per-box,
// per-scene) and mount the shared ones.
// ---------------------------------------------------------------------------

/** One property change. `silent` marks a host write (the firing rule: it
 *  reaches the audit hook but not subscribers); `reason` is the host's own
 *  note for its log. */
export interface BagChange {
  name: string;
  prev?: ScalarValue;
  next: ScalarValue;
  silent: boolean;
  reason?: string;
}

/** One examiner row: what a property examiner/editor needs to render and
 *  edit a declared property. */
export interface PropertyRow {
  name: string;
  /** The address this property answers to - what getProperty/setProperty take.
   *  A bag composes it from its own `pathPrefix` and the name, so a row is
   *  self-describing: an examiner can render and write a row without being told
   *  separately where it came from.
   *
   *  The PREFIX CARRIES ITS OWN SEPARATOR rather than the bag assuming a dot,
   *  because a prefix is not always a bare scope token: the Storylet Engine
   *  addresses a deck's properties as `deck.<id>.name`, so the prefix is already
   *  a dotted path. Patterplay's `@patter.gold` and `@scene.mood` are the plain
   *  case. (`@gold` also resolves - splitRef defaults an unqualified name to the
   *  patter scope - but it is the shorthand, not the address a row reports.)
   *
   *  With no prefix this is just the name. Both families forked this interface
   *  to add exactly this field - once per runtime - which is the same reason
   *  `stages` is here. */
  path: string;
  type: PropertyType;
  value: ScalarValue | undefined;
  default: ScalarValue;
  values?: string[];
  /** A quality's ordered stage ladder, so an inspector can offer the stages
   *  instead of a free-text box. `quality` has been in PropertyType since the
   *  ladder landed, and the evaluator compares stages by LADDER POSITION and
   *  refuses an unknown one, so free text is not a soft failure: a typo breaks
   *  play rather than being corrected. This row is the only thing an examiner
   *  sees, so a ladder it cannot carry is a ladder no editor can offer. One
   *  consumer forked this whole interface to add the field; the field belongs
   *  here, beside the `values` it is the closed-set twin of. */
  stages?: string[];
  writable: boolean;
}

export class PropertyBag {
  /** The live values record (stable identity across reseed, so an
   *  EvalContext built over it stays valid). Read-path for evaluation;
   *  writes go through `set` so the firing rule applies. */
  readonly values: Record<string, ScalarValue> = {};
  private decls = new Map<string, ScopeDeclaration>();
  private readonly subscribers = new Set<(change: BagChange) => void>();
  private readonly auditors = new Set<(change: BagChange) => void>();
  /** Name normalisation policy: lowercase by default (the registry's
   *  long-standing contract); a product whose names are case-significant
   *  passes identity. */
  private readonly norm: (name: string) => string;

  /** The address prefix this bag's rows carry, separator included (`@`,
   *  `@scene.`, `world.`, `deck.<id>.`). Empty means a row's path is its name. */
  readonly pathPrefix: string;

  constructor(
    declarations: ScopeDeclaration[] = [],
    opts?: { normalise?: (name: string) => string; pathPrefix?: string },
  ) {
    this.norm = opts?.normalise ?? ((n) => n.toLowerCase());
    this.pathPrefix = opts?.pathPrefix ?? "";
    this.seed(declarations);
  }

  private seed(declarations: ScopeDeclaration[]): void {
    for (const d of declarations) {
      const name = this.norm(d.name);
      this.decls.set(name, d);
      // Cloned so bags seeded from one declaration set never share a
      // mutable default (flags arrays).
      this.values[name] = structuredClone(d.default ?? defaultFor(d));
    }
  }

  get(name: string): ScalarValue | undefined {
    return this.values[this.norm(name)];
  }

  /** A name as this bag keys it: its normalisation policy applied. The registry
   *  uses it to key quality ladders and the validation schema the bag's own way,
   *  so a case-significant (identity) bag is not quietly folded to lower case
   *  one layer up. */
  normalise(name: string): string {
    return this.norm(name);
  }

  /** Write a property. Engine writes (the default) notify subscribers;
   *  pass `silent: true` for a host write, which reaches only the audit
   *  hook. Throws on a read-only property unless the caller says it is the
   *  HOST (`host: true`), for whom `writable: false` was never a rule - it is
   *  the story's promise, not the game's. `silent` and `host` are separate on
   *  purpose: one is about who hears the write, the other about who may make
   *  it. Returns the change. */
  set(name: string, value: ScalarValue, opts?: { silent?: boolean; reason?: string; host?: boolean }): BagChange {
    const n = this.norm(name);
    if (!opts?.host && this.decls.get(n)?.writable === false) throw new Error(`'${name}' is read-only`);
    const change: BagChange = {
      name: n,
      prev: this.values[n],
      next: value,
      silent: opts?.silent ?? false,
      reason: opts?.reason,
    };
    this.values[n] = value;
    for (const audit of this.auditors) audit(change);
    if (!change.silent) for (const fn of this.subscribers) fn(change);
    return change;
  }

  /** Notified of engine (non-silent) writes. Returns the unsubscribe. */
  subscribe(fn: (change: BagChange) => void): () => void {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  /** Notified of EVERY write, silent or not. Returns the unsubscribe. */
  onAudit(fn: (change: BagChange) => void): () => void {
    this.auditors.add(fn);
    return () => this.auditors.delete(fn);
  }

  /** Examiner rows: the declared surface only (stray values are storage,
   *  not surface). */
  rows(): PropertyRow[] {
    return [...this.decls.entries()].map(([name, d]) => rowFor(d, this.get(name), undefined, name, this.pathPrefix));
  }

  declarations(): ScopeDeclaration[] {
    return [...this.decls.values()];
  }

  /** The one sanctioned copy door: values deep-copied, declarations
   *  duplicated, the normalisation policy carried, subscriptions NOT
   *  carried. */
  clone(): PropertyBag {
    const c = new PropertyBag([], { normalise: this.norm, pathPrefix: this.pathPrefix });
    c.decls = new Map(this.decls);
    Object.assign(c.values, structuredClone(this.values));
    return c;
  }

  /** Clear and re-seed from new declarations, in place (the values record
   *  keeps its identity, so contexts built over it stay valid). */
  reseed(declarations: ScopeDeclaration[]): void {
    for (const k of Object.keys(this.values)) delete this.values[k];
    this.decls.clear();
    this.seed(declarations);
  }

  /** Bare values, ready to embed in a product's save. */
  save(): Record<string, ScalarValue> {
    return structuredClone(this.values);
  }

  /** Lay saved values over the current ones (call after a fresh seed:
   *  orphans land as strays, new declarations keep their defaults; the
   *  product decides whether to prune). Does not fire events. */
  load(values: Record<string, ScalarValue>): void {
    for (const [k, v] of Object.entries(values)) this.values[this.norm(k)] = v;
  }
}

function rowFor(
  d: ScopeDeclaration,
  value: ScalarValue | undefined,
  writable?: boolean,
  name?: string,
  pathPrefix = "",
): PropertyRow {
  const rowName = name ?? d.name.toLowerCase();
  return {
    name: rowName,
    path: pathPrefix + rowName,
    type: d.type,
    value,
    default: d.default ?? defaultFor(d),
    ...(d.values !== undefined ? { values: d.values } : {}),
    // `stages` was added to the row so an examiner could offer a quality's ladder
    // instead of a free-text box, and then never populated here: every quality row
    // this function built came out without one. Fixed 2026-09-02.
    ...(d.stages !== undefined ? { stages: d.stages } : {}),
    writable: writable ?? d.writable ?? true,
  };
}

// ---------------------------------------------------------------------------
// The registry / state container
// ---------------------------------------------------------------------------

interface OwnedScope {
  kind: "owned";
  bag: PropertyBag;
  owner?: string;
}
interface ForeignScope {
  kind: "foreign";
  resolver: ScopeResolver;
  decls: Map<string, ScopeDeclaration>;
  scopeWritable: boolean;
  norm: (name: string) => string;
  owner?: string;
}
type Entry = OwnedScope | ForeignScope;

const lowerCase = (name: string): string => name.toLowerCase();

/** Options for an owned scope the registry builds (`defineOwned`). */
export interface OwnedScopeOptions {
  /** The address prefix its examiner rows carry, separator included. Defaults
   *  to `<token>.`; the address grammar is the product's, not the registry's. */
  pathPrefix?: string;
  /** Name normalisation: lower case by default; a case-significant product
   *  passes identity. */
  normalise?: (name: string) => string;
  /** Who registered it (an engine's name). Named in a clash error and carried
   *  on examiner rows, so one examiner can group a combined game by engine. */
  owner?: string;
}

/** Options for a foreign scope (`defineForeign`). */
export interface ForeignScopeOptions {
  /** Scope-level read/write default for its declarations (default true). */
  writable?: boolean;
  /** Name normalisation for the names passed to the resolver: lower case by
   *  default; a case-significant product passes identity. */
  normalise?: (name: string) => string;
  /** Who registered it. See `OwnedScopeOptions.owner`. */
  owner?: string;
}

/** Options for a context or schema built from the registry. */
export interface AliasOptions {
  /**
   * Expression token -> registered key. `{ scene: "patter/flow-2/scene/tavern" }`
   * makes `@scene` read that instance bag, for this context only.
   *
   * The registry learns nothing about what the token MEANS: which flow, which
   * scene, which deck is an engine's own idea, and the engine names the key per
   * evaluation. It has to be the registry's mechanism rather than the engine
   * patching the context afterwards, because quality ladders and validation are
   * looked up by token too, and an alias applies to all three alike.
   *
   * An alias to a key that is not registered throws: a condition evaluated
   * against a scope that is not there is an engine bug, not a graceful false.
   */
  aliases?: Record<string, string>;
}

/** Options for `remove`. */
export interface RemoveOptions {
  /** Park an owned scope's values, to be handed back when the same key is next
   *  registered (a live reload rebuilding an engine). No effect on a foreign
   *  scope, whose values were never the registry's. */
  keep?: boolean;
}

/**
 * The versioned owned-state fragment.
 *
 * @deprecated Versioning belongs to the save that embeds the values, not to the
 * registry; no engine ever called this. Embed `save()` in your own versioned
 * save instead. Removed at the next breaking release.
 */
export interface OwnedStateFragment {
  version: number;
  scopes: Record<string, Record<string, ScalarValue>>;
}

/** @deprecated See `OwnedStateFragment`. Removed at the next breaking release. */
export const SAVE_FRAGMENT_VERSION = 1;

export class ScopeRegistry {
  private readonly scopes = new Map<string, Entry>();
  /** Values loaded for keys nobody has registered yet, waiting to be claimed. */
  private readonly parked = new Map<string, Record<string, ScalarValue>>();

  /**
   * Register a scope this registry **owns and stores**. Its bag is seeded from
   * each declaration's `default` (or a type default). Owned scopes are
   * type-checked (declarations) and serialized by `save`/`load`.
   *
   * The third argument may be the path prefix alone (the pre-0.7 form) or an
   * options object.
   */
  defineOwned(token: string, declarations: ScopeDeclaration[], opts?: string | OwnedScopeOptions): this {
    const o: OwnedScopeOptions = typeof opts === "string" ? { pathPrefix: opts } : opts ?? {};
    // The scope knows its own token, so its rows can address themselves: `world.hp`.
    // The ADDRESS GRAMMAR is the product's, though, not the registry's - Patterplay
    // writes `@patter.gold` where the Storylet Engine writes `world.gold` - so a
    // caller may say how its addresses look. A bag MOUNTED here keeps whatever prefix
    // its holder gave it: the holder owns the addressing.
    const bag = new PropertyBag(declarations, {
      pathPrefix: o.pathPrefix ?? `${token}.`,
      ...(o.normalise ? { normalise: o.normalise } : {}),
    });
    return this.mountOwned(token, bag, o.owner !== undefined ? { owner: o.owner } : undefined);
  }

  /**
   * Attach an EXISTING bag as an owned scope: an engine (or a host) holds the
   * bag and this registry reads, writes, lists and saves it like its own.
   *
   * If values were loaded for this key before anyone registered it, the bag
   * claims them now: laid over its seeded defaults by the bag's own `load` rule.
   */
  mountOwned(token: string, bag: PropertyBag, opts?: { owner?: string }): this {
    this.assertFree(token, opts?.owner);
    this.scopes.set(token, { kind: "owned", bag, ...(opts?.owner !== undefined ? { owner: opts.owner } : {}) });
    const waiting = this.parked.get(token);
    if (waiting) {
      bag.load(waiting);
      this.parked.delete(token);
    }
    return this;
  }

  /**
   * Unregister a scope. With `{ keep: true }` an owned scope's values are parked
   * and handed back when the same key is next registered, which is how a live
   * reload hands an engine's state to its replacement. Throws on an unknown key.
   */
  remove(token: string, opts?: RemoveOptions): this {
    const e = this.scopes.get(token);
    if (!e) throw new Error(`unknown scope '@${token}'`);
    if (opts?.keep && e.kind === "owned") this.parked.set(token, e.bag.save());
    this.scopes.delete(token);
    return this;
  }

  /**
   * Drop every parked value nobody claimed. Parked values are kept in the next
   * save by default, so nothing loaded is lost to a flow or deck that simply has
   * not reopened yet; a game that knows they are dead drops them here.
   */
  discardParked(): this {
    this.parked.clear();
    return this;
  }

  /** An owned scope's bag (subscribe, audit, rows live there). */
  ownedBag(token: string): PropertyBag {
    const e = this.scopes.get(token);
    if (!e || e.kind !== "owned") throw new Error(`'@${token}' is not an owned scope`);
    return e.bag;
  }

  /**
   * Re-initialise an existing **owned** scope's bag from new declarations,
   * clearing its current values. For scope-local state that resets on a context
   * change (e.g. entering a new scene / site / deck) without disturbing other
   * scopes. Mutates the bag in place, so an `EvalContext` already built from this
   * registry stays valid.
   */
  reseedOwned(token: string, declarations: ScopeDeclaration[]): this {
    this.ownedBag(token).reseed(declarations);
    return this;
  }

  /**
   * Register a **foreign** scope backed by a host `{ get, set? }` resolver. The
   * values live in the host/other engine and are never stored or saved here.
   * `declarations` (optional, e.g. imported from a `scopeRegistrySpec`) are used
   * only for validation; omit them for an opaque scope.
   */
  defineForeign(
    token: string,
    resolver: ScopeResolver,
    declarations: ScopeDeclaration[] = [],
    opts: boolean | ForeignScopeOptions = true,
  ): this {
    // A boolean is the pre-0.7 form: the scope-level writable default alone.
    const o: ForeignScopeOptions = typeof opts === "boolean" ? { writable: opts } : opts;
    this.assertFree(token, o.owner);
    const norm = o.normalise ?? lowerCase;
    const decls = new Map<string, ScopeDeclaration>();
    for (const d of declarations) decls.set(norm(d.name), d);
    this.scopes.set(token, {
      kind: "foreign", resolver, decls, scopeWritable: o.writable ?? true, norm,
      ...(o.owner !== undefined ? { owner: o.owner } : {}),
    });
    return this;
  }

  has(token: string): boolean {
    return this.scopes.has(token);
  }

  /** Read a property; undefined if the scope or property is not present. */
  get(scope: string, name: string): ScalarValue | undefined {
    const e = this.scopes.get(scope);
    if (!e) return undefined;
    return e.kind === "owned" ? e.bag.get(name) : e.resolver.get(e.norm(name));
  }

  /** Write a property (an ENGINE write: the bag's subscribers fire; use
   *  the bag directly for silent host writes). Throws on an unknown scope.
   *
   *  `writable: false` is the STORY's promise, so a story write is refused and
   *  a HOST write is not: pass `{ host: true }` from a host's own surface (its
   *  `setProperty`, its tooling, a coverage driver) and never from the path an
   *  outcome or effect takes. A foreign scope whose resolver has no `set` is
   *  refused for everyone, host included - that is not a rule to bypass, it is
   *  a game that gave no way to write. */
  set(scope: string, name: string, value: ScalarValue, opts?: { host?: boolean }): void {
    const e = this.scopes.get(scope);
    if (!e) throw new Error(`unknown scope '@${scope}'`);
    if (e.kind === "owned") {
      try {
        e.bag.set(name, value, opts?.host ? { host: true } : undefined);
      } catch {
        throw new Error(`'@${scope}.${name}' is read-only`);
      }
      return;
    }
    const n = e.norm(name);
    if (!e.resolver.set) throw new Error(`'@${scope}.${name}' is read-only`);
    if (!opts?.host && !this.foreignWritable(e, n)) throw new Error(`'@${scope}.${name}' is read-only`);
    e.resolver.set(n, value);
  }

  private foreignWritable(e: ForeignScope, name: string): boolean {
    if (!e.resolver.set) return false;                 // no setter => read-only scope
    return e.decls.get(name)?.writable ?? e.scopeWritable;
  }

  /** Examiner rows across every scope with a declared surface: owned bags
   *  first, then declared foreign scopes (values read through, writability
   *  reflecting the resolver). Opaque foreign scopes are not listed. */
  listProperties(): ({ scope: string; owner?: string } & PropertyRow)[] {
    const out: ({ scope: string; owner?: string } & PropertyRow)[] = [];
    for (const [token, e] of this.scopes) {
      const owner = e.owner !== undefined ? { owner: e.owner } : {};
      if (e.kind === "owned") {
        for (const row of e.bag.rows()) out.push({ scope: token, ...owner, ...row });
      } else {
        for (const [n, d] of e.decls) {
          out.push({
            scope: token, ...owner,
            ...rowFor(d, e.resolver.get(n), this.foreignWritable(e, n), n, `${token}.`),
          });
        }
      }
    }
    return out;
  }

  /**
   * Build the `EvalContext` expr's `evaluate` consumes: owned scopes as static
   * bags, foreign scopes as their resolvers. `host` carries dialect-function
   * callbacks (PRNG, tag lookups) and is passed through untouched.
   */
  toEvalContext(host?: Record<string, unknown>, opts?: AliasOptions): EvalContext {
    const view = this.view(opts?.aliases);
    const scopes: EvalContext["scopes"] = {};
    for (const [token, e] of view) scopes[token] = e.kind === "owned" ? e.bag.values : e.resolver;
    // The quality channel (quality.md): declared here once, so a host that
    // registers a quality gets ordering comparisons and advance() with no
    // further wiring. Only added when a quality exists, so contexts stay
    // byte-identical for products that declare none.
    const qualities = this.qualityLadders(view);
    return qualities.size === 0 ? { scopes, host } : {
      scopes, host,
      qualities: (scope, name) => {
        const e = view.get(scope);
        return e ? qualities.get(scope)?.get(normOf(e)(name)) : undefined;
      },
    };
  }

  /**
   * The scopes an expression sees: every registered key under its own token,
   * then each alias token pointing at its key's entry (an alias shadows a key of
   * the same name). Keys an engine uses for instance bags (`engine/flow-2/...`)
   * are not valid expression tokens, so they are present but unreachable.
   */
  private view(aliases?: Record<string, string>): Map<string, Entry> {
    const out = new Map(this.scopes);
    for (const [token, key] of Object.entries(aliases ?? {})) {
      const e = this.scopes.get(key);
      if (!e) throw new Error(`alias '@${token}' names '${key}', which is not registered`);
      out.set(token, e);
    }
    return out;
  }

  /** Every quality declaration's ladder, keyed scope token then name (the
   *  scope's own normalisation). */
  private qualityLadders(view: Map<string, Entry>): Map<string, Map<string, readonly string[]>> {
    const out = new Map<string, Map<string, readonly string[]>>();
    for (const [token, e] of view) {
      for (const [n, d] of declsOf(e)) {
        if (d.type !== "quality" || d.stages === undefined) continue;
        let m = out.get(token);
        if (!m) { m = new Map(); out.set(token, m); }
        m.set(n, d.stages);
      }
    }
    return out;
  }

  /**
   * Build the `ExpressionSchema` expr's validator consumes. Scopes with no
   * declarations are **omitted** (opaque - references into them are not flagged);
   * declared scopes contribute their property types for validation. Aliases
   * apply as they do to `toEvalContext`, so a condition written against `@scene`
   * validates against the instance bag the engine names.
   */
  toSchema(opts?: AliasOptions): ExpressionSchema {
    const properties = new Map<string, Map<string, { type: PropertyType; enumValues?: string[]; stages?: string[] }>>();
    for (const [token, e] of this.view(opts?.aliases)) {
      const decls = declsOf(e);
      if (decls.length === 0) continue;
      const m = new Map<string, { type: PropertyType; enumValues?: string[]; stages?: string[] }>();
      for (const [n, d] of decls) m.set(n, {
        type: d.type, enumValues: d.values,
        ...(d.stages !== undefined ? { stages: d.stages } : {}),
      });
      properties.set(token, m);
    }
    return { properties };
  }

  /** Serialize **owned** scopes (foreign scopes are the game's, and the game
   *  saves them), as bare bags keyed by token, plus any values still parked, so
   *  a save taken before every engine has re-registered loses nothing. The
   *  registry knows nothing about game saves: a game embeds this in its own. */
  save(): Record<string, Record<string, ScalarValue>> {
    const out: Record<string, Record<string, ScalarValue>> = {};
    for (const [token, e] of this.scopes) if (e.kind === "owned") out[token] = e.bag.save();
    for (const [token, vals] of this.parked) out[token] = structuredClone(vals);
    return out;
  }

  /**
   * Restore from a `save` blob. An owned scope lays its section over its current
   * values (the bag's `load` rule). A section for a key nobody has registered
   * yet is PARKED and handed over when that key registers, so a game can load
   * its registry before its engines have reopened their flows or decks. A
   * section for a foreign scope is ignored: those values are the game's.
   *
   * A load replaces whatever was parked before it: it is a whole restore, and
   * residue from an earlier load must not leak into this one.
   *
   * Changed in 0.7.0: sections for unregistered keys used to be dropped.
   */
  load(blob: Record<string, Record<string, ScalarValue>>): void {
    this.parked.clear();
    for (const [token, vals] of Object.entries(blob)) {
      const e = this.scopes.get(token);
      if (e?.kind === "owned") e.bag.load(vals);
      else if (!e) this.parked.set(token, structuredClone(vals));
    }
  }

  /**
   * `save()` wrapped with a version stamp.
   *
   * @deprecated Versioning belongs to the save that embeds the values; no
   * engine ever called this. Embed `save()` in your own versioned save.
   * Removed at the next breaking release.
   */
  saveFragment(): OwnedStateFragment {
    return { version: SAVE_FRAGMENT_VERSION, scopes: this.save() };
  }

  /**
   * Restore from a versioned fragment; an unsupported version throws.
   *
   * @deprecated See `saveFragment`. Removed at the next breaking release.
   */
  loadFragment(fragment: OwnedStateFragment): void {
    if (fragment.version !== SAVE_FRAGMENT_VERSION) {
      throw new Error(`unsupported owned-state fragment version ${fragment.version} (supported: ${SAVE_FRAGMENT_VERSION})`);
    }
    this.load(fragment.scopes);
  }

  /**
   * A token is taken once. There is no reserved-token list: a clash surfaces
   * here, the moment a game combines its engines, which is the only moment
   * anyone knows which engines are present. With owners recorded the error says
   * whose token it already is.
   */
  private assertFree(token: string, owner?: string): void {
    const e = this.scopes.get(token);
    if (!e) return;
    const by = e.owner !== undefined ? ` by ${e.owner}` : "";
    const wants = owner !== undefined ? ` (wanted by ${owner})` : "";
    throw new Error(`scope '@${token}' is already registered${by}${wants}`);
  }
}

/** A scope entry's declarations, keyed by its own normalisation. */
function declsOf(e: Entry): [string, ScopeDeclaration][] {
  if (e.kind === "foreign") return [...e.decls.entries()];
  return e.bag.declarations().map((d) => [e.bag.normalise(d.name), d]);
}

/** A scope entry's name normalisation. */
function normOf(e: Entry): (name: string) => string {
  return e.kind === "foreign" ? e.norm : (n) => e.bag.normalise(n);
}

/** The seed value for a declared property: its own `default`, else the type's.
 *
 *  Exported because it was being written again wherever a declaration needed seeding, and a
 *  copy of a defaults table is a copy that stops agreeing. Patterplay carried three of them in
 *  one file, for its shared decls, its host-scope decls and its scene decls - three declaration
 *  TYPES, one behaviour, and nothing to notice if a case drifted. The parameter is structurally
 *  typed for exactly that reason: anything with `type` and the optional `default` / `values` /
 *  `stages` fits, whatever the caller calls its declaration.
 *
 *  A quality seeds at the FIRST rung of its ladder: the ladder's start is the story's start. */
export function defaultFor(d: Pick<ScopeDeclaration, "type" | "default" | "values" | "stages">): ScalarValue {
  if (d.default !== undefined) return d.default;
  switch (d.type) {
    case "boolean": return false;
    case "number": return 0;
    case "string": return "";
    case "enum": return d.values?.[0] ?? "";
    case "flags": return [];
    // A quality starts at the first rung of its ladder.
    case "quality": return d.stages?.[0] ?? "";
    // Unreachable for a well-typed declaration, and deliberately present anyway: a bundle
    // is DATA, and a hand-edited or newer-than-this-build one can carry a type string the
    // union does not have. Falling off the switch would seed `undefined`, which is not a
    // ScalarValue and travels a long way before it fails. Patterplay's copy of this had the
    // guard and this one did not, which is the drift you only find by removing a duplicate.
    default: return false;
  }
}

// ---------------------------------------------------------------------------
// The state logger, which both product families had written twice each.
// ---------------------------------------------------------------------------
export type {
  StateSnapshot, StateChange, LogMount, StateLoggerAdapter, StateLoggerOptions, StateLogger,
} from "./state-logger.js";
export { createStateLogger, diffState } from "./state-logger.js";
