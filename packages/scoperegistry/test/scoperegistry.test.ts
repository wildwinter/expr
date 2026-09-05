import { describe, it, expect } from "vitest";
import { parse, evaluate, validateExpr } from "@wildwinter/expr";
import type { Dialect, ScalarValue } from "@wildwinter/expr";
import { ScopeRegistry, PropertyBag, readScopeRegistrySpec } from "../src/index.js";

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
    expect(snapshot).toEqual({ patter: { hp: 10 } }); // no `game`; the 0.1.x shape, kept stable
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

// --- quality end to end (quality.md): declare it, and everything works -------
describe("a quality declared on the registry", () => {
  // Stage names that would sort wrongly as strings, so alphabet cannot pass.
  const reg = () => new ScopeRegistry().defineOwned("patter", [
    { name: "debt", type: "quality", stages: ["troubled", "confronted", "resolved"] },
  ]);

  it("defaults to its first stage", () => {
    expect(reg().get("patter", "debt")).toBe("troubled");
  });

  it("orders by ladder position with no wiring beyond the declaration", () => {
    const r = reg();
    expect(evalSrc('@debt >= "troubled"', r)).toBe(true);
    expect(evalSrc('@debt >= "confronted"', r)).toBe(false);
    r.set("patter", "debt", "resolved");
    expect(evalSrc('@debt >= "confronted"', r)).toBe(true);
  });

  it("advances along the ladder, saturating at the end", () => {
    const r = reg();
    expect(evalSrc("advance(@debt)", r)).toBe("confronted");
    r.set("patter", "debt", "resolved");
    expect(evalSrc("advance(@debt)", r)).toBe("resolved");
  });

  it("feeds the validator its stages", () => {
    const r = reg();
    expect(issues('@debt >= "confronted"', r)).toEqual([]);
    expect(issues('@debt >= "tpyo"', r).map((i) => i.message).join()).toContain("tpyo");
  });

  it("adds no channel when nothing is a quality, so other contexts are untouched", () => {
    const r = new ScopeRegistry().defineOwned("patter", [{ name: "hp", type: "number", default: 10 }]);
    expect("qualities" in r.toEvalContext()).toBe(false);
  });

  it("saves and loads as its plain stage name", () => {
    const r = reg();
    r.set("patter", "debt", "confronted");
    const saved = r.save();
    expect(saved["patter"]!["debt"]).toBe("confronted");
    const r2 = reg();
    r2.load(saved);
    expect(evalSrc('@debt == "confronted"', r2)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// `writable: false` is the STORY's promise, not the game's (ruled 2026-09-05).
// A host passes `{ host: true }` and writes; the story's path never does and is
// refused. Both products met this the hard way: the Storylet Engine's venue
// clock and Patter's coverage driver were each locked out of the one property
// they existed to move, because the kernel refused every caller alike.
// ---------------------------------------------------------------------------
describe("a read-only declaration refuses the story and admits the host", () => {
  it("owned: the story is refused, the host writes, the value follows", () => {
    const r = new ScopeRegistry().defineOwned("patter", [{ name: "act", type: "number", default: 1, writable: false }]);
    expect(() => r.set("patter", "act", 2)).toThrow("read-only");
    expect(r.get("patter", "act")).toBe(1);           // refused, not half written
    r.set("patter", "act", 2, { host: true });
    expect(r.get("patter", "act")).toBe(2);
  });

  it("foreign: the story is refused, the host reaches the resolver's set", () => {
    const store: Record<string, ScalarValue> = { clock: "day" };
    const r = new ScopeRegistry().defineForeign(
      "game",
      { get: (n) => store[n], set: (n, v) => { store[n] = v; } },
      [{ name: "clock", type: "string", writable: false }],
    );
    expect(() => r.set("game", "clock", "night")).toThrow("'@game.clock' is read-only");
    expect(store.clock).toBe("day");                  // the resolver's set was never called
    r.set("game", "clock", "night", { host: true });
    expect(store.clock).toBe("night");
  });

  it("a resolver with no set refuses EVERYONE, the host included", () => {
    // Not a rule to bypass: a game that gave no setter has nowhere for the write to land.
    const r = new ScopeRegistry().defineForeign("game", { get: () => "day" }, [{ name: "clock", type: "string" }]);
    expect(() => r.set("game", "clock", "night", { host: true })).toThrow("'@game.clock' is read-only");
  });

  it("a writable declaration is unchanged for either caller", () => {
    const r = new ScopeRegistry().defineOwned("patter", [{ name: "hp", type: "number", default: 3 }]);
    r.set("patter", "hp", 4);
    r.set("patter", "hp", 5, { host: true });
    expect(r.get("patter", "hp")).toBe(5);
  });

  it("the examiner still shows the declaration as read-only", () => {
    // The flag keeps its meaning in a state panel: it says the STORY cannot write it.
    const r = new ScopeRegistry().defineOwned("patter", [{ name: "act", type: "number", default: 1, writable: false }]);
    r.set("patter", "act", 7, { host: true });
    const row = r.listProperties().find((x) => x.name === "act")!;
    expect(row.writable).toBe(false);
    expect(row.value).toBe(7);
  });

  it("the bag's own set takes the same authority, and silent stays separate", () => {
    const bag = new PropertyBag([{ name: "act", type: "number", default: 1, writable: false }]);
    expect(() => bag.set("act", 2)).toThrow("read-only");
    const change = bag.set("act", 2, { host: true });  // host, and NOT silent
    expect(change.silent).toBe(false);
    expect(bag.get("act")).toBe(2);
  });
});
