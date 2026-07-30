// The state-kernel growth (0.2.0): PropertyBag as a first-class citizen,
// the firing rule, examiner rows, the versioned owned-state fragment, and
// bag mounting on the registry. Contract-first: these expectations were
// written before the implementation (storylets-new design/engine-runtimes.md
// section 3.1 is the design of record).
import { describe, it, expect } from "vitest";
import { PropertyBag, ScopeRegistry, SAVE_FRAGMENT_VERSION } from "../src/index.js";
import type { BagChange, PropertyRow, ScalarValue } from "../src/index.js";

import type { ScopeDeclaration } from "../src/index.js";

const DECLS: ScopeDeclaration[] = [
  { name: "hp", type: "number", default: 10 },
  { name: "alerted", type: "boolean" },
  { name: "mood", type: "enum", values: ["calm", "angry"] },
  { name: "marks", type: "flags" },
  { name: "act", type: "number", default: 1, writable: false },
];

const bag = () => new PropertyBag([...DECLS]);

describe("PropertyBag: declarations and defaults", () => {
  it("seeds values from declaration defaults and type defaults", () => {
    const b = bag();
    expect(b.get("hp")).toBe(10);
    expect(b.get("alerted")).toBe(false);
    expect(b.get("mood")).toBe("calm");     // first enum value
    expect(b.get("marks")).toEqual([]);
    expect(b.get("act")).toBe(1);
  });

  it("lowercases names on both read and write", () => {
    const b = bag();
    b.set("HP", 3);
    expect(b.get("hp")).toBe(3);
    expect(b.get("Hp")).toBe(3);
  });

  it("exposes a live values record for expression evaluation", () => {
    const b = bag();
    const view = b.values;
    b.set("hp", 4);
    expect(view.hp).toBe(4);   // same object, not a copy
  });

  it("rejects a write to a read-only property", () => {
    expect(() => bag().set("act", 2)).toThrow(/read-only/);
  });

  it("allows undeclared names (opaque additions), like the registry always has", () => {
    const b = bag();
    b.set("stray", "x");
    expect(b.get("stray")).toBe("x");
  });
});

describe("PropertyBag: the firing rule", () => {
  it("an engine write notifies subscribers with prev and next", () => {
    const b = bag();
    const seen: BagChange[] = [];
    b.subscribe((c) => seen.push(c));
    b.set("hp", 7);
    expect(seen).toEqual([{ name: "hp", prev: 10, next: 7, silent: false }]);
  });

  it("a silent (host) write does not notify subscribers", () => {
    const b = bag();
    const seen: BagChange[] = [];
    b.subscribe((c) => seen.push(c));
    b.set("hp", 7, { silent: true, reason: "debug poke" });
    expect(seen).toEqual([]);
  });

  it("the audit hook sees every write, silent or not, with the reason", () => {
    const b = bag();
    const audit: BagChange[] = [];
    b.onAudit((c) => audit.push(c));
    b.set("hp", 7);
    b.set("hp", 8, { silent: true, reason: "host" });
    expect(audit.map((c) => [c.next, c.silent, c.reason])).toEqual([
      [7, false, undefined],
      [8, true, "host"],
    ]);
  });

  it("set returns the change (prev feeds a caller's own log)", () => {
    const change = bag().set("hp", 7);
    expect(change).toEqual({ name: "hp", prev: 10, next: 7, silent: false });
  });

  it("subscribe returns an unsubscribe", () => {
    const b = bag();
    const seen: BagChange[] = [];
    const off = b.subscribe((c) => seen.push(c));
    off();
    b.set("hp", 7);
    expect(seen).toEqual([]);
  });
});

describe("PropertyBag: examiner rows", () => {
  it("lists declared properties with type, value, default, values and writability", () => {
    const b = bag();
    b.set("hp", 2);
    const rows = b.rows();
    expect(rows.find((r) => r.name === "hp")).toEqual(
      { name: "hp", type: "number", value: 2, default: 10, writable: true });
    expect(rows.find((r) => r.name === "mood")).toEqual(
      { name: "mood", type: "enum", value: "calm", default: "calm", values: ["calm", "angry"], writable: true });
    expect(rows.find((r) => r.name === "act")?.writable).toBe(false);
  });

  it("rows cover declared properties only (stray values are not examiner surface)", () => {
    const b = bag();
    b.set("stray", "x");
    expect(b.rows().some((r) => r.name === "stray")).toBe(false);
  });
});

