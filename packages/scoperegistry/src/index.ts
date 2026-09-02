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
 * a property read-only; default is read/write. (`type`/`values` feed validation.)
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

  /** Write a property. Engine writes (the default) notify subscribers;
   *  pass `silent: true` for a host write, which reaches only the audit
   *  hook. Throws on a read-only property. Returns the change. */
  set(name: string, value: ScalarValue, opts?: { silent?: boolean; reason?: string }): BagChange {
    const n = this.norm(name);
    if (this.decls.get(n)?.writable === false) throw new Error(`'${name}' is read-only`);
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
}
interface ForeignScope {
  kind: "foreign";
  resolver: ScopeResolver;
  decls: Map<string, ScopeDeclaration>;
  scopeWritable: boolean;
}
type Entry = OwnedScope | ForeignScope;

/** The versioned owned-state fragment both product save envelopes embed
 *  (design/engine-runtimes.md 3.1: one serialisation shape for bags). */
export interface OwnedStateFragment {
  version: number;
  scopes: Record<string, Record<string, ScalarValue>>;
}

export const SAVE_FRAGMENT_VERSION = 1;

export class ScopeRegistry {
  private readonly scopes = new Map<string, Entry>();

  /**
   * Register a scope this registry **owns and stores**. Its bag is seeded from
   * each declaration's `default` (or a type default). Owned scopes are
   * type-checked (declarations) and serialized by `save`/`load`.
   */
  defineOwned(token: string, declarations: ScopeDeclaration[], pathPrefix?: string): this {
    // The scope knows its own token, so its rows can address themselves: `world.hp`.
    // The ADDRESS GRAMMAR is the product's, though, not the registry's - Patterplay
    // writes `@patter.gold` where the Storylet Engine writes `world.gold` - so a
    // caller may say how its addresses look. A bag MOUNTED here keeps whatever prefix
    // its holder gave it: the holder owns the addressing.
    return this.mountOwned(token, new PropertyBag(declarations, { pathPrefix: pathPrefix ?? `${token}.` }));
  }

  /**
   * Attach an EXISTING bag as an owned scope - the shared-container move: a
   * host (or the other product) holds the bag; this registry reads, writes
   * and lists it like its own, but the holder saves it.
   */
  mountOwned(token: string, bag: PropertyBag): this {
    this.assertFree(token);
    this.scopes.set(token, { kind: "owned", bag });
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
    scopeWritable = true,
  ): this {
    this.assertFree(token);
    const decls = new Map<string, ScopeDeclaration>();
    for (const d of declarations) decls.set(d.name.toLowerCase(), d);
    this.scopes.set(token, { kind: "foreign", resolver, decls, scopeWritable });
    return this;
  }

  has(token: string): boolean {
    return this.scopes.has(token);
  }

  /** Read a property; undefined if the scope or property is not present. */
  get(scope: string, name: string): ScalarValue | undefined {
    const e = this.scopes.get(scope);
    if (!e) return undefined;
    return e.kind === "owned" ? e.bag.get(name) : e.resolver.get(name.toLowerCase());
  }

  /** Write a property (an ENGINE write: the bag's subscribers fire; use
   *  the bag directly for silent host writes). Throws on an unknown or
   *  read-only scope/property. */
  set(scope: string, name: string, value: ScalarValue): void {
    const e = this.scopes.get(scope);
    if (!e) throw new Error(`unknown scope '@${scope}'`);
    if (e.kind === "owned") {
      try {
        e.bag.set(name, value);
      } catch {
        throw new Error(`'@${scope}.${name}' is read-only`);
      }
      return;
    }
    const n = name.toLowerCase();
    if (!this.foreignWritable(e, n)) throw new Error(`'@${scope}.${name}' is read-only`);
    e.resolver.set!(n, value);
  }

  private foreignWritable(e: ForeignScope, name: string): boolean {
    if (!e.resolver.set) return false;                 // no setter => read-only scope
    return e.decls.get(name)?.writable ?? e.scopeWritable;
  }

