// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// `stringArgChoices`: a host-supplied list for a function's string argument (ruled 2026-10-28).
// `count_played("gate")` takes a card's Game ID, and the editor offered only a free-text field for
// it, so an author had to know and type the ID exactly. With choices supplied the argument is a
// searchable picker showing each choice's label and writing its value; without them, nothing changes.
// ---------------------------------------------------------------------------

import { describe, it, expect, afterEach } from "vitest";
import type { Dialect, ExpressionSchema } from "@wildwinter/expr";
import { mountExpressionEditor } from "../src/mount.js";
import { renderConditionPreview } from "../src/preview.js";
import type { StringArgChoice, StringArgChoices } from "../src/types.js";

const numFn = { minArgs: 1, maxArgs: 1, returnType: "number" as const, eval: () => 0 };
const dialect: Dialect = {
  scopes: [{ token: "story" }],
  defaultScope: "story",
  functions: { count_played: numFn, turns_since_played: numFn, turns_since_tag: numFn },
};
const schema = { properties: new Map() } as ExpressionSchema;
const cards: StringArgChoice[] = [
  { value: "gate", label: "The Gate" },
  { value: "well", label: "The Well" },
  { value: "mill" },
];

afterEach(() => { document.body.replaceChildren(); });

const buttons = (root: ParentNode): HTMLButtonElement[] => [...root.querySelectorAll("button")];
const pop = (): HTMLElement => [...document.querySelectorAll<HTMLElement>(".exed-pop")].at(-1)!;

function mount(value: string, choices?: StringArgChoices): { host: HTMLElement; out: () => string } {
  let last = value;
  const host = document.createElement("div");
  document.body.append(host);
  mountExpressionEditor(host, {
    value, schema, dialect, catalogue: [], mode: "flat",
    ...(choices ? { stringArgChoices: choices } : {}),
    onChange: (s) => { last = s; },
  });
  return { host, out: () => last };
}

describe("stringArgChoices: a picker for count_played's card", () => {
  it("shows the chosen card's label on the pill, with its ID as the tip", () => {
    const { host } = mount('count_played("gate") > 0', { count_played: cards });
    const p = buttons(host).find((b) => b.textContent === "The Gate");
    expect(p).toBeTruthy();
    expect(p!.title).toBe("gate");
  });

  it("an empty argument invites a pick, and the picker lists the labels", () => {
    const { host } = mount('count_played("") > 0', { count_played: cards });
    const slot = buttons(host).find((b) => b.textContent === "pick one…")!;
    expect(slot).toBeTruthy();
    slot.click();
    const names = [...pop().querySelectorAll(".exed-opt-name")].map((n) => n.textContent);
    expect(names).toEqual(["The Gate", "The Well", "mill"]);
  });

  // The literal is the string "gate"; unparse writes a safe identifier bare, as it does for every
  // tag and enum value, and the parser reads it back as the same string.
  it("writes the choice's value as the string literal: count_played(\"gate\")", () => {
    const { host, out } = mount('count_played("") > 0', { count_played: cards });
    buttons(host).find((b) => b.textContent === "pick one…")!.click();
    buttons(pop()).find((b) => b.querySelector(".exed-opt-name")?.textContent === "The Gate")!.click();
    expect(out()).toBe("count_played(gate) > 0");
  });

  it("re-picks when the call is the whole value", () => {
    const { host, out } = mount('count_played("well")', { count_played: cards });
    buttons(host).find((b) => b.textContent === "The Well")!.click();
    buttons(pop()).find((b) => b.querySelector(".exed-opt-name")?.textContent === "The Gate")!.click();
    expect(out()).toBe("count_played(gate)");
  });

  it("searches labels and values", () => {
    const { host } = mount('count_played("")', { count_played: cards });
    buttons(host).find((b) => b.textContent === "pick one…")!.click();
    const search = pop().querySelector<HTMLInputElement>("input")!;
    const shown = (): (string | null)[] => [...pop().querySelectorAll(".exed-opt-name")].map((n) => n.textContent);
    search.value = "well"; search.dispatchEvent(new Event("input"));
    expect(shown()).toEqual(["The Well"]);
    search.value = "MIL"; search.dispatchEvent(new Event("input"));
    expect(shown()).toEqual(["mill"]);
    search.value = "nothing"; search.dispatchEvent(new Event("input"));
    expect(pop().textContent).toContain("No matches.");
  });

  it("marks the current choice, and a value the list lacks still shows as itself", () => {
    const { host } = mount('count_played("gone")', { count_played: cards });
    const p = buttons(host).find((b) => b.textContent === "gone")!;
    expect(p).toBeTruthy();
    p.click();
    expect(pop().querySelector(".exed-opt.sel")).toBeNull();
  });

  it("a list given with its own placeholder says that on the empty slot, and picks the same", () => {
    const { host, out } = mount('count_played("") > 0', { count_played: { choices: cards, placeholder: "pick a card…" } });
    const slot = buttons(host).find((b) => b.textContent === "pick a card…")!;
    expect(slot).toBeTruthy();
    slot.click();
    buttons(pop()).find((b) => b.querySelector(".exed-opt-name")?.textContent === "The Well")!.click();
    expect(out()).toBe("count_played(well) > 0");
  });

  it("serves turns_since_played the same way when the host lists it", () => {
    const { host, out } = mount('turns_since_played("") > 3', { turns_since_played: cards });
    buttons(host).find((b) => b.textContent === "pick one…")!.click();
    buttons(pop()).find((b) => b.querySelector(".exed-opt-name")?.textContent === "The Well")!.click();
    expect(out()).toBe("turns_since_played(well) > 3");
  });

  it("a function the option does not name keeps its free-text field", () => {
    const { host } = mount('turns_since_tag("") > 3', { count_played: cards });
    const slot = buttons(host).find((b) => b.textContent === "set a tag…")!;
    expect(slot).toBeTruthy();
    slot.click();
    expect(pop().querySelector(".exed-field-cap")?.textContent).toBe("Text value");
  });

  it("the read-only preview shows the label too", () => {
    const host = renderConditionPreview('count_played("gate") > 0', {
      schema, dialect, catalogue: [], stringArgChoices: { count_played: cards },
    });
    expect(host.textContent).toContain("The Gate");
  });
});

describe("without stringArgChoices, nothing changes", () => {
  it("count_played's argument is the free-text tag field", () => {
    const { host } = mount('count_played("")');
    const slot = buttons(host).find((b) => b.textContent === "set a tag…")!;
    expect(slot).toBeTruthy();
    slot.click();
    expect(pop().querySelector(".exed-field-cap")?.textContent).toBe("Text value");
  });

  it("a filled argument shows its raw value", () => {
    const { host } = mount('count_played("gate")');
    expect(buttons(host).some((b) => b.textContent === "gate")).toBe(true);
  });
});
