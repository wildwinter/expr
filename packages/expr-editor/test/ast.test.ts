import { describe, it, expect } from "vitest";
import {
  binary, boolLit, numLit, strLit, scopedVar, notNode, callNode,
  getNodeAt, setNodeAt, deleteAt, insertSiblingClauseAt, isWrappedInNot, toggleNotAt, findEnumPeer, findChoicePeer,
  placeholderForOp, isPlaceholderForOp,
} from "../src/ast.js";

describe("ast path mutation", () => {
  it("get / set address a node by field-name path", () => {
    const ast = binary("and", scopedVar("patter", "a"), binary("==", scopedVar("patter", "b"), numLit(3)));
    expect(getNodeAt(ast, ["left"])).toEqual(scopedVar("patter", "a"));
    expect(getNodeAt(ast, ["right", "right"])).toEqual(numLit(3));
    const next = setNodeAt(ast, ["right", "right"], numLit(9));
    expect(getNodeAt(next, ["right", "right"])).toEqual(numLit(9));
    expect(getNodeAt(ast, ["right", "right"])).toEqual(numLit(3)); // original untouched
  });

  it("getNodeAt returns null on a bad path", () => {
    expect(getNodeAt(boolLit(true), ["left"])).toBeNull();
  });

  it("deleteAt collapses a binary parent to the surviving sibling", () => {
    const ast = binary("and", scopedVar("patter", "a"), scopedVar("patter", "b"));
    expect(deleteAt(ast, ["right"])).toEqual(scopedVar("patter", "a"));
    expect(deleteAt(ast, ["left"])).toEqual(scopedVar("patter", "b"));
  });

  it("deleteAt at the root returns null", () => {
    expect(deleteAt(scopedVar("patter", "a"), [])).toBeNull();
  });

  it("deleteAt splices a call argument", () => {
    const ast = callNode("check_flags", [scopedVar("patter", "f"), strLit("x"), strLit("y")]);
    expect(deleteAt(ast, ["args", 1])).toEqual(callNode("check_flags", [scopedVar("patter", "f"), strLit("y")]));
  });

  it("insertSiblingClauseAt wraps the target in a new binary on the chosen side", () => {
    const ast = scopedVar("patter", "a");
    const clause = scopedVar("patter", "b");
    expect(insertSiblingClauseAt(ast, [], "and", "right", clause)).toEqual(binary("and", ast, clause));
    expect(insertSiblingClauseAt(ast, [], "or", "left", clause)).toEqual(binary("or", clause, ast));
  });

  it("toggleNotAt adds then strips a not; isWrappedInNot tracks it", () => {
    const ast = scopedVar("patter", "a");
    const wrapped = toggleNotAt(ast, []);
    expect(wrapped).toEqual(notNode(ast));
    // the operand of the not is at ["operand"]
    expect(isWrappedInNot(wrapped, ["operand"])).toBe(true);
    expect(toggleNotAt(wrapped, ["operand"])).toEqual(ast); // strips back
  });

  it("findChoicePeer returns the property a literal is compared against", () => {
    const ast = binary("==", scopedVar("scene", "weather"), strLit("storm"));
    expect(findChoicePeer(ast, ["right"])).toEqual({ scope: "scene", name: "weather" });
    expect(findChoicePeer(ast, ["left"])).toBeNull(); // the property side has no peer
  });

  it("resolves the peer of an ORDERING comparison too, which a quality's clause needs", () => {
    // This used to return null for anything but == / !=, which was fine while an enum was the only
    // type with a closed value list. A quality is ordered, so `>= "certain"` is its whole point, and
    // the restriction left that clause's value pill offering free text instead of the ladder.
    const ast = binary(">=", scopedVar("patter", "investigation"), strLit("certain"));
    expect(findChoicePeer(ast, ["right"])).toEqual({ scope: "patter", name: "investigation" });
    for (const op of [">", "<", "<="] as const) {
      expect(findChoicePeer(binary(op, scopedVar("patter", "q"), strLit("x")), ["right"])).toEqual({ scope: "patter", name: "q" });
    }
    // A number resolves its peer as well: whether the peer HAS choices is choicesOf's call, not the
    // operator's, and a number simply has none.
    expect(findChoicePeer(binary(">", scopedVar("patter", "g"), numLit(1)), ["right"])).toEqual({ scope: "patter", name: "g" });
    // Still nothing for a non-comparison.
    expect(findChoicePeer(binary("+", scopedVar("patter", "g"), numLit(1)), ["right"])).toBeNull();
  });

  it("keeps the old findEnumPeer name working for hosts", () => {
    expect(findEnumPeer).toBe(findChoicePeer);
  });

  it("placeholder sentinels are op-polarised", () => {
    expect(placeholderForOp("and")).toEqual(boolLit(true));
    expect(placeholderForOp("or")).toEqual(boolLit(false));
    expect(isPlaceholderForOp(boolLit(true), "and")).toBe(true);
    expect(isPlaceholderForOp(boolLit(true), "or")).toBe(false);
  });
});
