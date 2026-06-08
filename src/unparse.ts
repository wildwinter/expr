// ---------------------------------------------------------------------------
// Unparse - ExprNode -> canonical string (round-trip with parse).
//
// Generic except for the default scope: a `scopedvar` in the default scope
// emits the bare `@name` short form (round-trip stable with the parser, which
// canonicalises bare `@name` to the default scope). Pass the dialect's
// `defaultScope` to keep round-trips exact.
//
// Ported from @storylets/expressions (storylets/packages/expressions/src/unparse.ts).
// ---------------------------------------------------------------------------

import type { BinaryOp, ExprNode } from "./ast.js";

const BINARY_PREC: Record<BinaryOp, number> = {
  or: 1, and: 2, "==": 4, "!=": 4, ">": 4, ">=": 4, "<": 4, "<=": 4,
  "+": 5, "-": 5, "*": 6, "/": 6,
};

function needsParens(child: ExprNode, parentOp: BinaryOp, side: "left" | "right"): boolean {
  if (child.kind !== "binary") return false;
  const cp = BINARY_PREC[child.op]!;
  const pp = BINARY_PREC[parentOp]!;
  if (cp < pp) return true;
  // Right-associativity: add parens on right side for same-precedence subtraction and division
  if (cp === pp && side === "right" && (parentOp === "-" || parentOp === "/")) return true;
  return false;
}

export interface UnparseOptions {
  /**
   * The scope whose references emit the bare `@name` short form. Pass the
   * dialect's `defaultScope` for exact round-trips. If omitted, every scoped
   * reference is emitted fully qualified (`@scope.name`).
   */
  defaultScope?: string;
}

export function unparse(node: ExprNode, opts: UnparseOptions = {}): string {
  const { defaultScope } = opts;

  const go = (n: ExprNode): string => {
    switch (n.kind) {
      case "bool":   return String(n.value);
      case "number": return String(n.value);
      case "string": {
        // Emit unquoted when the value is a safe identifier (e.g. enum/flag values)
        if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(n.value)) return n.value;
        return `"${n.value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
      }
      case "scopedvar":
        // Bare `@name` is the canonical short form for default-scope refs; keep
        // it round-trip stable. Other scopes always emit qualified.
        return n.scope === defaultScope ? `@${n.name}` : `@${n.scope}.${n.name}`;
      case "call":      return `${n.name}(${n.args.map(go).join(", ")})`;
      case "flagdelta": return `${n.sign}${n.name}`;
      case "unary": {
        const inner = go(n.operand);
        const wrap = n.operand.kind === "binary" || n.operand.kind === "unary";
        const body = wrap ? `(${inner})` : inner;
        return n.op === "not" ? `not ${body}` : `-${body}`;
      }
      case "binary": {
        const l = needsParens(n.left,  n.op, "left")  ? `(${go(n.left)})`  : go(n.left);
        const r = needsParens(n.right, n.op, "right") ? `(${go(n.right)})` : go(n.right);
        return `${l} ${n.op} ${r}`;
      }
    }
  };

  return go(node);
}
