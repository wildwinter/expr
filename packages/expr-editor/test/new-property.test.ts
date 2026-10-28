// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// The effects editor's "+ set property" picker creates a property (ruled 2026-10-28). Typing a name
// no property has offers `+ New property "<name>"`, with the scope it goes in; the host creates the
// declaration through `onCreateProperty` and the new property goes straight on to its value, as a
// listed one does. No callback, no offer.
// ---------------------------------------------------------------------------

import { describe, it, expect, afterEach } from "vitest";
import type { Dialect, ExpressionSchema } from "@wildwinter/expr";
import { mountEffectsEditor, type EditorEffect, type EffectsEditorOptions } from "../src/effects.js";
import { newPropertyName, schemaWith, type CatalogueEntry } from "../src/schema.js";

const dialect: Dialect = {
  scopes: [{ token: "patter" }, { token: "world" }, { token: "story" }],
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
  { scope: "patter", name: "gold", type: "number" },
  { scope: "world", name: "time", type: "number" },
];

afterEach(() => { document.body.replaceChildren(); });

const buttons = (root: ParentNode): HTMLButtonElement[] => [...root.querySelectorAll("button")];
const buttonByText = (root: ParentNode, text: string): HTMLButtonElement => {
  const b = buttons(root).find((x) => x.textContent?.trim() === text);
  if (!b) throw new Error(`no button "${text}" in: ${buttons(root).map((x) => x.textContent).join(" | ")}`);
  return b;
};
const fieldUnder = (root: ParentNode, caption: string): HTMLElement => {
  const cap = [...root.querySelectorAll(".exed-field-cap")].find((c) => c.textContent === caption);
  if (!cap) throw new Error(`no field captioned "${caption}"`);
  return cap.parentElement as HTMLElement;
};
const type = (input: HTMLInputElement, v: string): void => {
  input.value = v;
  input.dispatchEvent(new Event("input"));
};

function mount(over: Partial<EffectsEditorOptions> = {}): { host: HTMLElement; changes: EditorEffect[][]; asked: Array<[string, string]> } {
  const changes: EditorEffect[][] = [];
  const asked: Array<[string, string]> = [];
  const host = document.createElement("div");
  document.body.append(host);
  mountEffectsEditor(host, {
    effects: [], schema, dialect, catalogue, onChange: (e) => changes.push(e),
    onCreateProperty: (name, scope) => { asked.push([name, scope]); return { scope, name, type: "number" }; },
    ...over,
  });
  return { host, changes, asked };
}

/** Open "+ set property" and type into its search; returns the picker. */
function search(host: HTMLElement, text: string): HTMLElement {
  buttonByText(host, "+ set property").click();
  const pop = document.querySelector<HTMLElement>(".exed-pop")!;
  type(pop.querySelector("input")!, text);
  return pop;
}
const createRows = (pop: ParentNode): string[] =>
  [...pop.querySelectorAll(".exed-opt-create")].map((r) => r.textContent ?? "");

describe("newPropertyName: what the search text says about a new property", () => {
  it("takes a legal name, folding case and dropping an @", () => {
    expect(newPropertyName("xp", ["patter"])).toEqual({ name: "xp", scopes: ["patter"] });
    expect(newPropertyName("@Torch_Lit2", ["patter"])).toEqual({ name: "torch_lit2", scopes: ["patter"] });
    expect(newPropertyName("  ", ["patter"])).toBeNull();
  });

  it("offers each allowed scope, or the one named", () => {
    expect(newPropertyName("xp", ["patter", "world"])).toEqual({ name: "xp", scopes: ["patter", "world"] });
    expect(newPropertyName("@world.xp", ["patter", "world"])).toEqual({ name: "xp", scopes: ["world"] });
  });

  it("says why a name can't be one", () => {
    expect(newPropertyName("Torin's offer", ["patter"])).toEqual({ why: "A property name takes only letters, digits, and _." });
    expect(newPropertyName("2nd", ["patter"])).toEqual({ why: "A property name can't start with a digit." });
    expect(newPropertyName("and", ["patter"])).toEqual({ why: "\"and\" is a reserved word, so it can't be a property name." });
    expect(newPropertyName("story.xp", ["patter"])).toEqual({ why: "A new property can go in patter, not story." });
    expect(newPropertyName("story.xp", ["patter", "world", "scene"])).toEqual({ why: "A new property can go in patter, world, or scene, not story." });
  });
});

describe("schemaWith", () => {
  it("adds the entry to a copy, leaving the host's schema alone", () => {
    const next = schemaWith(schema, { scope: "patter", name: "xp", type: "number" });
    expect(next.properties.get("patter")?.get("xp")).toEqual({ type: "number" });
    expect(schema.properties.get("patter")?.has("xp")).toBe(false);
  });

  it("leaves a scope the schema doesn't list unchecked", () => {
    expect(schemaWith(schema, { scope: "story", name: "xp", type: "number" })).toBe(schema);
  });
});

