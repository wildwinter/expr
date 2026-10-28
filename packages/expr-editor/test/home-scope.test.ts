// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// `homeScope` (ruled 2026-10-28): Patterpad showed an effect built in the effects editor as
// `@patter.gold = gold + 1`, the target in full and the value bare. With the host's own scope named,
// every pill reads the way an author writes a reference: `@gold` in that scope, `@world.time` in full
// elsewhere, on the target and in values alike. Display only: the written source is unchanged.
// Without the option (Storyletter), nothing changes.
// ---------------------------------------------------------------------------

import { describe, it, expect, afterEach } from "vitest";
import type { Dialect, ExpressionSchema } from "@wildwinter/expr";
import { mountEffectsEditor, type EditorEffect } from "../src/effects.js";
import { mountExpressionEditor } from "../src/mount.js";
import { renderConditionPreview, renderEffectsPreview } from "../src/preview.js";
import { pillLabel, targetLabel, type CatalogueEntry } from "../src/schema.js";

const dialect: Dialect = {
  scopes: [{ token: "patter" }, { token: "world" }],
  defaultScope: "patter",
  functions: {},
};
const schema: ExpressionSchema = {
  properties: new Map([
    ["patter", new Map([["gold", { type: "number" as const }]])],
    ["world", new Map([["time", { type: "number" as const }]])],
  ]),
};
const catalogue: CatalogueEntry[] = [
  { scope: "patter", name: "gold", type: "number", purpose: "coins carried" },
  { scope: "world", name: "time", type: "number" },
];
const effects: EditorEffect[] = [
  { kind: "set", target: "@patter.gold", value: "@gold + @world.time" },
  { kind: "set", target: "@world.time", value: "@world.time + 1" },
];

afterEach(() => { document.body.replaceChildren(); });

/** Each row's property pills, target first. */
const rowPills = (root: ParentNode, rowSel: string): string[][] =>
  [...root.querySelectorAll(rowSel)].map((row) =>
    [...row.querySelectorAll(".exed-pill-prop, .exed-pill-var")].map((p) => p.textContent ?? ""));

describe("labels", () => {
  it("pillLabel: unchanged without homeScope, @-led with it", () => {
    expect(pillLabel({ scope: "patter", name: "gold" }, "patter")).toBe("gold");
    expect(pillLabel({ scope: "world", name: "time" }, "patter")).toBe("world.time");
    expect(pillLabel({ scope: "patter", name: "gold" }, "patter", "patter")).toBe("@gold");
    expect(pillLabel({ scope: "world", name: "time" }, "patter", "patter")).toBe("@world.time");
  });

  it("targetLabel: as written without homeScope; either spelling of a home ref reads @name with it", () => {
    expect(targetLabel("@patter.gold", "patter")).toBe("@patter.gold");
    expect(targetLabel("@patter.gold", "patter", "patter")).toBe("@gold");
    expect(targetLabel("@gold", "patter", "patter")).toBe("@gold");
    expect(targetLabel("@world.time", "patter", "patter")).toBe("@world.time");
    expect(targetLabel("not a ref", "patter", "patter")).toBe("not a ref");
  });
});

describe("the effects editor", () => {
  function mount(homeScope?: string): { host: HTMLElement; changes: EditorEffect[][] } {
    const changes: EditorEffect[][] = [];
    const host = document.createElement("div");
    document.body.append(host);
    mountEffectsEditor(host, {
      effects, schema, dialect, catalogue, onChange: (e) => changes.push(e),
      ...(homeScope ? { homeScope } : {}),
    });
    return { host, changes };
  }

  it("shows @gold on the target and in values alike", () => {
    const { host } = mount("patter");
    expect(rowPills(host, ".exed-effect-set")).toEqual([
      ["@gold", "@gold", "@world.time"],
      ["@world.time", "@world.time"],
    ]);
  });

  it("is unchanged without homeScope", () => {
    const { host } = mount();
    expect(rowPills(host, ".exed-effect-set")).toEqual([
      ["@patter.gold", "gold", "world.time"],
      ["@world.time", "world.time"],
    ]);
  });

  it("writes the same source either way", () => {
    // Re-pick the first row's target: the written target is in full, whatever the display.
    for (const home of [undefined, "patter"]) {
      const { host, changes } = mount(home);
      (host.querySelector(".exed-effect-set .exed-pill-prop") as HTMLButtonElement).click();
      const pop = document.querySelector(".exed-pop")!;
      [...pop.querySelectorAll("button")].find((b) => b.querySelector(".exed-opt-name")?.textContent === "gold")!.click();
      expect(changes.at(-1)![0]).toEqual({ kind: "set", target: "@patter.gold", value: "0" });
      document.body.replaceChildren();
    }
  });

  it("keeps the target's tip", () => {
    const { host } = mount("patter");
    expect((host.querySelector(".exed-effect-set .exed-pill-prop") as HTMLElement).title).toBe("coins carried");
  });
});

describe("the expression editor", () => {
  it("shows @gold in a condition, and writes what it was given", () => {
    const got: string[] = [];
    const host = document.createElement("div");
    document.body.append(host);
    mountExpressionEditor(host, {
      value: "@gold > 0 and @world.time < 5", schema, dialect, catalogue, homeScope: "patter",
      onChange: (s) => got.push(s),
    });
    expect([...host.querySelectorAll(".exed-pill-var")].map((p) => p.textContent)).toEqual(["@gold", "@world.time"]);
    expect(got).toEqual([]);
  });
});

describe("the previews", () => {
  const o = { schema, dialect, catalogue };

  it("show @gold on the target and in values with homeScope", () => {
    const wrap = renderEffectsPreview(effects, { ...o, homeScope: "patter" });
    expect(rowPills(wrap, ".exed-preview-eff")).toEqual([
      ["@gold", "@gold", "@world.time"],
      ["@world.time", "@world.time"],
    ]);
    const cond = renderConditionPreview("@gold > 1", { ...o, homeScope: "patter" });
    expect(cond.querySelector(".exed-pill-var")?.textContent).toBe("@gold");
  });

  it("are unchanged without it", () => {
    const wrap = renderEffectsPreview(effects, o);
    expect(rowPills(wrap, ".exed-preview-eff")).toEqual([
      ["@patter.gold", "gold", "world.time"],
      ["@world.time", "world.time"],
    ]);
  });

  it("find a full-form target's declaration, so its pill has the tip", () => {
    // Targets are written `@patter.gold`; the preview used to match on the `@gold` shorthand only.
    const wrap = renderEffectsPreview(effects, o);
    expect((wrap.querySelector(".exed-preview-eff .exed-pill-prop") as HTMLElement).title).toBe("coins carried");
  });
});
