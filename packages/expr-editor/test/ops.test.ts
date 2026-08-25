import { describe, it, expect } from "vitest";
import { BINARY_LABEL, OP_WORD, UNARY_LABEL, opSwapGroup, needsParens, formatNumber, COMPARISON_OPS, ARITHMETIC_OPS } from "../src/ops.js";

describe("operator metadata", () => {
  it("labels logical + relational operators", () => {
    expect(BINARY_LABEL.and).toBe("AND");
    expect(BINARY_LABEL["=="]).toBe("is");
    expect(BINARY_LABEL[">="]).toBe("≥");
  });

  it("swap groups: comparison / arithmetic swappable, and/or structural", () => {
    expect(opSwapGroup("==")).toEqual(COMPARISON_OPS);
    expect(opSwapGroup("+")).toEqual(ARITHMETIC_OPS);
    expect(opSwapGroup("and")).toBeNull();
    expect(opSwapGroup("or")).toBeNull();
  });

  it("parenthesises lower-precedence children and right-associative cases", () => {
    expect(needsParens("or", "and", "left")).toBe(true);   // (a or b) and c
    expect(needsParens("and", "or", "left")).toBe(false);  // a and b or c — and binds tighter
    expect(needsParens("-", "-", "right")).toBe(true);     // a - (b - c)
    expect(needsParens("+", "+", "right")).toBe(false);    // associative
  });

  // Every operator menu row is BINARY_LABEL beside OP_WORD, so a word that merely repeats its glyph
  // is a row saying nothing twice. The swap menu shipped exactly that for a while, printing the raw
  // source as the second half: ">" read "> >", and "≥" read "≥ >=".
  it("gives every operator a word that the glyph does not already say", () => {
    // The two swap groups are exactly what those menus offer; and/or never reach one (they are
    // flipped at the container level), and their word IS their source, honestly.
    for (const op of [...COMPARISON_OPS, ...ARITHMETIC_OPS]) {
      expect(OP_WORD[op], `word for ${op}`).toBeTruthy();
      expect(OP_WORD[op], `word for ${op}`).not.toBe(BINARY_LABEL[op]);
      expect(OP_WORD[op], `word for ${op}`).not.toBe(op); // never the raw source either
    }
    expect(OP_WORD.and).toBeTruthy();
    expect(OP_WORD.or).toBeTruthy();
  });

  it("covers the unary operators too, since the pill reads its word aloud", () => {
    for (const op of ["not", "neg"] as const) {
      expect(OP_WORD[op], `word for ${op}`).toBeTruthy();
      expect(OP_WORD[op]).not.toBe(UNARY_LABEL[op]);
    }
  });

  it("formats numbers without IEEE noise", () => {
    expect(formatNumber(5)).toBe("5");
    expect(formatNumber(0.1 + 0.2)).toBe("0.3");
    expect(formatNumber(-2.5)).toBe("-2.5");
  });
});
