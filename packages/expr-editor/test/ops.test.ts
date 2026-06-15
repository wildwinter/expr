import { describe, it, expect } from "vitest";
import { BINARY_LABEL, opSwapGroup, needsParens, formatNumber, COMPARISON_OPS, ARITHMETIC_OPS } from "../src/ops.js";

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

  it("formats numbers without IEEE noise", () => {
    expect(formatNumber(5)).toBe("5");
    expect(formatNumber(0.1 + 0.2)).toBe("0.3");
    expect(formatNumber(-2.5)).toBe("-2.5");
  });
});
