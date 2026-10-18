// ---------------------------------------------------------------------------
// The editors' helpers over a quality: a stage literal renamed inside an
// expression, the gates a reorder changes, the stages either side of a value,
// and whether a value fits its declaration. Both product families' editor
// tests, gathered when the two copies moved here (patterkit design/proposals/
// patter-qualities.md section 2; the qualities brief of 2026-10-18).
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { renameStageInExpression, stageGateCount, stagesEitherSide, valueFits } from "../src/index.js";
import type { Dialect } from "../src/index.js";

const dialect: Dialect = {
  scopes: [{ token: "story" }, { token: "world" }],
  defaultScope: "story",
  functions: {},
};
const isDebt = (scope: string, name: string): boolean => scope === "story" && name === "debt";
const isAct = (scope: string, name: string): boolean => scope === "story" && name === "act";

describe("renameStageInExpression", () => {
  it("rewrites a literal compared with the quality, in the author's own text", () => {
    expect(renameStageInExpression('@debt >= "confronted" and @gold > 2', dialect, isDebt, "confronted", "faced"))
      .toBe('@debt >= "faced" and @gold > 2');
    expect(renameStageInExpression('"confronted" == @story.debt', dialect, isDebt, "confronted", "faced"))
      .toBe('"faced" == @story.debt');
    expect(renameStageInExpression("@debt == 'confronted'", dialect, isDebt, "confronted", "faced"))
      .toBe("@debt == 'faced'");
  });

  it("finds the quality on either side, and a bare-word literal", () => {
    expect(renameStageInExpression("arrival == @story.act", dialect, isAct, "arrival", "prologue"))
      .toBe("prologue == @story.act");
    expect(renameStageInExpression("@act >= arrival", dialect, isAct, "arrival", "act-0"))
      .toBe('@act >= "act-0"');
  });

  it("never writes a keyword bare, which would read back as the keyword", () => {
    expect(renameStageInExpression("@act == arrival", dialect, isAct, "arrival", "true"))
      .toBe('@act == "true"');
  });

  it("leaves the same word compared with another quality as it was, quoted or bare", () => {
    expect(renameStageInExpression('@debt == "troubled" or @mood == "troubled"', dialect, isDebt, "troubled", "uneasy"))
      .toBe('@debt == "uneasy" or @mood == "troubled"');
    expect(renameStageInExpression("@mood == troubled or @debt == troubled", dialect, isDebt, "troubled", "uneasy"))
      .toBe("@mood == troubled or @debt == uneasy");
    expect(renameStageInExpression('@act == "act-1" or @mood == "act-1"', dialect, isAct, "act-1", "first-act"))
      .toBe('@act == "first-act" or @mood == "act-1"');
  });

  it("leaves a word inside a longer literal alone", () => {
    expect(renameStageInExpression('@debt == troubled and @note == "troubled times"', dialect, isDebt, "troubled", "uneasy"))
      .toBe('@debt == uneasy and @note == "troubled times"');
  });

  it("keeps the author's text when the word also fills a long note, which is no candidate", () => {
    const note = Array.from({ length: 10 }, () => "troubled").join(", ");
    expect(renameStageInExpression(`@debt   ==   'troubled' and @note == '${note}'`, dialect, isDebt, "troubled", "uneasy"))
      .toBe(`@debt   ==   'uneasy' and @note == '${note}'`);
  });

  it("rewrites a whole value assigned to the quality, and nothing that isn't about it", () => {
    expect(renameStageInExpression('"troubled"', dialect, isDebt, "troubled", "uneasy", true)).toBe('"uneasy"');
    expect(renameStageInExpression("troubled", dialect, isDebt, "troubled", "uneasy", true)).toBe("uneasy");
    expect(renameStageInExpression('"troubled"', dialect, isDebt, "troubled", "uneasy", false)).toBeUndefined();
    expect(renameStageInExpression("advance(@story.act)", dialect, isAct, "act-1", "first-act", true)).toBeUndefined();
  });

  it("says nothing changed when nothing did, or the source does not parse", () => {
    expect(renameStageInExpression("@gold > 2", dialect, isDebt, "troubled", "uneasy")).toBeUndefined();
    expect(renameStageInExpression('@mood == "act-1"', dialect, isAct, "act-1", "x")).toBeUndefined();
    expect(renameStageInExpression("@debt >= (", dialect, isDebt, "troubled", "uneasy")).toBeUndefined();
  });
});

