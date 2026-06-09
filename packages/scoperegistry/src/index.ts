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
// The registry / state container
// ---------------------------------------------------------------------------

interface OwnedScope {
  kind: "owned";
  bag: Record<string, ScalarValue>;
  decls: Map<string, ScopeDeclaration>;
}
interface ForeignScope {
  kind: "foreign";
  resolver: ScopeResolver;
  decls: Map<string, ScopeDeclaration>;
  scopeWritable: boolean;
}
type Entry = OwnedScope | ForeignScope;

export class ScopeRegistry {
  private readonly scopes = new Map<string, Entry>();

  /**
   * Register a scope this registry **owns and stores**. Its bag is seeded from
   * each declaration's `default` (or a type default). Owned scopes are
   * type-checked (declarations) and serialized by `save`/`load`.
   */
  defineOwned(token: string, declarations: ScopeDeclaration[]): this {
    this.assertFree(token);
    const bag: Record<string, ScalarValue> = {};
    const decls = new Map<string, ScopeDeclaration>();
    for (const d of declarations) {
      const name = d.name.toLowerCase();
      decls.set(name, d);
      bag[name] = d.default ?? defaultFor(d);
    }
    this.scopes.set(token, { kind: "owned", bag, decls });
    return this;
  }

  /**
   * Re-initialise an existing **owned** scope's bag from new declarations,
   * clearing its current values. For scope-local state that resets on a context
   * change (e.g. entering a new scene / site / deck) without disturbing other
   * scopes. Mutates the bag in place, so an `EvalContext` already built from this
   * registry stays valid.
   */
  reseedOwned(token: string, declarations: ScopeDeclaration[]): this {
    const e = this.scopes.get(token);
    if (!e || e.kind !== "owned") throw new Error(`'@${token}' is not an owned scope`);
    for (const k of Object.keys(e.bag)) delete e.bag[k];
    e.decls.clear();
    for (const d of declarations) {
      const name = d.name.toLowerCase();
      e.decls.set(name, d);
      e.bag[name] = d.default ?? defaultFor(d);
    }
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
    const n = name.toLowerCase();
    return e.kind === "owned" ? e.bag[n] : e.resolver.get(n);
  }

  /** Write a property. Throws on an unknown or read-only scope/property. */
  set(scope: string, name: string, value: ScalarValue): void {
    const e = this.scopes.get(scope);
    if (!e) throw new Error(`unknown scope '@${scope}'`);
    const n = name.toLowerCase();
    if (!this.writable(e, n)) throw new Error(`'@${scope}.${name}' is read-only`);
    if (e.kind === "owned") e.bag[n] = value;
    else e.resolver.set!(n, value);
  }

  private writable(e: Entry, name: string): boolean {
    if (e.kind === "owned") return e.decls.get(name)?.writable ?? true;
    if (!e.resolver.set) return false;                 // no setter => read-only scope
    return e.decls.get(name)?.writable ?? e.scopeWritable;
  }

  /**
   * Build the `EvalContext` expr's `evaluate` consumes: owned scopes as static
   * bags, foreign scopes as their resolvers. `host` carries dialect-function
   * callbacks (PRNG, tag lookups) and is passed through untouched.
   */
  toEvalContext(host?: Record<string, unknown>): EvalContext {
    const scopes: EvalContext["scopes"] = {};
    for (const [token, e] of this.scopes) {
      scopes[token] = e.kind === "owned" ? e.bag : e.resolver;
    }
    return { scopes, host };
  }

  /**
   * Build the `ExpressionSchema` expr's validator consumes. Scopes with no
   * declarations are **omitted** (opaque - references into them are not flagged);
   * declared scopes contribute their property types for validation.
   */
  toSchema(): ExpressionSchema {
    const properties = new Map<string, Map<string, { type: PropertyType; enumValues?: string[] }>>();
    for (const [token, e] of this.scopes) {
      if (e.decls.size === 0) continue;
      const m = new Map<string, { type: PropertyType; enumValues?: string[] }>();
      for (const [name, d] of e.decls) m.set(name, { type: d.type, enumValues: d.values });
      properties.set(token, m);
    }
    return { properties };
  }

  /** Serialize **owned** scopes only (foreign scopes are host-owned, host-saved). */
  save(): Record<string, Record<string, ScalarValue>> {
    const out: Record<string, Record<string, ScalarValue>> = {};
    for (const [token, e] of this.scopes) if (e.kind === "owned") out[token] = { ...e.bag };
    return out;
  }

  /** Restore owned-scope values from a `save` blob. Unknown/foreign scopes are ignored. */
  load(blob: Record<string, Record<string, ScalarValue>>): void {
    for (const [token, vals] of Object.entries(blob)) {
      const e = this.scopes.get(token);
      if (e?.kind === "owned") Object.assign(e.bag, vals);
    }
  }

  private assertFree(token: string): void {
    if (this.scopes.has(token)) throw new Error(`scope '@${token}' is already registered`);
  }
}

function defaultFor(d: ScopeDeclaration): ScalarValue {
  if (d.default !== undefined) return d.default;
  switch (d.type) {
    case "boolean": return false;
    case "number": return 0;
    case "string": return "";
    case "enum": return d.values?.[0] ?? "";
    case "flags": return [];
  }
}
