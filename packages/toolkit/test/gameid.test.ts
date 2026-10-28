// The Game ID rule both families had a copy of (Patter's model and Storylets' model, the same code
// character for character as of 2026-10-28). These pin its exact behaviour, oddities included: a
// family that adopts this one must see no address change.

import { describe, expect, it } from "vitest";
import { gameIdify, isValidGameId } from "../src/index.js";

describe("gameIdify", () => {
  const cases: [string, string][] = [
    ["Act 1: The Gate", "act-1-the-gate"],
    ["Scene 12b", "scene-12b"],
    ["The  Long--Dark", "the-long-dark"],          // runs of punctuation and hyphens collapse
    ["  -Lead- ", "lead"],                          // no hyphen at either end
    ["snake_case_name", "snake-case-name"],         // underscores are not kept
    ["V.O.", "v-o"],                                // why Patter pins its standard qualifiers' ids
    ["Torin's Offer!", "torins-offer"],             // a straight apostrophe is dropped, not hyphened
    ["Torin’s Offer", "torins-offer"],         // so is a curly one (right single quote)
    ["Torin‘s Offer", "torin-s-offer"],        // but a left single quote is punctuation
    ["rock'n'roll", "rocknroll"],
    ["a`b", "a-b"],
    ["Café Noir", "caf-noir"],                 // letters outside a-z are not transliterated
    ["ÉCOLE", "cole"],
    ["naïve", "na-ve"],
    ["Straße", "stra-e"],
    ["İstanbul", "i-stanbul"],                 // lower-casing makes i plus a combining dot
    ["日本語", ""],                     // nothing usable left: empty, no fallback
    ["!!!", ""],
    ["---", ""],
    ["", ""],
  ];
  for (const [name, id] of cases) it(`${JSON.stringify(name)} -> ${JSON.stringify(id)}`, () => expect(gameIdify(name)).toBe(id));

  it("gives a valid Game ID, or empty", () => {
    for (const [name] of cases) {
      const id = gameIdify(name);
      expect(id === "" || isValidGameId(id)).toBe(true);
    }
  });
  it("leaves a valid Game ID as it is", () => {
    for (const id of ["a", "scene-1", "the-long-dark", "9lives"]) expect(gameIdify(id)).toBe(id);
  });
});

describe("isValidGameId", () => {
  it("takes lower-case letters, digits and inner hyphens", () => {
    for (const id of ["a", "9", "scene-1", "a-b-c", "a--b"]) expect(isValidGameId(id)).toBe(true);
  });
  it("refuses anything else", () => {
    for (const id of ["", "-a", "a-", "-", "A", "a_b", "a b", "a.b", "café"]) expect(isValidGameId(id)).toBe(false);
  });
});
