import { describe, it, expect } from "vitest";
import type { ExprNode } from "@wildwinter/expr";
import {
  matchedSpecificity, CHECK_FLAGS_COUNTING_CALL, type EvalTruthy, type CountingCall,
} from "../src/index.js";

// ---------------------------------------------------------------------------
// Tree builders + a mock evalTruthy. The scorer is decoupled from evaluation:
// we drive atom/call truth directly rather than through a real dialect. The
// end-to-end fixture parity (the shared-suite specificityCases) is proven where
// the hosts consume this package with their real evaluator.
// ---------------------------------------------------------------------------

const sv = (name: string): ExprNode => ({ kind: "scopedvar", scope: "world", name });
const and = (l: ExprNode, r: ExprNode): ExprNode => ({ kind: "binary", op: "and", left: l, right: r });
const or  = (l: ExprNode, r: ExprNode): ExprNode => ({ kind: "binary", op: "or",  left: l, right: r });
const not = (o: ExprNode): ExprNode => ({ kind: "unary", op: "not", operand: o });
const call = (name: string, ...args: ExprNode[]): ExprNode => ({ kind: "call", name, args });
const flag = (name: string): ExprNode => ({ kind: "flagdelta", sign: "+", name });
/** check_flags(@q, +f1..+fN). */
const cf = (...flags: string[]): ExprNode => call("check_flags", sv("q"), ...flags.map(flag));

/**
 * Mock truthiness: scoped vars named in `trueVars` hold; a `check_flags` call
 * holds iff `cfHolds`; any other call holds iff `callHolds`.
 */
const mk = (trueVars: string[], opts?: { cfHolds?: boolean; callHolds?: boolean }): EvalTruthy =>
  (node) => {
    if (node.kind === "scopedvar") return trueVars.includes(node.name);
    if (node.kind === "call") return node.name === "check_flags" ? (opts?.cfHolds ?? true) : (opts?.callHolds ?? false);
    return false;
  };

describe("matchedSpecificity - atoms", () => {
  it("a holding atom scores 1", () => {
    expect(matchedSpecificity(sv("a"), mk(["a"]))).toBe(1);
  });
  it("a non-holding atom scores 0", () => {
    expect(matchedSpecificity(sv("a"), mk([]))).toBe(0);
  });
  it("a non-counting call is an atom worth 1 when it holds", () => {
    expect(matchedSpecificity(call("site_has_tag", { kind: "string", value: "x" }), mk([], { callHolds: true }))).toBe(1);
  });
});

describe("matchedSpecificity - and (sum)", () => {
  it("two holding atoms sum to 2", () => {
    expect(matchedSpecificity(and(sv("a"), sv("b")), mk(["a", "b"]))).toBe(2);
  });
  it("one side not holding scores 0 (both must contribute)", () => {
    expect(matchedSpecificity(and(sv("a"), sv("b")), mk(["a"]))).toBe(0);
  });
  it("three holding atoms sum to 3", () => {
    expect(matchedSpecificity(and(and(sv("a"), sv("b")), sv("c")), mk(["a", "b", "c"]))).toBe(3);
  });
});

describe("matchedSpecificity - or (max)", () => {
  it("both branches holding scores 1", () => {
    expect(matchedSpecificity(or(sv("a"), sv("b")), mk(["a", "b"]))).toBe(1);
  });
  it("one branch holding scores 1", () => {
    expect(matchedSpecificity(or(sv("a"), sv("b")), mk(["a"]))).toBe(1);
  });
  it("neither branch holding scores 0", () => {
    expect(matchedSpecificity(or(sv("a"), sv("b")), mk([]))).toBe(0);
  });
});

describe("matchedSpecificity - nested", () => {
  const tree = or(and(and(sv("a"), sv("b")), sv("c")), sv("x"));
  it("matched via the 3-atom left branch scores 3", () => {
    expect(matchedSpecificity(tree, mk(["a", "b", "c"]))).toBe(3);
  });
  it("matched via the single-atom right branch scores 1", () => {
    expect(matchedSpecificity(tree, mk(["x"]))).toBe(1);
  });
  it("(a and b) or c with left holding scores 2", () => {
    expect(matchedSpecificity(or(and(sv("a"), sv("b")), sv("c")), mk(["a", "b"]))).toBe(2);
  });
});

describe("matchedSpecificity - not / De Morgan", () => {
  it("not(atom) holding (atom false) scores 1", () => {
    expect(matchedSpecificity(not(sv("a")), mk([]))).toBe(1);
  });
  it("not(a and b) with De Morgan max scores 1", () => {
    expect(matchedSpecificity(not(and(sv("a"), sv("b"))), mk(["a"]))).toBe(1);
  });
});

describe("matchedSpecificity - check_flags counting call", () => {
  it("three flag operands score 3", () => {
    expect(matchedSpecificity(cf("a", "b", "c"), mk([]))).toBe(3);
  });
  it("one flag operand scores 1", () => {
    expect(matchedSpecificity(cf("a"), mk([]))).toBe(1);
  });
  it("two flag operands score 2 (operand count, not truth count)", () => {
    expect(matchedSpecificity(cf("a", "b"), mk([]))).toBe(2);
  });
  it("a non-holding check_flags scores 0", () => {
    expect(matchedSpecificity(cf("a", "b", "c"), mk([], { cfHolds: false }))).toBe(0);
  });
  it("the default counting call is check_flags", () => {
    expect(CHECK_FLAGS_COUNTING_CALL.name).toBe("check_flags");
    expect(CHECK_FLAGS_COUNTING_CALL.count({ kind: "call", name: "check_flags", args: [sv("q"), flag("a"), flag("b")] })).toBe(2);
  });
});

describe("matchedSpecificity - options", () => {
  it("want:false flips atom polarity", () => {
    expect(matchedSpecificity(sv("a"), mk([]), { want: false })).toBe(1);
    expect(matchedSpecificity(sv("a"), mk(["a"]), { want: false })).toBe(0);
  });
  it("a custom counting call overrides the default", () => {
    const allArgs: CountingCall = { name: "site_has_all", count: (n) => n.args.length };
    const node = call("site_has_all", { kind: "string", value: "x" }, { kind: "string", value: "y" });
    // With the override, holds -> arg count (2). Without it, it would be a plain atom (1).
    expect(matchedSpecificity(node, mk([], { callHolds: true }), { countingCalls: [allArgs] })).toBe(2);
    expect(matchedSpecificity(node, mk([], { callHolds: true }))).toBe(1);
  });
});
