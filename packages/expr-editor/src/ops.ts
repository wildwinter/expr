// ---------------------------------------------------------------------------
// Operator metadata: display labels, swap groups, precedence/parenthesisation,
// and number formatting. Pure data + helpers shared by the renderer. Ported from
// the storylets editor's pillStyles.
// ---------------------------------------------------------------------------

import type { BinaryOp, UnaryOp } from "@wildwinter/expr";

/** Human label for a binary operator (words for logical, glyphs for relational). */
export const BINARY_LABEL: Record<BinaryOp, string> = {
  and: "AND", or: "OR",
  "==": "is", "!=": "≠", ">": ">", ">=": "≥", "<": "<", "<=": "≤",
  "+": "+", "-": "−", "*": "×", "/": "÷",
};

export const UNARY_LABEL: Record<UnaryOp, string> = { not: "NOT", neg: "−" };

export const COMPARISON_OPS: BinaryOp[] = ["==", "!=", ">", ">=", "<", "<="];
export const ARITHMETIC_OPS: BinaryOp[] = ["+", "-", "*", "/"];

/** The set of operators a given operator can be swapped to inline, or null if structural (and/or/not). */
export function opSwapGroup(op: BinaryOp): BinaryOp[] | null {
  if (COMPARISON_OPS.includes(op)) return COMPARISON_OPS;
  if (ARITHMETIC_OPS.includes(op)) return ARITHMETIC_OPS;
  return null; // and / or are structural (flipped at the container level)
}

/** Binding precedence (higher binds tighter) — for minimal parenthesisation. */
const PREC: Record<BinaryOp, number> = {
  or: 1, and: 2,
  "==": 4, "!=": 4, ">": 4, ">=": 4, "<": 4, "<=": 4,
  "+": 5, "-": 5, "*": 6, "/": 6,
};

/** Whether a child binary needs parentheses inside a parent binary on the given side. */
export function needsParens(childOp: BinaryOp, parentOp: BinaryOp, side: "left" | "right"): boolean {
  if (PREC[childOp] < PREC[parentOp]) return true;
  // right operand of a left-associative non-commutative op (− / ÷) at equal precedence
  return PREC[childOp] === PREC[parentOp] && side === "right" && (parentOp === "-" || parentOp === "/");
}

/** Render a number without IEEE-754 noise (integers plain; floats trimmed). */
export function formatNumber(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return String(parseFloat(n.toFixed(12)));
}
