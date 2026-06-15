import { describe, it, expect } from "vitest";
import {
  binary, boolLit, numLit, strLit, scopedVar, notNode, callNode,
  getNodeAt, setNodeAt, deleteAt, insertSiblingClauseAt, isWrappedInNot, toggleNotAt, findEnumPeer,
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

  it("findEnumPeer returns the property a string is compared against", () => {
    const ast = binary("==", scopedVar("scene", "weather"), strLit("storm"));
    expect(findEnumPeer(ast, ["right"])).toEqual({ scope: "scene", name: "weather" });
    expect(findEnumPeer(ast, ["left"])).toBeNull(); // the property side has no peer
    expect(findEnumPeer(binary(">", scopedVar("patter", "g"), numLit(1)), ["right"])).toBeNull(); // not == / !=
  });

  it("placeholder sentinels are op-polarised", () => {
    expect(placeholderForOp("and")).toEqual(boolLit(true));
    expect(placeholderForOp("or")).toEqual(boolLit(false));
    expect(isPlaceholderForOp(boolLit(true), "and")).toBe(true);
    expect(isPlaceholderForOp(boolLit(true), "or")).toBe(false);
  });
});
