import { describe, it, expect } from "vitest";
import {
  addSet, addEmit, removeAt, moveAt, updateAt, setArgAt, addArg, removeArgAt, seedValueSrc,
  type EditorEffect,
} from "../src/effects.js";

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
