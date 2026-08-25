// ---------------------------------------------------------------------------
// `advance(@x)` reading as a word. A quality outcome only ever has one shape, and written out it
// names the property three times to say one thing: `@debt = advance(@debt)`. The editor collapses
// exactly that shape - target column, then the verb - so a row reads `debt advances`.
//
// The precedent is the flag-delta call, which drops its name and parens in compact previews because
// the pills carry the meaning. The difference pinned here: this collapse fires ONLY when the call
// advances the set's own target, because `@a = advance(@b)` names a second ladder, and that is news.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { parse, type Dialect } from "@wildwinter/expr";
import { advancedRef, normaliseRef } from "../src/ast.js";
import { isSelfAdvance, type EditorEffect } from "../src/effects.js";

const dialect: Dialect = {
  defaultScope: "patter",
  scopes: [{ token: "patter" }, { token: "world" }],
  functions: {},
};
const set = (target: string, value: string): EditorEffect => ({ kind: "set", target, value });
const selfAdvance = (e: EditorEffect): boolean => isSelfAdvance(e, dialect.defaultScope, dialect);

describe("advancedRef: the one call shape that collapses", () => {
  it("names the property a plain advance() moves", () => {
    expect(advancedRef(parse("advance(@debt)", dialect), "patter")).toBe("@debt");
    expect(advancedRef(parse("advance(@world.threat)", dialect), "patter")).toBe("@world.threat");
  });

  it("refuses anything that is not exactly advance(<property>)", () => {
    // A wrapped argument still has a middle step to show, and another function is another function.
    expect(advancedRef(parse("advance(advance(@debt))", dialect), "patter")).toBeNull();
    expect(advancedRef(parse("@debt", dialect), "patter")).toBeNull();
    expect(advancedRef(parse('"certain"', dialect), "patter")).toBeNull();
  });
});

describe("normaliseRef: two spellings of one property", () => {
  it("drops a written-out default scope, and is case-insensitive", () => {
    expect(normaliseRef("@patter.debt", "patter")).toBe("@debt");
    expect(normaliseRef("@Debt", "patter")).toBe("@debt");
  });

  it("keeps a non-default scope, which is part of the name", () => {
    expect(normaliseRef("@world.threat", "patter")).toBe("@world.threat");
  });
});

describe("isSelfAdvance: does this outcome advance its OWN target?", () => {
  it("recognises the idiom every quality outcome takes", () => {
    expect(selfAdvance(set("@debt", "advance(@debt)"))).toBe(true);
    expect(selfAdvance(set("@world.threat", "advance(@world.threat)"))).toBe(true);
  });

  it("sees through spelling: the default scope written out, odd spacing, case", () => {
    expect(selfAdvance(set("@patter.debt", "advance(@debt)"))).toBe(true);
    expect(selfAdvance(set("@debt", "advance( @patter.debt )"))).toBe(true);
  });

  it("leaves a DIFFERENT ladder written out, because the second name is news", () => {
    expect(selfAdvance(set("@debt", "advance(@suspicion)"))).toBe(false);
  });

  it("leaves every other value alone", () => {
    expect(selfAdvance(set("@debt", '"confronted"'))).toBe(false);
    expect(selfAdvance(set("@gold", "@gold + 1"))).toBe(false);
    expect(selfAdvance({ kind: "emit", event: "fanfare", args: [] })).toBe(false);
  });

  it("treats an unfinished or unparseable value as simply not this shape", () => {
    // The row renders while the author is mid-edit; a throw here would take the editor with it.
    expect(selfAdvance(set("@debt", "advance("))).toBe(false);
    expect(selfAdvance(set("", "advance(@debt)"))).toBe(false);
  });
});
