// firstEmptyLeafPath — the auto-open target finder for insert-then-refine
// templates: the first empty string literal or unnamed flag delta in a clause.

import { describe, it, expect } from "vitest";
import { firstEmptyLeafPath, binary, callNode, strLit, numLit, scopedVar, flagDelta, boolLit } from "../src/ast.js";

describe("firstEmptyLeafPath", () => {
  it("finds the empty tag arg of a bare call", () => {
    expect(firstEmptyLeafPath(callNode("site_has_tag", [strLit("")]))).toEqual(["args", 0]);
  });

  it("finds the empty tag inside a comparison-wrapped call", () => {
    const clause = binary(">", callNode("turns_since_tag", [strLit("")]), numLit(3));
    expect(firstEmptyLeafPath(clause)).toEqual(["left", "args", 0]);
  });

  it("finds an unnamed flag delta after a filled first arg", () => {
    const clause = callNode("check_flags", [scopedVar("world", "quests"), flagDelta("+", "")]);
    expect(firstEmptyLeafPath(clause)).toEqual(["args", 1]);
  });

  it("returns null for complete clauses (wizard-built)", () => {
    expect(firstEmptyLeafPath(binary("==", scopedVar("world", "season"), strLit("autumn")))).toBeNull();
    expect(firstEmptyLeafPath(boolLit(true))).toBeNull();
    expect(firstEmptyLeafPath(callNode("check_flags", [scopedVar("world", "q"), flagDelta("-", "met")]))).toBeNull();
  });

  it("descends through not(...)", () => {
    const clause = { kind: "unary" as const, op: "not" as const, operand: callNode("site_has_tag", [strLit("")]) };
    expect(firstEmptyLeafPath(clause)).toEqual(["operand", "args", 0]);
  });
});
