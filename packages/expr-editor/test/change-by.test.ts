// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// "Change by" in the value wizard (ruled 2026-10-28). Adding 1 to a number property used to take
// eight steps: the number step took only a literal, so an author typing `@story.reputation + 1`
// met a greyed Apply and no word of why, and the way through was "a different kind", the property
// again, "+ term", the number, Apply. With the target's ref known, the number step now leads with
// a toggle (add / take away), a "by" field and Apply, and writes what that long route writes.
// ---------------------------------------------------------------------------

import { describe, it, expect, afterEach } from "vitest";
import type { Dialect, ExpressionSchema } from "@wildwinter/expr";
import { valueWizard } from "../src/valuewizard.js";
import { mountEffectsEditor, type EditorEffect } from "../src/effects.js";
import { mountExpressionEditor } from "../src/mount.js";
import type { CatalogueEntry } from "../src/schema.js";

const fn = { minArgs: 0, returnType: "number" as const, eval: () => 0 };
/** Two dialects: one where `story` is another scope, one where it is the default. */
const dialectFor = (defaultScope: string): Dialect => ({
  scopes: [{ token: "world" }, { token: "story" }],
  defaultScope,
  functions: { count_played: { ...fn, minArgs: 1, maxArgs: 1 } },
});
const schema: ExpressionSchema = {
  properties: new Map([
    ["story", new Map([["reputation", { type: "number" }], ["name", { type: "string" }]])],
  ]),
} as ExpressionSchema;
const reputation: CatalogueEntry = { scope: "story", name: "reputation", type: "number" };
const catalogue: CatalogueEntry[] = [reputation, { scope: "story", name: "name", type: "string" }];

afterEach(() => { document.body.replaceChildren(); });

const buttons = (root: ParentNode): HTMLButtonElement[] => [...root.querySelectorAll("button")];
const buttonByText = (root: ParentNode, text: string): HTMLButtonElement => {
  const b = buttons(root).find((x) => x.textContent?.trim() === text);
  if (!b) throw new Error(`no button "${text}" in: ${buttons(root).map((x) => x.textContent).join(" | ")}`);
  return b;
};
const type = (input: HTMLInputElement, v: string): void => {
  input.value = v;
  input.dispatchEvent(new Event("input"));
};
/** The text field under a caption ("by", "Set it to"). */
const fieldUnder = (root: ParentNode, caption: string): HTMLElement => {
  const cap = [...root.querySelectorAll(".exed-field-cap")].find((c) => c.textContent === caption);
  if (!cap) throw new Error(`no field captioned "${caption}"`);
  return cap.parentElement as HTMLElement;
};

function wizard(over: Partial<Parameters<typeof valueWizard>[0]> = {}): { host: HTMLElement; got: string[] } {
  const got: string[] = [];
  const host = valueWizard({
    catalogue, scopeOrder: [], defaultScope: "world",
    expectedType: "number", expectedRef: "@story.reputation",
    onCommit: (s) => got.push(s),
    ...over,
  });
  document.body.append(host);
  return { host, got };
}

describe("the number step leads with Change by when the target's ref is known", () => {
  it("adds: `@story.reputation + 1`", () => {
    const { host, got } = wizard();
    const by = fieldUnder(host, "by");
    type(by.querySelector("input")!, "1");
    buttonByText(by, "Apply").click();
    expect(got).toEqual(["@story.reputation + 1"]);
  });

  it("takes away: `@story.reputation - 2`, with the sign toggle shaped like the flags step's", () => {
    const { host, got } = wizard();
    const add = buttonByText(host, "＋ add");
    const take = buttonByText(host, "－ take away");
    expect(add.className).toBe("exed-opt sel");
    take.click();
    expect(take.className).toBe("exed-opt sel");
    expect(add.className).toBe("exed-opt");
    const by = fieldUnder(host, "by");
    type(by.querySelector("input")!, "2");
    buttonByText(by, "Apply").click();
    expect(got).toEqual(["@story.reputation - 2"]);
  });

  it("keeps what was typed in `by` when the sign is switched", () => {
    const { host, got } = wizard();
    const input = fieldUnder(host, "by").querySelector("input")!;
    type(input, "3");
    buttonByText(host, "－ take away").click();
    expect(fieldUnder(host, "by").querySelector("input")!.value).toBe("3");
    buttonByText(fieldUnder(host, "by"), "Apply").click();
    expect(got).toEqual(["@story.reputation - 3"]);
  });

  it("a negative amount reads as the other sign, not `+ -2`", () => {
    const { host, got } = wizard();
    const by = fieldUnder(host, "by");
    type(by.querySelector("input")!, "-2");
    buttonByText(by, "Apply").click();
    expect(got).toEqual(["@story.reputation - 2"]);
  });

  it("Enter in `by` applies when valid, and does nothing when not", () => {
    const { host, got } = wizard();
    const input = fieldUnder(host, "by").querySelector("input")!;
    type(input, "x");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(got).toEqual([]);
    type(input, "4");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(got).toEqual(["@story.reputation + 4"]);
  });

  it("writes the default scope's shorthand, as the property picker and `+ term` do", () => {
    const { host, got } = wizard({ defaultScope: "story" });
    const by = fieldUnder(host, "by");
    type(by.querySelector("input")!, "1");
    buttonByText(by, "Apply").click();
    expect(got).toEqual(["@reputation + 1"]);
  });

  it("comes first, above `Set it to`, and keeps `a different kind`", () => {
    const { host } = wizard();
    const caps = [...host.querySelectorAll(".exed-field-cap")].map((c) => c.textContent);
    expect(caps).toEqual(["by", "Set it to"]);
    expect(host.textContent).toContain("Change by");
    expect(buttonByText(host, "↩ a different kind")).toBeTruthy();
  });
});