  /** Examiner rows across every scope with a declared surface: owned bags
   *  first, then declared foreign scopes (values read through, writability
   *  reflecting the resolver). Opaque foreign scopes are not listed. */
  listProperties(): ({ scope: string } & PropertyRow)[] {
    const out: ({ scope: string } & PropertyRow)[] = [];
    for (const [token, e] of this.scopes) {
      if (e.kind === "owned") {
        for (const row of e.bag.rows()) out.push({ scope: token, ...row });
      } else {
        for (const d of e.decls.values()) {
          out.push({
            scope: token,
            ...rowFor(d, e.resolver.get(d.name.toLowerCase()), this.foreignWritable(e, d.name.toLowerCase()),
                      undefined, `${token}.`),
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
  toEvalContext(host?: Record<string, unknown>): EvalContext {
    const scopes: EvalContext["scopes"] = {};
    for (const [token, e] of this.scopes) {
      scopes[token] = e.kind === "owned" ? e.bag.values : e.resolver;
    }
    // The quality channel (quality.md): declared here once, so a host that
    // registers a quality gets ordering comparisons and advance() with no
    // further wiring. Only added when a quality exists, so contexts stay
    // byte-identical for products that declare none.
    const qualities = this.qualityLadders();
    return qualities.size === 0 ? { scopes, host } : {
      scopes, host,
      qualities: (scope, name) => qualities.get(scope)?.get(name.toLowerCase()),
    };
  }

  /** Every quality declaration's ladder, keyed scope token then name. */
  private qualityLadders(): Map<string, Map<string, readonly string[]>> {
    const out = new Map<string, Map<string, readonly string[]>>();
    for (const [token, e] of this.scopes) {
      const decls = e.kind === "owned" ? e.bag.declarations() : [...e.decls.values()];
      for (const d of decls) {
        if (d.type !== "quality" || d.stages === undefined) continue;
        let m = out.get(token);
        if (!m) { m = new Map(); out.set(token, m); }
        m.set(d.name.toLowerCase(), d.stages);
      }
    }
    return out;
  }

  /**
   * Build the `ExpressionSchema` expr's validator consumes. Scopes with no
   * declarations are **omitted** (opaque - references into them are not flagged);
   * declared scopes contribute their property types for validation.
   */
  toSchema(): ExpressionSchema {
    const properties = new Map<string, Map<string, { type: PropertyType; enumValues?: string[]; stages?: string[] }>>();
    for (const [token, e] of this.scopes) {
      const decls = e.kind === "owned" ? e.bag.declarations() : [...e.decls.values()];
      if (decls.length === 0) continue;
      const m = new Map<string, { type: PropertyType; enumValues?: string[]; stages?: string[] }>();
      for (const d of decls) m.set(d.name.toLowerCase(), {
        type: d.type, enumValues: d.values,
        ...(d.stages !== undefined ? { stages: d.stages } : {}),
      });
      properties.set(token, m);
    }
    return { properties };
  }

  /** Serialize **owned** scopes only (foreign scopes are host-owned,
   *  host-saved), as bare bags - the 0.1.x shape, kept stable so existing
   *  consumers' save formats are untouched. A product embedding the
   *  versioned cross-product shape uses `saveFragment`. */
  save(): Record<string, Record<string, ScalarValue>> {
    const out: Record<string, Record<string, ScalarValue>> = {};
    for (const [token, e] of this.scopes) if (e.kind === "owned") out[token] = e.bag.save();
    return out;
  }

  /** Restore owned-scope values from a `save` blob. Unknown/foreign scopes
   *  are ignored. */
  load(blob: Record<string, Record<string, ScalarValue>>): void {
    for (const [token, vals] of Object.entries(blob)) {
      const e = this.scopes.get(token);
      if (e?.kind === "owned") e.bag.load(vals);
    }
  }

  /** The versioned owned-state fragment (the one serialisation shape both
   *  product families' save envelopes embed when they adopt the kernel;
   *  design/engine-runtimes.md 3.1). `save()` wrapped with a version stamp. */
  saveFragment(): OwnedStateFragment {
    return { version: SAVE_FRAGMENT_VERSION, scopes: this.save() };
  }

  /** Restore from a versioned fragment; an unsupported version throws. */
  loadFragment(fragment: OwnedStateFragment): void {
    if (fragment.version !== SAVE_FRAGMENT_VERSION) {
      throw new Error(`unsupported owned-state fragment version ${fragment.version} (supported: ${SAVE_FRAGMENT_VERSION})`);
    }
    this.load(fragment.scopes);
  }

  private assertFree(token: string): void {
    if (this.scopes.has(token)) throw new Error(`scope '@${token}' is already registered`);
  }
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
  StateSnapshot, StateChange, BagMount, StateLoggerAdapter, StateLoggerOptions, StateLogger,
} from "./state-logger.js";
export { createStateLogger, diffState } from "./state-logger.js";
