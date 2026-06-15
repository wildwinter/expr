import { describe, it, expect } from "vitest";
import { binary, boolLit, numLit, scopedVar, notNode, callNode, strLit } from "../src/ast.js";
import {
  astToTree, addChildToContainer, flipContainerOp, toggleContainerNot, buildSubGroupClause, moveChildInContainer,
  type TreeRow,
} from "../src/tree.js";

const v = (n: string) => scopedVar("patter", n);

describe("tree model", () => {
  it("flattens a same-op left-folded chain into one container with N children", () => {
    const ast = binary("and", binary("and", v("a"), v("b")), v("c")); // ((a and b) and c)
    const row = astToTree(ast) as Extract<TreeRow, { kind: "container" }>;
    expect(row.kind).toBe("container");
    expect(row.op).toBe("and");
    expect(row.negated).toBe(false);
    expect(row.children).toHaveLength(3);
    expect(row.children.map((c) => (c as Extract<TreeRow, { kind: "wrapped" }>).node)).toEqual([v("a"), v("b"), v("c")]);
    // child paths address back into the AST
    expect(row.children[2]!.path).toEqual(["right"]);
  });

  it("surfaces a leading not as a negated container", () => {
    const row = astToTree(notNode(binary("or", v("a"), v("b")))) as Extract<TreeRow, { kind: "container" }>;
    expect(row.kind).toBe("container");
    expect(row.negated).toBe(true);
    expect(row.op).toBe("or");
    expect(row.chainPath).toEqual(["operand"]);
  });

  it("reads a comparison row (and its negation)", () => {
    const cmp = astToTree(binary(">", v("g"), numLit(0))) as Extract<TreeRow, { kind: "comparison" }>;
    expect(cmp.kind).toBe("comparison");
    expect(cmp.op).toBe(">");
    expect(cmp.negated).toBe(false);
    const neg = astToTree(notNode(binary("==", v("x"), numLit(1)))) as Extract<TreeRow, { kind: "comparison" }>;
    expect(neg.kind).toBe("comparison");
    expect(neg.negated).toBe(true);
    expect(neg.contentPath).toEqual(["operand"]);
  });

  it("treats a function call as a wrapped row", () => {
    const row = astToTree(callNode("site_has_tag", [strLit("inn")]));
    expect(row.kind).toBe("wrapped");
  });

  it("addChildToContainer appends (left-folded, inheriting the op)", () => {
    const ast = binary("and", v("a"), v("b"));
    expect(addChildToContainer(ast, [], v("c"))).toEqual(binary("and", binary("and", v("a"), v("b")), v("c")));
  });

  it("flipContainerOp flips every binary on the chain and re-polarises placeholders", () => {
    const ast = binary("and", v("a"), placeholderForOpAnd());
    const flipped = flipContainerOp(ast, [], "or");
    expect(flipped).toEqual(binary("or", v("a"), boolLit(false)));
  });

  it("toggleContainerNot wraps then unwraps", () => {
    const ast = binary("and", v("a"), v("b"));
    const wrapped = toggleContainerNot(ast, []);
    expect(wrapped).toEqual(notNode(ast));
    expect(toggleContainerNot(wrapped, [])).toEqual(ast);
  });

  it("buildSubGroupClause uses the opposite op + a placeholder", () => {
    expect(buildSubGroupClause("and", v("a"))).toEqual(binary("or", v("a"), boolLit(false)));
    expect(buildSubGroupClause("or", v("a"))).toEqual(binary("and", v("a"), boolLit(true)));
  });

  it("moveChildInContainer reorders within the chain", () => {
    const ast = binary("and", binary("and", v("a"), v("b")), v("c")); // [a, b, c]
    const moved = moveChildInContainer(ast, [], 0, 2); // -> [b, c, a]
    expect(moved).toEqual(binary("and", binary("and", v("b"), v("c")), v("a")));
    expect(moveChildInContainer(ast, [], 0, 5)).toEqual(ast); // out of range is a no-op
  });
});

function placeholderForOpAnd() { return boolLit(true); }