describe("PropertyBag: clone and reseed (the one sanctioned door)", () => {
  it("clone copies values and shares nothing mutable", () => {
    const b = bag();
    b.set("hp", 3);
    b.set("marks", ["seen"]);
    const c = b.clone();
    expect(c.get("hp")).toBe(3);
    c.set("hp", 9);
    (c.get("marks") as string[]).push("mutated");
    expect(b.get("hp")).toBe(3);
    expect(b.get("marks")).toEqual(["seen"]);
  });

  it("reseed clears values and re-applies new declarations", () => {
    const b = bag();
    b.set("hp", 3);
    b.reseed([{ name: "fresh", type: "string", default: "yes" }]);
    expect(b.get("fresh")).toBe("yes");
    expect(b.get("hp")).toBeUndefined();
  });
});

describe("PropertyBag: save and load", () => {
  it("round-trips bare values", () => {
    const b = bag();
    b.set("hp", 3);
    const c = bag();
    c.load(b.save());
    expect(c.get("hp")).toBe(3);
  });

  it("load lays saved values over fresh defaults: orphans drop, new declarations keep defaults", () => {
    const b = new PropertyBag([{ name: "kept", type: "number", default: 1 }]);
    b.load({ kept: 5, orphan: 9 } as Record<string, ScalarValue>);
    expect(b.get("kept")).toBe(5);
    expect(b.get("orphan")).toBe(9);   // laid over; the product decides whether to prune
  });
});

describe("ScopeRegistry: bags as citizens", () => {
  it("defineOwned exposes its bag via ownedBag", () => {
    const r = new ScopeRegistry().defineOwned("patter", [{ name: "hp", type: "number", default: 10 }]);
    const b = r.ownedBag("patter");
    b.set("hp", 4);
    expect(r.get("patter", "hp")).toBe(4);
  });

  it("mountOwned attaches an existing bag (shared with another holder)", () => {
    const shared = new PropertyBag([{ name: "gold", type: "number", default: 5 }]);
    const r = new ScopeRegistry().mountOwned("world", shared);
    expect(r.get("world", "gold")).toBe(5);
    shared.set("gold", 6);
    expect(r.get("world", "gold")).toBe(6);
    r.set("world", "gold", 7);
    expect(shared.get("gold")).toBe(7);
  });

  it("registry.set routes through the bag, so subscribers fire", () => {
    const r = new ScopeRegistry().defineOwned("patter", [{ name: "hp", type: "number", default: 10 }]);
    const seen: BagChange[] = [];
    r.ownedBag("patter").subscribe((c) => seen.push(c));
    r.set("patter", "hp", 7);
    expect(seen.length).toBe(1);
  });

  it("listProperties spans owned scopes and declared foreign scopes", () => {
    const hostGold: Record<string, ScalarValue> = { gold: 42 };
    const r = new ScopeRegistry()
      .defineOwned("patter", [{ name: "hp", type: "number", default: 10 }])
      .defineForeign("world", { get: (n) => hostGold[n] }, [{ name: "gold", type: "number" }]);
    const rows = r.listProperties();
    expect(rows).toEqual([
      { scope: "patter", name: "hp", type: "number", value: 10, default: 10, writable: true },
      { scope: "world", name: "gold", type: "number", value: 42, default: 0, writable: false },
    ] satisfies ({ scope: string } & PropertyRow)[]);
  });
});

describe("ScopeRegistry: the versioned owned-state fragment", () => {
  it("saveFragment wraps owned scopes in a version-stamped fragment; save keeps the bare 0.1.x shape", () => {
    const r = new ScopeRegistry().defineOwned("patter", [{ name: "hp", type: "number", default: 10 }]);
    r.set("patter", "hp", 3);
    expect(r.saveFragment()).toEqual({ version: SAVE_FRAGMENT_VERSION, scopes: { patter: { hp: 3 } } });
    expect(r.save()).toEqual({ patter: { hp: 3 } });
  });

  it("loadFragment restores owned scopes and ignores unknown or foreign tokens", () => {
    const r = new ScopeRegistry()
      .defineOwned("patter", [{ name: "hp", type: "number", default: 10 }])
      .defineForeign("world", { get: () => undefined });
    r.loadFragment({ version: 1, scopes: { patter: { hp: 4 }, world: { gold: 9 }, gone: { x: 1 } } });
    expect(r.get("patter", "hp")).toBe(4);
  });

  it("loadFragment rejects an unsupported fragment version", () => {
    const r = new ScopeRegistry().defineOwned("patter", []);
    expect(() => r.loadFragment({ version: 99, scopes: {} })).toThrow(/version/);
  });
});
