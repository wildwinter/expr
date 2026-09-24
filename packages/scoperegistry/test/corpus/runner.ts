// ---------------------------------------------------------------------------
// The registry corpus's reference runner.
//
// A port re-implements this interpreter in its own language and drives it from
// corpus.json. This file is the normative statement of what each step means: if
// a port's runner does something this one does not, the port is testing
// something else.
//
// Returns a list of failure strings (empty = pass), so one run reports every
// divergence in a case rather than stopping at the first.
// ---------------------------------------------------------------------------

import { deserialiseAst, evaluate } from "@wildwinter/expr";
import type { Dialect } from "@wildwinter/expr";
import { PropertyBag, ScopeRegistry, readScopeRegistrySpec } from "../../src/index.js";
import type { ScopeDeclaration } from "../../src/index.js";
import type { Decl, RegistryCase, RowExpect, Value } from "./types.js";

/**
 * The dialect the corpus is compiled with and the reference evaluates with. No
 * functions: a case exercises the registry's scope resolution and quality
 * ladders, both of which the evaluator's core handles without a dialect's help.
 * A port evaluates the published ast with whatever dialect it ships.
 */
export const corpusDialect: Dialect = {
  scopes: [{ token: "game" }, { token: "world" }, { token: "here" }, { token: "a" }, { token: "b" }],
  defaultScope: "game",
  functions: {},
};

const identity = (n: string): string => n;

/** Value equality for the corpus: flags compared element-wise IN ORDER (a saved
 *  list must come back as it went), objects by key set. */
export function same(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => same(x, b[i]));
  }
  if (a !== null && b !== null && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a as object), kb = Object.keys(b as object);
    return ka.length === kb.length
      && ka.every((k) => Object.prototype.hasOwnProperty.call(b, k)
        && same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return a === b;
}

const show = (v: unknown): string => (v === undefined ? "<unset>" : JSON.stringify(v));

const decls = (ds: Decl[] | undefined): ScopeDeclaration[] => (ds ?? []).map((d) => ({ ...d }));

