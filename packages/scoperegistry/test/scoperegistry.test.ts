import { describe, it, expect } from "vitest";
import { parse, evaluate, validateExpr } from "@wildwinter/expr";
import type { Dialect, ScalarValue } from "@wildwinter/expr";
import { ScopeRegistry, readScopeRegistrySpec } from "../src/index.js";

// A dialect whose scope tokens match the registry: `patter` (default, owned) and
// `game` (foreign). No functions needed for these tests.
const dialect: Dialect = {
  defaultScope: "patter",
  scopes: [{ token: "patter" }, { token: "game" }],
  functions: {},
};

const evalSrc = (src: string, r: ScopeRegistry, host?: Record<string, unknown>) =>
  evaluate(parse(src, dialect), r.toEvalContext(host), dialect);

const issues = (src: string, r: ScopeRegistry) =>
  validateExpr(parse(src, dialect), r.toSchema(), dialect);

describe("ScopeRegistry feeds expr", () => {
  it("evaluates against an owned scope's bag (seeded from defaults)", () => {
    const r = new ScopeRegistry().defineOwned("patter", [{ name: "hp", type: "number", default: 10 }]);
    expect(evalSrc("@hp > 5", r)).toBe(true);
    expect(r.get("patter", "hp")).toBe(10);
  });

  it("evaluates against a foreign scope through its resolver", () => {
    const r = new ScopeRegistry().defineForeign("game", { get: (n) => (n === "gold" ? 42 : undefined) });
    expect(evalSrc("@game.gold == 42", r)).toBe(true);
  });

  it("mixes owned and foreign scopes in one expression", () => {
    const r = new ScopeRegistry()
      .defineOwned("patter", [{ name: "bonus", type: "number", default: 3 }])
      .defineForeign("game", { get: (n) => (n === "gold" ? 10 : undefined) });
    expect(evalSrc("@bonus + @game.gold", r)).toBe(13);
  });
});

describe("get / set + read-only enforcement", () => {
  it("set writes an owned property; get reflects it", () => {
    const r = new ScopeRegistry().defineOwned("patter", [{ name: "hp", type: "number", default: 10 }]);
    r.set("patter", "hp", 7);
    expect(r.get("patter", "hp")).toBe(7);
    expect(evalSrc("@hp == 7", r)).toBe(true);
  });

  it("rejects a write to a read-only owned property", () => {
    const r = new ScopeRegistry().defineOwned("patter", [{ name: "act", type: "number", default: 1, writable: false }]);
    expect(() => r.set("patter", "act", 2)).toThrow(/read-only/);
  });

  it("writes a foreign property through a resolver with a setter", () => {
    const store: Record<string, ScalarValue> = {};
    const r = new ScopeRegistry().defineForeign("game", {
      get: (n) => store[n],
      set: (n, v) => { store[n] = v; },
    });
    r.set("game", "flag", true);
    expect(store.flag).toBe(true);
    expect(r.get("game", "flag")).toBe(true);
  });

  it("rejects a write to a foreign scope whose resolver has no setter", () => {
    const r = new ScopeRegistry().defineForeign("game", { get: () => 1 });
    expect(() => r.set("game", "x", 2)).toThrow(/read-only/);
  });

  it("rejects a write to a foreign property declared writable:false", () => {
    const r = new ScopeRegistry().defineForeign(
      "game",
      { get: () => 1, set: () => {} },
      [{ name: "locked", type: "number", writable: false }],
    );
    expect(() => r.set("game", "locked", 2)).toThrow(/read-only/);
  });
});

