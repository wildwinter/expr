import { describe, it, expect } from "vitest";
import { PropertyBag, createStateLogger, diffState } from "../src/index.js";

const bagOf = (prefix: string) =>
  new PropertyBag([{ name: "gold", type: "number", default: 0 },
                   { name: "marks", type: "flags", default: [] }], { pathPrefix: prefix });

describe("the kernel state logger", () => {
  it("logs a write as it lands, not at capture", () => {
    const lines: string[] = [];
    const bag = bagOf("story.");
    const log = createStateLogger({ mounts: () => [{ bag }] }, { sink: (l) => lines.push(l) });

    bag.set("gold", 5);
    // Already logged - nothing has been captured yet.
    expect(lines).toEqual(["story.gold: 0 -> 5"]);

    const changes = log.capture();
    expect(changes).toEqual([{ path: "story.gold", from: 0, to: 5 }]);
    expect(lines).toHaveLength(1);          // capture did not say it twice
    expect(log.capture()).toEqual([]);      // and does not keep saying it
  });

  it("sees a value that changed and changed back, which a diff cannot", () => {
    // The reason this is push-based. Between two captures the snapshots are equal,
    // so a differ reports nothing at all and the run looks quiet.
    const lines: string[] = [];
    const bag = bagOf("story.");
    const log = createStateLogger({ mounts: () => [{ bag }] }, { sink: (l) => lines.push(l) });

    bag.set("gold", 5);
    bag.set("gold", 0);

    expect(lines).toEqual(["story.gold: 0 -> 5", "story.gold: 5 -> 0"]);
    expect(log.capture()).toHaveLength(2);
    // What the old shape would have said:
    expect(diffState({ "story.gold": 0 }, { "story.gold": 0 })).toEqual([]);
  });

  it("takes the mount prefix from the bag, and lets a product override it", () => {
    const lines: string[] = [];
    const bag = bagOf("@scene.");
    // Patterplay's case: addressed `@scene.gold` relative to the current scene,
    // logged `@scene:kitchen.gold` because a log spans scenes.
    const log = createStateLogger(
      { mounts: () => [{ bag, pathPrefix: "@scene:kitchen." }] }, { sink: (l) => lines.push(l) });
    bag.set("gold", 1);
    expect(lines).toEqual(["@scene:kitchen.gold: 0 -> 1"]);
    expect(Object.keys(log.snapshot())).toContain("@scene:kitchen.gold");
  });

  it("diffs what has no audit hook, and re-baselines it", () => {
    const lines: string[] = [];
    const bag = bagOf("story.");
    let turn = 0;
    const log = createStateLogger(
      { mounts: () => [{ bag }], extra: () => ({ "turn:village": turn }) }, { sink: (l) => lines.push(l) });

    turn = 3;
    expect(log.capture()).toEqual([{ path: "turn:village", from: 0, to: 3 }]);
    expect(lines).toEqual(["turn:village: 0 -> 3"]);
    expect(log.capture()).toEqual([]);
  });

  it("re-mounts when a load replaces the bags", () => {
    const lines: string[] = [];
    let bag = bagOf("story.");
    const log = createStateLogger({ mounts: () => [{ bag }] }, { sink: (l) => lines.push(l) });

    // A load hands back a different bag object carrying different values, and fires
    // no audit event: the diff catches the values, the re-mount catches the bag.
    const loaded = bagOf("story.");
    loaded.load({ gold: 7 });
    bag = loaded;
    expect(log.capture()).toEqual([{ path: "story.gold", from: 0, to: 7 }]);

    bag.set("gold", 8);
    expect(lines).toContain("story.gold: 7 -> 8");   // the NEW bag is hooked
  });

  it("reports an unset value as <unset>, both ways", () => {
    const lines: string[] = [];
    let extra: Record<string, never | number> = {};
    const bag = bagOf("story.");
    const log = createStateLogger({ mounts: () => [{ bag }], extra: () => extra }, { sink: (l) => lines.push(l) });
    extra = { "cooldown:card": 4 };
    log.capture();
    extra = {};
    log.capture();
    expect(lines).toEqual(["cooldown:card: <unset> -> 4", "cooldown:card: 4 -> <unset>"]);
  });

  it("stops logging after dispose", () => {
    const lines: string[] = [];
    const bag = bagOf("story.");
    const log = createStateLogger({ mounts: () => [{ bag }] }, { sink: (l) => lines.push(l) });
    log.dispose();
    bag.set("gold", 5);
    expect(lines).toEqual([]);
  });

  it("copies values out, so a logged flags array is not the bag's own", () => {
    const lines: string[] = [];
    const bag = bagOf("story.");
    const log = createStateLogger({ mounts: () => [{ bag }] }, { sink: (l) => lines.push(l) });
    bag.set("marks", ["a"]);
    const changes = log.capture();
    (bag.get("marks") as string[]).push("b");
    expect(changes[0]!.to).toEqual(["a"]);   // the record is not a live handle
  });
});