export function runRegistryCase(c: RegistryCase): string[] {
  const fails: string[] = [];
  const r = new ScopeRegistry();
  const stores = new Map<string, Record<string, Value>>();

  /** Run `fn`. With `want`, it must throw a message containing `want`; without,
   *  it must not throw. Returns true when it ran without throwing. */
  const attempt = (at: string, want: string | undefined, fn: () => void): boolean => {
    try {
      fn();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (want === undefined) fails.push(`${at}: unexpected error: ${msg}`);
      else if (!msg.includes(want)) fails.push(`${at}: error "${msg}" does not say "${want}"`);
      return false;
    }
    if (want !== undefined) fails.push(`${at}: expected an error saying "${want}", none was raised`);
    return true;
  };

  c.steps.forEach((step, i) => {
    const at = `${c.name} [step ${i + 1}: ${step.op}]`;
    switch (step.op) {
      case "owned":
        attempt(at, step.expectError, () => r.defineOwned(step.token, decls(step.declarations), {
          ...(step.pathPrefix !== undefined ? { pathPrefix: step.pathPrefix } : {}),
          ...(step.normalise === "identity" ? { normalise: identity } : {}),
          ...(step.owner !== undefined ? { owner: step.owner } : {}),
        }));
        break;

      case "mount": {
        const bag = new PropertyBag(decls(step.declarations), {
          ...(step.pathPrefix !== undefined ? { pathPrefix: step.pathPrefix } : {}),
          ...(step.normalise === "identity" ? { normalise: identity } : {}),
        });
        attempt(at, step.expectError, () => r.mountOwned(step.token, bag, step.owner !== undefined ? { owner: step.owner } : undefined));
        break;
      }

      case "foreign": {
        const store: Record<string, Value> = structuredClone(step.store ?? {});
        const resolver = step.settable === false
          ? { get: (n: string) => store[n] }
          : { get: (n: string) => store[n], set: (n: string, v: Value) => { store[n] = v; } };
        const ok = attempt(at, step.expectError, () => r.defineForeign(step.token, resolver, decls(step.declarations), {
          ...(step.writable !== undefined ? { writable: step.writable } : {}),
          ...(step.normalise === "identity" ? { normalise: identity } : {}),
          ...(step.owner !== undefined ? { owner: step.owner } : {}),
        }));
        if (ok) stores.set(step.token, store);
        break;
      }

      case "set":
        attempt(at, step.expectError, () => r.set(step.scope, step.name, step.value, step.host ? { host: true } : undefined));
        break;

      case "get": {
        const got = r.get(step.scope, step.name);
        if (step.expectUnset) {
          if (got !== undefined) fails.push(`${at}: expected unset, got ${show(got)}`);
        } else if (!same(got, step.expect)) {
          fails.push(`${at}: got ${show(got)}, expected ${show(step.expect)}`);
        }
        break;
      }

      case "has":
        if (r.has(step.token) !== step.expect) fails.push(`${at}: has('${step.token}') is ${!step.expect}, expected ${step.expect}`);
        break;

      case "remove":
        attempt(at, step.expectError, () => r.remove(step.token, step.keep ? { keep: true } : undefined));
        break;

      case "save": {
        const got = r.save();
        if (!same(got, step.expect)) fails.push(`${at}: saved ${show(got)}, expected ${show(step.expect)}`);
        break;
      }

      case "load":
        attempt(at, undefined, () => r.load(structuredClone(step.blob), step.keepParked ? { keepParked: true } : undefined));
        break;

      case "discardParked":
        r.discardParked(step.prefix);
        break;

      case "revision":
        if (r.revision !== step.expect) fails.push(`${at}: revision is ${r.revision}, expected ${step.expect}`);
        break;

      case "store": {
        const got = stores.get(step.scope);
        if (!same(got, step.expect)) fails.push(`${at}: the game's store holds ${show(got)}, expected ${show(step.expect)}`);
        break;
      }

      case "rows": {
        const got: RowExpect[] = r.listProperties().map((row) => ({
          scope: row.scope,
          ...(row.owner !== undefined ? { owner: row.owner } : {}),
          name: row.name, path: row.path, value: row.value as Value, writable: row.writable,
        }));
        if (!same(got, step.expect)) fails.push(`${at}: rows ${show(got)}, expected ${show(step.expect)}`);
        break;
      }

      case "eval": {
        if (step.ast === undefined) { fails.push(`${at}: no compiled ast (the corpus was not built)`); break; }
        let got: Value | undefined;
        const ok = attempt(at, step.expectError, () => {
          const ctx = r.toEvalContext(undefined, step.aliases ? { aliases: step.aliases } : undefined);
          got = evaluate(deserialiseAst(step.ast!), ctx, corpusDialect);
        });
        if (ok && step.expectError === undefined && !same(got, step.expect)) {
          fails.push(`${at}: ${step.src} is ${show(got)}, expected ${show(step.expect)}`);
        }
        break;
      }

      case "spec": {
        let got: ReturnType<typeof readScopeRegistrySpec> = null;
        const ok = attempt(at, step.expectError, () => { got = readScopeRegistrySpec(step.source); });
        if (!ok || step.expectError !== undefined) break;
        const spec = got as ReturnType<typeof readScopeRegistrySpec>;
        if (step.expectAbsent) {
          if (spec !== null) fails.push(`${at}: expected no spec, got one`);
        } else if (spec === null) {
          fails.push(`${at}: expected a spec, got none`);
        } else {
          const summary = { version: spec.version, tokens: spec.scopes.map((s) => s.token) };
          if (!same(summary, step.expect)) fails.push(`${at}: read ${show(summary)}, expected ${show(step.expect)}`);
        }
        break;
      }
    }
  });
  return fails;
}