describe("Set it to: the literal field, unchanged in behaviour", () => {
  it("still writes a literal", () => {
    const { host, got } = wizard();
    const set = fieldUnder(host, "Set it to");
    type(set.querySelector("input")!, "5");
    buttonByText(set, "Apply").click();
    expect(got).toEqual(["5"]);
  });

  it("says why it will not take an expression, pointing at Change by", () => {
    const { host } = wizard();
    const set = fieldUnder(host, "Set it to");
    expect(set.textContent).not.toContain("Not a number");
    type(set.querySelector("input")!, "@story.reputation + 1");
    expect(buttonByText(set, "Apply").disabled).toBe(true);
    expect(set.textContent).toContain("Not a number. To add to it, use Change by above.");
    type(set.querySelector("input")!, "7");
    expect(set.textContent).not.toContain("Not a number");
  });

  it("without Change by, says only that it is not a number", () => {
    const { host } = wizard({ expectedRef: undefined });
    const set = fieldUnder(host, "Set it to");
    type(set.querySelector("input")!, "abc");
    expect(set.textContent).toContain("Not a number.");
    expect(set.textContent).not.toContain("Change by");
  });
});

describe("Change by is offered only where it means something", () => {
  it("absent without the target's ref", () => {
    const { host } = wizard({ expectedRef: undefined });
    expect(host.textContent).not.toContain("Change by");
    expect(host.textContent).not.toContain("take away");
  });

  it("absent for a non-number target, even reached through `A number`", () => {
    const { host } = wizard({ expectedType: "string", expectedRef: "@story.name" });
    buttonByText(host, "↩ a different kind").click();
    buttonByText(host, "A number").click();
    expect(host.textContent).not.toContain("Change by");
    expect(fieldUnder(host, "Set it to")).toBeTruthy();
  });
});

describe("in the effects editor: + set property on a number", () => {
  function addReputation(defaultScope: string): { effects: EditorEffect[][] } {
    const changes: EditorEffect[][] = [];
    const host = document.createElement("div");
    document.body.append(host);
    mountEffectsEditor(host, {
      effects: [], schema, dialect: dialectFor(defaultScope), catalogue, onChange: (e) => changes.push(e),
    });
    buttonByText(host, "+ set property").click();
    const pop = document.querySelector(".exed-pop")!;
    const row = buttons(pop).find((b) => b.querySelector(".exed-opt-name")?.textContent === (defaultScope === "story" ? "reputation" : "story.reputation"))!;
    row.click();
    const wiz = document.querySelector(".exed-vwiz")!;
    const by = fieldUnder(wiz, "by");
    type(by.querySelector("input")!, "1");
    buttonByText(by, "Apply").click();
    return { effects: changes };
  }

  it("is reached in three steps and writes the property plus a term", () => {
    const { effects } = addReputation("world");
    expect(effects.at(-1)).toEqual([{ kind: "set", target: "@story.reputation", value: "@story.reputation + 1" }]);
  });

  it("reads back as the property plus a term, the same as the eight-step route", () => {
    // The long route: the value `@story.reputation`, then "+ term" with 1.
    let longRoute = "";
    const inline = document.createElement("div");
    document.body.append(inline);
    mountExpressionEditor(inline, {
      value: "@reputation", schema, dialect: dialectFor("story"), catalogue, mode: "flat", valueField: true,
      addTerm: "arithmetic", onChange: (s) => { longRoute = s; },
    });
    buttonByText(inline, "+ term").click();
    const termPop = [...document.querySelectorAll(".exed-pop")].at(-1)!;
    const termBy = fieldUnder(termPop, "by");
    type(termBy.querySelector("input")!, "1");
    buttonByText(termBy, "Apply").click();
    inline.remove();
    document.querySelectorAll(".exed-pop").forEach((p) => p.remove());

    const { effects } = addReputation("story");
    const value = (effects.at(-1)![0] as { value: string }).value;
    expect(value).toBe(longRoute);
    expect(value).toBe("@reputation + 1");

    // And the row renders it as a property pill, an operator, and a number pill.
    const row = document.querySelector(".exed-effect-set .exed-effect-value")!;
    const pills = [...row.querySelectorAll(".exed-pill")].map((p) => [p.className.match(/exed-pill-(\w+)/)?.[1], p.textContent]);
    expect(pills).toEqual([["var", "reputation"], ["op", "+"], ["number", "1"]]);
  });
});