describe("toSchema drives validation", () => {
  it("flags an unknown property in a declared scope", () => {
    const r = new ScopeRegistry().defineOwned("patter", [{ name: "hp", type: "number", default: 0 }]);
    expect(issues("@hp > 1", r)).toEqual([]);
    expect(issues("@missing > 1", r).some((i) => i.kind === "unresolved-property")).toBe(true);
  });

  it("does not flag references into an opaque (undeclared) foreign scope", () => {
    const r = new ScopeRegistry().defineForeign("game", { get: () => undefined }); // no declarations
    expect(issues("@game.anything == 1", r)).toEqual([]);
  });

  it("flags an unknown property in a declared foreign scope", () => {
    const r = new ScopeRegistry().defineForeign(
      "game",
      { get: () => undefined },
      [{ name: "gold", type: "number" }],
    );
    expect(issues("@game.gold > 1", r)).toEqual([]);
    expect(issues("@game.nope > 1", r).some((i) => i.kind === "unresolved-scoped-property")).toBe(true);
  });
});

describe("save / load (owned scopes only)", () => {
  it("round-trips owned-scope state and ignores foreign scopes", () => {
    const r = new ScopeRegistry()
      .defineOwned("patter", [{ name: "hp", type: "number", default: 10 }])
      .defineForeign("game", { get: () => 99 });
    const snapshot = r.save();
    expect(snapshot).toEqual({ patter: { hp: 10 } }); // no `game`
    r.set("patter", "hp", 3);
    expect(r.get("patter", "hp")).toBe(3);
    r.load(snapshot);
    expect(r.get("patter", "hp")).toBe(10);
  });
});

describe("reseedOwned (scope-local reset)", () => {
  it("clears + re-seeds an owned scope without disturbing others, in place", () => {
    const r = new ScopeRegistry()
      .defineOwned("patter", [{ name: "hp", type: "number", default: 10 }])
      .defineOwned("scene", [{ name: "a", type: "number", default: 1 }]);
    const ctx = r.toEvalContext(); // captured before the reseed
    r.set("patter", "hp", 3);

    r.reseedOwned("scene", [{ name: "b", type: "number", default: 2 }]);
    expect(r.get("scene", "a")).toBeUndefined(); // old prop cleared
    expect(r.get("scene", "b")).toBe(2);
    expect(r.get("patter", "hp")).toBe(3);        // other scope untouched
    // in-place mutation keeps the previously-built context valid
    expect((ctx.scopes.scene as Record<string, unknown>).b).toBe(2);
  });

  it("throws when the scope is not an owned scope", () => {
    const r = new ScopeRegistry().defineForeign("game", { get: () => 1 });
    expect(() => r.reseedOwned("game", [])).toThrow(/not an owned scope/);
    expect(() => r.reseedOwned("nope", [])).toThrow(/not an owned scope/);
  });
});

describe("readScopeRegistrySpec (interop)", () => {
  const wrapper = {
    someOtherKey: 1,
    scopeRegistrySpec: {
      version: 1,
      scopes: [
        { token: "world", declarations: [{ name: "gold", type: "number" }] },
        { token: "ui", writable: false, declarations: [{ name: "menu_open", type: "boolean" }] },
      ],
    },
  };

  it("extracts the spec from a wrapper object (e.g. a .storyworld)", () => {
    const spec = readScopeRegistrySpec(wrapper);
    expect(spec?.version).toBe(1);
    expect(spec?.scopes.map((s) => s.token)).toEqual(["world", "ui"]);
  });

  it("returns null when the key is absent", () => {
    expect(readScopeRegistrySpec({ nope: true })).toBeNull();
    expect(readScopeRegistrySpec(null)).toBeNull();
  });

  it("throws on an unsupported version", () => {
    expect(() => readScopeRegistrySpec({ scopeRegistrySpec: { version: 99, scopes: [] } })).toThrow(/unsupported/);
  });

  it("imported declarations validate through the registry", () => {
    const spec = readScopeRegistrySpec(wrapper)!;
    const world = spec.scopes.find((s) => s.token === "world")!;
    const r = new ScopeRegistry().defineForeign("game", { get: () => undefined }, world.declarations);
    // (token renamed to @game here just to reuse the test dialect's foreign token)
    expect(issues("@game.gold > 0", r)).toEqual([]);
    expect(issues("@game.unknown > 0", r).some((i) => i.kind === "unresolved-scoped-property")).toBe(true);
  });
});