describe("the + set property picker", () => {
  it("offers a new property, in the scope it goes in, for a name no property has", () => {
    const { host } = mount();
    const pop = search(host, "xp");
    expect(createRows(pop)).toEqual(['+ New property "xp"in patter']);
    expect(pop.textContent).not.toContain("No matching properties.");
  });

  it("offers nothing without onCreateProperty (unchanged)", () => {
    const { host } = mount({ onCreateProperty: undefined });
    const pop = search(host, "xp");
    expect(createRows(pop)).toEqual([]);
    expect(pop.textContent).toContain("No matching properties.");
    expect(pop.querySelector("input")!.placeholder).toBe("Search properties…");
  });

  it("doesn't offer a name the scope already has", () => {
    const { host } = mount();
    const pop = search(host, "@gold");
    expect(createRows(pop)).toEqual([]);
    // `@gold` searches as `gold`, so the existing property is listed instead.
    expect(buttons(pop).some((b) => b.querySelector(".exed-opt-name")?.textContent === "gold")).toBe(true);
  });

  it("offers a name another scope has, in the scopes that lack it", () => {
    const { host } = mount({ newPropertyScopes: ["patter", "world"] });
    const pop = search(host, "time");
    expect(createRows(pop)).toEqual(['+ New property "time"in patter']);
  });

  it("offers one row per allowed scope, and never another engine's", () => {
    const { host } = mount({ newPropertyScopes: ["patter", "world", "story"], otherEngineScopes: ["story"] });
    const pop = search(host, "xp");
    expect(createRows(pop)).toEqual(['+ New property "xp"in patter', '+ New property "xp"in world']);
  });

  it("says why when the text can't be a name and nothing matched", () => {
    const { host } = mount();
    const pop = search(host, "Torin's offer");
    expect(createRows(pop)).toEqual([]);
    expect(pop.querySelector(".exed-create-why")?.textContent).toBe("A property name takes only letters, digits, and _.");
  });

  it("stays quiet about names while the text is a search that matched", () => {
    const { host } = mount({ catalogue: [...catalogue, { scope: "patter", name: "debt", type: "number", purpose: "money owed" }] });
    const pop = search(host, "money owed");
    expect(pop.querySelector(".exed-create-why")).toBeNull();
  });

  it("creates through the host and goes straight on to the value, as a listed property does", () => {
    const { host, changes, asked } = mount();
    const pop = search(host, "XP");
    buttons(pop).find((b) => b.classList.contains("exed-opt-create"))!.click();
    expect(asked).toEqual([["xp", "patter"]]);
    // The picker has gone and the number's value wizard is open, Change by and all.
    const wiz = document.querySelector(".exed-vwiz")!;
    expect(wiz).toBeTruthy();
    const by = fieldUnder(wiz, "by");
    type(by.querySelector("input")!, "1");
    buttonByText(by, "Apply").click();
    // The target is written in full, the value in the dialect's own shorthand, as for any property.
    expect(changes.at(-1)).toEqual([{ kind: "set", target: "@patter.xp", value: "@xp + 1" }]);
    // The new property is known to the row at once: its value pill is not an unknown property.
    const ring = host.querySelector(".exed-effect-value .exed-pill-err");
    expect(ring).toBeNull();
  });

  it("waits for a host that asks (a promise), and does nothing when it cancels", async () => {
    let resolve!: (e: CatalogueEntry | null) => void;
    const { host, changes } = mount({ onCreateProperty: () => new Promise((r) => { resolve = r; }) });
    const pop = search(host, "xp");
    const row = buttons(pop).find((b) => b.classList.contains("exed-opt-create"))!;
    row.click();
    expect(row.disabled).toBe(true);
    resolve(null);
    await Promise.resolve(); await Promise.resolve();
    expect(row.disabled).toBe(false);
    expect(document.querySelector(".exed-vwiz")).toBeNull();
    expect(changes).toEqual([]);
  });

  it("uses the declaration the host returns, its type included", async () => {
    const { host, changes } = mount({
      onCreateProperty: async (name, scope) => ({ scope, name, type: "boolean" }),
    });
    const pop = search(host, "lamp_lit");
    buttons(pop).find((b) => b.classList.contains("exed-opt-create"))!.click();
    await Promise.resolve(); await Promise.resolve();
    const wiz = document.querySelector(".exed-vwiz")!;
    expect(wiz.textContent).toContain("true");
    buttonByText(wiz, "true").click();
    expect(changes.at(-1)).toEqual([{ kind: "set", target: "@patter.lamp_lit", value: "true" }]);
  });

  it("says so when the host fails", async () => {
    const { host } = mount({ onCreateProperty: async () => { throw new Error("the file is read-only"); } });
    const pop = search(host, "xp");
    buttons(pop).find((b) => b.classList.contains("exed-opt-create"))!.click();
    await Promise.resolve(); await Promise.resolve();
    expect(pop.querySelector(".exed-create-why")?.textContent).toBe("Couldn't create the property: the file is read-only");
  });
});