describe("stageGateCount", () => {
  it("counts each gate that orders the quality, not those that ask for exactly one stage", () => {
    expect(stageGateCount('@debt >= "confronted"', dialect, isDebt)).toBe(1);
    expect(stageGateCount('@debt > "troubled" and @debt < "resolved"', dialect, isDebt)).toBe(2);
    expect(stageGateCount('not (@debt < "resolved")', dialect, isDebt)).toBe(1);
    expect(stageGateCount('@debt == "resolved"', dialect, isDebt)).toBe(0);
    expect(stageGateCount('@mood >= "calm"', dialect, isDebt)).toBe(0);
    expect(stageGateCount("@debt >= (", dialect, isDebt)).toBe(0);
  });
});

describe("stagesEitherSide", () => {
  const ladder = ["troubled", "confronted", "resolved", "settled"];

  it("is the stage with its neighbours, in ladder order", () => {
    expect(stagesEitherSide(ladder, "confronted")).toEqual(["troubled", "confronted", "resolved"]);
    expect(stagesEitherSide(ladder, "troubled")).toEqual(["troubled", "confronted"]);
    expect(stagesEitherSide(ladder, "settled")).toEqual(["resolved", "settled"]);
    expect(stagesEitherSide({ stages: ladder }, "resolved")).toEqual(["confronted", "resolved", "settled"]);
  });

  it("is the whole ladder for a name that is not a stage, which has no position", () => {
    expect(stagesEitherSide(ladder, "forgiven")).toEqual(ladder);
    expect(stagesEitherSide(ladder, 3)).toEqual(ladder);
  });
});

describe("valueFits", () => {
  it("checks the type of a plain value", () => {
    expect(valueFits({ type: "number" }, 3)).toBe(true);
    expect(valueFits({ type: "number" }, "3")).toBe(false);
    expect(valueFits({ type: "boolean" }, false)).toBe(true);
    expect(valueFits({ type: "boolean" }, 0)).toBe(false);
    for (const type of ["string", "text", "multiline"]) {
      expect(valueFits({ type }, "")).toBe(true);
      expect(valueFits({ type }, 5)).toBe(false);
    }
  });

  it("checks an enum, a flags value and a quality against their vocabulary", () => {
    expect(valueFits({ type: "enum", values: ["calm", "tense"] }, "tense")).toBe(true);
    expect(valueFits({ type: "enum", values: ["calm", "tense"] }, "loud")).toBe(false);
    expect(valueFits({ type: "flags", values: ["a", "b"] }, ["b", "a"])).toBe(true);
    expect(valueFits({ type: "flags", values: ["a", "b"] }, ["a", "c"])).toBe(false);
    expect(valueFits({ type: "flags", values: ["a", "b"] }, "a")).toBe(false);
    expect(valueFits({ type: "quality", stages: ["s", "f", "k"] }, "f")).toBe(true);
    expect(valueFits({ type: "quality", stages: ["s", "f", "k"] }, "enemy")).toBe(false);
  });

  it("lets an enum, and only an enum, hold none chosen when asked", () => {
    expect(valueFits({ type: "enum", values: ["calm"] }, "")).toBe(false);
    expect(valueFits({ type: "enum", values: ["calm"] }, "", { noneChosen: true })).toBe(true);
    expect(valueFits({ type: "quality", stages: ["s", "f"] }, "", { noneChosen: true })).toBe(false);
  });

  it("constrains nothing past the type where no vocabulary is listed, or the type is unknown", () => {
    expect(valueFits({ type: "enum" }, "anything")).toBe(true);
    expect(valueFits({ type: "flags" }, ["z"])).toBe(true);
    expect(valueFits({ type: "quality" }, "anywhere")).toBe(true);
    expect(valueFits({ type: "colour" }, 7)).toBe(true);
    // A declaration read from JSON as it came: a null or a non-list vocabulary is no vocabulary, as in every port.
    expect(valueFits({ type: "enum", values: null } as never, "anything")).toBe(true);
    expect(valueFits({ type: "enum", values: "calm,tense" } as never, "calm,")).toBe(true);
    expect(valueFits({ type: "quality", stages: null } as never, "x")).toBe(true);
  });
});
