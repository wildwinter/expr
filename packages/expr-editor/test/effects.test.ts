import { describe, it, expect } from "vitest";
import {
  addSet, addEmit, removeAt, moveAt, updateAt, setArgAt, addArg, removeArgAt, seedValueSrc,
  entryForTarget, flagChangeSrc,
  type EditorEffect,
} from "../src/effects.js";
import { targetRefOf, type CatalogueEntry } from "../src/schema.js";

describe("effects list operations", () => {
  it("adds a set and an emit, preserving order", () => {
    let list: EditorEffect[] = [];
    list = addSet(list, "@gold", "@gold - 5");
    list = addEmit(list, "fanfare");
    expect(list).toEqual([
      { kind: "set", target: "@gold", value: "@gold - 5" },
      { kind: "emit", event: "fanfare", args: [] },
    ]);
  });

  it("does not mutate the input list (pure)", () => {
    const before: EditorEffect[] = [{ kind: "set", target: "@a", value: "1" }];
    const after = addSet(before, "@b", "2");
    expect(before).toHaveLength(1);
    expect(after).toHaveLength(2);
    expect(after[0]).not.toBe(before[0]); // deep clone, not shared
  });

  it("removes and reorders", () => {
    const list: EditorEffect[] = [
      { kind: "set", target: "@a", value: "1" },
      { kind: "set", target: "@b", value: "2" },
      { kind: "set", target: "@c", value: "3" },
    ];
    expect(removeAt(list, 1)).toEqual([
      { kind: "set", target: "@a", value: "1" },
      { kind: "set", target: "@c", value: "3" },
    ]);
    expect(moveAt(list, 0, 1)[0]).toEqual({ kind: "set", target: "@b", value: "2" });
    expect(moveAt(list, 0, -1)).toEqual(list); // clamped at the top edge
  });

  it("patches a target/value and re-seeds via updateAt", () => {
    const list: EditorEffect[] = [{ kind: "set", target: "@a", value: "1" }];
    expect(updateAt(list, 0, { target: "@b", value: "true" })[0]).toEqual({ kind: "set", target: "@b", value: "true" });
  });

  it("manages emit arguments", () => {
    let list: EditorEffect[] = [{ kind: "emit", event: "ping", args: [] }];
    list = addArg(list, 0, "1");
    list = addArg(list, 0, "2");
    list = setArgAt(list, 0, 1, "@gold");
    expect((list[0] as { args: string[] }).args).toEqual(["1", "@gold"]);
    list = removeArgAt(list, 0, 0);
    expect((list[0] as { args: string[] }).args).toEqual(["@gold"]);
  });

  it("arg ops are no-ops on a set effect", () => {
    const list: EditorEffect[] = [{ kind: "set", target: "@a", value: "1" }];
    expect(addArg(list, 0)).toEqual(list);
    expect(setArgAt(list, 0, 0, "x")).toEqual(list);
  });

  it("seeds a type-appropriate starting value", () => {
    expect(seedValueSrc("boolean")).toBe("true");
    expect(seedValueSrc("number")).toBe("0");
    expect(seedValueSrc("string")).toBe('""');
    expect(seedValueSrc("enum", ["calm", "tense"])).toBe('"calm"');
  });
});

// A change TARGET is a reference, not an expression: the storylets compiler
// requires `@scope.name` there, and the condition-side shorthand (`@name` for
// the default scope) is invalid. The editor emitted the shorthand for every
// default-scope target - a Storyletter antagonist audit's find (2026-08-29):
// each change authored through the picker failed validation with no visible
// error on the page and no way to hand-edit past it.
describe("targetRefOf: a change target is always fully qualified", () => {
  const story: CatalogueEntry = { scope: "story", name: "jobs", type: "flags", enumValues: ["cold_taken"] };
  const world: CatalogueEntry = { scope: "world", name: "armed", type: "boolean" };

  it("qualifies the default scope, unlike the condition-side refOf", () => {
    expect(targetRefOf(story)).toBe("@story.jobs");
    expect(targetRefOf(world)).toBe("@world.armed");
  });
});

describe("entryForTarget: read-back tolerates the legacy shorthand", () => {
  const cat: CatalogueEntry[] = [
    { scope: "story", name: "heat", type: "quality", stages: ["unnoticed", "watched", "hunted"] },
    { scope: "world", name: "armed", type: "boolean" },
  ];

  it("resolves a qualified target", () => {
    expect(entryForTarget(cat, "@story.heat", "story")?.name).toBe("heat");
    expect(entryForTarget(cat, "@world.armed", "story")?.name).toBe("armed");
  });

  it("resolves a legacy shorthand target written by an older build", () => {
    expect(entryForTarget(cat, "@heat", "story")?.name).toBe("heat");
  });

  it("shorthand answers only for the default scope, and a miss is a miss", () => {
    expect(entryForTarget(cat, "@armed", "story")).toBeUndefined();
    expect(entryForTarget(cat, "@story.nope", "story")).toBeUndefined();
  });
});

// The other unreachable form the audit found: the demo's own outcomes are all
// `set_flags(events, +blackout_done)` - adjust one flag, keep the rest - and
// the value step offered only whole-value kinds, with its own gloss warning
// that a change REPLACES. The flags step commits this source.
describe("flagChangeSrc: the set/clear-a-flag value", () => {
  it("builds a set and a clear against the qualified target", () => {
    expect(flagChangeSrc("@story.events", "+", "blackout_done")).toBe("set_flags(@story.events, +blackout_done)");
    expect(flagChangeSrc("@story.jobs", "-", "cold_taken")).toBe("set_flags(@story.jobs, -cold_taken)");
  });
});
