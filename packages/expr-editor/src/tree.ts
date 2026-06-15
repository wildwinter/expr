// ---------------------------------------------------------------------------
// The AND/OR tree model. The ExprNode stays the source of truth; the renderable
// row tree is DERIVED on each render (never stored). Same-operator left-folded
// binary chains collapse to one container with N children; a leading `not`
// surfaces as a per-row `negated` flag. Ported from the storylets tree model.
// ---------------------------------------------------------------------------

import type { ExprNode, BinaryOp, AstPath } from "@wildwinter/expr";
import { binary, isComparisonOp, isPlaceholderForOp, placeholderForOp, setNodeAt, getNodeAt } from "./ast.js";

export type TreeRow =
  | { kind: "container"; op: "and" | "or"; negated: boolean; children: TreeRow[]; path: AstPath; chainPath: AstPath }
  | { kind: "comparison"; left: ExprNode; op: BinaryOp; right: ExprNode; negated: boolean; path: AstPath; contentPath: AstPath }
  | { kind: "wrapped"; node: ExprNode; negated: boolean; path: AstPath; contentPath: AstPath };

const isLogical = (n: ExprNode | null): n is ExprNode & { kind: "binary"; op: "and" | "or" } =>
  n != null && n.kind === "binary" && (n.op === "and" || n.op === "or");

/** Flatten a same-operator left-folded chain into its leaf rows, in document order. */
function collectChain(node: ExprNode, path: AstPath, op: "and" | "or"): TreeRow[] {
  if (node.kind === "binary" && node.op === op) {
    return [
      ...collectChain(node.left, [...path, "left"], op),
      ...collectChain(node.right, [...path, "right"], op),
    ];
  }
  return [astToTree(node, path)];
}

function containerRow(chain: ExprNode & { kind: "binary"; op: "and" | "or" }, chainPath: AstPath, negated: boolean, path: AstPath): TreeRow {
  return {
    kind: "container", op: chain.op, negated, path, chainPath,
    children: [
      ...collectChain(chain.left, [...chainPath, "left"], chain.op),
      ...collectChain(chain.right, [...chainPath, "right"], chain.op),
    ],
  };
}

/** Derive the renderable row for `node` (at `path` in the whole AST). */
export function astToTree(node: ExprNode, path: AstPath = []): TreeRow {
  // 1/2. AND/OR container (optionally negated).
  if (node.kind === "unary" && node.op === "not" && isLogical(node.operand)) {
    return containerRow(node.operand, [...path, "operand"], true, path);
  }
  if (isLogical(node)) return containerRow(node, path, false, path);

  // 3/4. Comparison (optionally negated).
  if (node.kind === "unary" && node.op === "not" && node.operand.kind === "binary" && isComparisonOp(node.operand.op)) {
    const inner = node.operand;
    return { kind: "comparison", left: inner.left, op: inner.op, right: inner.right, negated: true, path, contentPath: [...path, "operand"] };
  }
  if (node.kind === "binary" && isComparisonOp(node.op)) {
    return { kind: "comparison", left: node.left, op: node.op, right: node.right, negated: false, path, contentPath: path };
  }

  // 5. Negated anything else.
  if (node.kind === "unary" && node.op === "not") {
    return { kind: "wrapped", node: node.operand, negated: true, path, contentPath: [...path, "operand"] };
  }

  // 6. Wrapped: calls, arithmetic, a bare boolean var, a literal.
  return { kind: "wrapped", node, negated: false, path, contentPath: path };
}

// --- container mutations -----------------------------------------------------

/** Append `clause` to the chain at `chainPath` (left-folded; inherits the chain op, default "and"). */
export function addChildToContainer(ast: ExprNode, chainPath: AstPath, clause: ExprNode): ExprNode {
  const node = getNodeAt(ast, chainPath);
  if (!node) return ast;
  const op: "and" | "or" = isLogical(node) ? node.op : "and";
  return setNodeAt(ast, chainPath, binary(op, node, clause));
}

/** Flip every binary in the chain at `chainPath` from its current op to `newOp` (placeholders re-polarise). */
export function flipContainerOp(ast: ExprNode, chainPath: AstPath, newOp: "and" | "or"): ExprNode {
  const node = getNodeAt(ast, chainPath);
  if (!isLogical(node) || node.op === newOp) return ast;
  const oldOp = node.op;
  const flip = (n: ExprNode): ExprNode => {
    if (n.kind === "binary" && n.op === oldOp) return binary(newOp, flip(n.left), flip(n.right));
    if (isPlaceholderForOp(n, oldOp)) return placeholderForOp(newOp);
    return n;
  };
  return setNodeAt(ast, chainPath, flip(node));
}

/** Wrap the node at `path` in `not(…)`, or strip the `not` if it already is one. */
export function toggleContainerNot(ast: ExprNode, path: AstPath): ExprNode {
  const node = getNodeAt(ast, path);
  if (!node) return ast;
  if (node.kind === "unary" && node.op === "not") return setNodeAt(ast, path, node.operand);
  return setNodeAt(ast, path, { kind: "unary", op: "not", operand: node });
}

/** A new sub-group: its op is the OPPOSITE of the parent's (same-op would just flatten away). */
export function buildSubGroupClause(parentOp: "and" | "or", firstClause: ExprNode): ExprNode {
  const childOp: "and" | "or" = parentOp === "and" ? "or" : "and";
  return binary(childOp, firstClause, placeholderForOp(childOp));
}

const chainNodes = (node: ExprNode, op: "and" | "or"): ExprNode[] =>
  node.kind === "binary" && node.op === op ? [...chainNodes(node.left, op), ...chainNodes(node.right, op)] : [node];

const buildChain = (op: "and" | "or", nodes: ExprNode[]): ExprNode =>
  nodes.reduce((acc, n) => (acc ? binary(op, acc, n) : n));

/**
 * Walk one step up from `path` to its parent binary AND/OR; if the sibling at
 * that level is a placeholder for the parent's op, return the PARENT's path so a
 * downstream `deleteAt` collapses the whole half-filled sub-group rather than
 * leaving the placeholder (`true`/`false`) floating up as a bare clause. Returns
 * `path` unchanged otherwise. Ported from the storylets tree editor; fixes the
 * "delete the last real clause of a temp OR/AND group leaves `false`" case.
 */
export function redirectDeleteForPlaceholderSibling(ast: ExprNode, path: AstPath): AstPath {
  if (path.length === 0) return path;
  const last = path[path.length - 1];
  if (last !== "left" && last !== "right") return path;
  const parentPath = path.slice(0, -1);
  const parent = getNodeAt(ast, parentPath);
  if (!isLogical(parent)) return path;
  const sibling = last === "left" ? parent.right : parent.left;
  return isPlaceholderForOp(sibling, parent.op) ? parentPath : path;
}

/** Move a child within its container chain (reorder). Out-of-range is a no-op. */
export function moveChildInContainer(ast: ExprNode, chainPath: AstPath, from: number, to: number): ExprNode {
  const node = getNodeAt(ast, chainPath);
  if (!isLogical(node)) return ast;
  const arr = chainNodes(node, node.op);
  if (from < 0 || to < 0 || from >= arr.length || to >= arr.length || from === to) return ast;
  const [moved] = arr.splice(from, 1);
  arr.splice(to, 0, moved!);
  return setNodeAt(ast, chainPath, buildChain(node.op, arr));
}
