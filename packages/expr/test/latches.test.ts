// The latch grammar's own tests.
//
// It lives here because it is analysis of the expression language, and it needs
// tests here for a reason found the day it moved: BOTH families' reachability
// suites (18 cases and 24) passed with the `@x == true` shape disabled
// entirely. The shape was in the grammar, used by both, and covered by neither,
// because each suite tests its own model's traversal and reaches the grammar
// only incidentally. That is the same failure the cross-language corpus exists
// to stop, in a different language.

import { describe, expect, it } from "vitest";
import { disjuncts, latchOf, scopedRef, terms } from "../src/latches.js";
import type { AstNode } from "../src/ast.js";

/** The simplest possible host: a ref keys as itself, owner ignored. */
const flat = (ref: string): string => ref;
/** A host that scopes one prefix by owner, as both families really do. */
const scoped = (ref: string, owner: string): string =>
  ref.startsWith("@local.") ? `${owner}/${ref}` : ref;

const sv = (scope: string, name: string): AstNode => ["sv", scope, name];
const not = (n: AstNode): AstNode => ["u", "not", n];
const and = (l: AstNode, r: AstNode): AstNode => ["bin", "and", l, r];
const or = (l: AstNode, r: AstNode): AstNode => ["bin", "or", l, r];

describe("scopedRef", () => {
  it("reads a scoped variable as the ref a person would write", () => {
    expect(scopedRef(sv("story", "flag"))).toBe("@story.flag");
  });
  it("is undefined for anything else", () => {
    expect(scopedRef(["b", true])).toBeUndefined();
    expect(scopedRef(and(sv("a", "b"), sv("c", "d")))).toBeUndefined();
  });
});

describe("latchOf: the three shapes it understands", () => {
  it("a bare reference", () => {
    expect(latchOf(sv("story", "flag"), "", flat)).toBe("@story.flag");
  });

  // The shape neither family's suite covered.
  it("`@x == true`, which asserts exactly what `@x` does", () => {
    expect(latchOf(["bin", "==", sv("story", "flag"), ["b", true]], "", flat)).toBe("@story.flag");
  });

  it("`true == @x`, the same the other way round", () => {
    expect(latchOf(["bin", "==", ["b", true], sv("story", "flag")], "", flat)).toBe("@story.flag");
  });

  it("`@x == false` asserts NOTHING: it is not a latch, and a guess here would be a false report", () => {
    expect(latchOf(["bin", "==", sv("story", "flag"), ["b", false]], "", flat)).toBeUndefined();
  });

  it("`check_flags(@x, +f)`, keyed by ref and flag", () => {
    const ast: AstNode = ["call", "check_flags", sv("story", "marks"), ["fd", "+", "seen"]];
    expect(latchOf(ast, "", flat)).toBe("@story.marks:seen");
  });

  it("a MINUS flag delta is not a latch", () => {
    const ast: AstNode = ["call", "check_flags", sv("story", "marks"), ["fd", "-", "seen"]];
    expect(latchOf(ast, "", flat)).toBeUndefined();
  });

  it("two flags in one call are not a latch, deliberately", () => {
    const ast: AstNode = ["call", "check_flags", sv("story", "marks"), ["fd", "+", "a"], ["fd", "+", "b"]];
    expect(latchOf(ast, "", flat)).toBeUndefined();
  });

  it("anything else is undefined rather than guessed at", () => {
    expect(latchOf(["bin", ">", sv("story", "n"), ["n", 3]], "", flat)).toBeUndefined();
    expect(latchOf(["call", "random", ["n", 1], ["n", 2]], "", flat)).toBeUndefined();
    expect(latchOf(["b", true], "", flat)).toBeUndefined();
  });

  it("keys through the host's scoping, so the same ref in two owners is two latches", () => {
    expect(latchOf(sv("local", "x"), "one", scoped)).toBe("one/@local.x");
    expect(latchOf(sv("local", "x"), "two", scoped)).toBe("two/@local.x");
    expect(latchOf(sv("global", "x"), "one", scoped)).toBe("@global.x");
  });
});

describe("disjuncts", () => {
  it("splits on top-level or, flattening nested ones", () => {
    const ast = or(sv("s", "a"), or(sv("s", "b"), sv("s", "c")));
    expect(disjuncts(ast).map((d) => scopedRef(d))).toEqual(["@s.a", "@s.b", "@s.c"]);
  });
  it("leaves an and whole: it is one branch", () => {
    expect(disjuncts(and(sv("s", "a"), sv("s", "b")))).toHaveLength(1);
  });
});

describe("terms", () => {
  it("collects both sides of an and", () => {
    expect(terms(and(sv("s", "a"), sv("s", "b")), "", flat)).toEqual([
      { key: "@s.a", negated: false },
      { key: "@s.b", negated: false },
    ]);
  });

  it("carries negation through not", () => {
    expect(terms(not(sv("s", "a")), "", flat)).toEqual([{ key: "@s.a", negated: true }]);
  });

  it("flips twice back to positive", () => {
    expect(terms(not(not(sv("s", "a"))), "", flat)).toEqual([{ key: "@s.a", negated: false }]);
  });

  it("does NOT descend into a negated and, because De Morgan makes it an or", () => {
    // `not (a and b)` is `not a OR not b`, which asserts neither on its own.
    expect(terms(not(and(sv("s", "a"), sv("s", "b"))), "", flat)).toEqual([]);
  });

  it("omits what it does not understand rather than guessing", () => {
    const ast = and(sv("s", "a"), ["bin", ">", sv("s", "n"), ["n", 3]] as AstNode);
    expect(terms(ast, "", flat)).toEqual([{ key: "@s.a", negated: false }]);
  });
});
