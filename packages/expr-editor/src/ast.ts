// ---------------------------------------------------------------------------
// AST path mutation — pure functions over `@wildwinter/expr`'s ExprNode, with
// structural sharing (only the spine from root to the changed node is rebuilt;
// sibling subtrees are reused by reference). These are the substrate the visual
// editor mutates the tree with; ported from the storylets editor's astMutation.
//
// Path encoding (matches the validator's AstPath): field-name segments with a
// numeric index after "args".
//   binary.left          -> ["left"]
//   binary.right.args[0] -> ["right", "args", 0]
//   top-level node       -> []
// ---------------------------------------------------------------------------

import type { ExprNode, BinaryOp, AstPath } from "@wildwinter/expr";

// --- small node constructors (one place for the node shapes) ---------------
export const boolLit = (value: boolean): ExprNode => ({ kind: "bool", value });
export const numLit = (value: number): ExprNode => ({ kind: "number", value });
export const strLit = (value: string): ExprNode => ({ kind: "string", value });
export const scopedVar = (scope: string, name: string): ExprNode => ({ kind: "scopedvar", scope, name: name.toLowerCase() });
export const binary = (op: BinaryOp, left: ExprNode, right: ExprNode): ExprNode => ({ kind: "binary", op, left, right });
export const notNode = (operand: ExprNode): ExprNode => ({ kind: "unary", op: "not", operand });
export const callNode = (name: string, args: ExprNode[]): ExprNode => ({ kind: "call", name, args });
export const flagDelta = (sign: "+" | "-", name: string): ExprNode => ({ kind: "flagdelta", sign, name });

/** A no-op sentinel: `true and X === X`, `false or X === X`, so a half-filled slot is inert. */
export const placeholderForOp = (op: "and" | "or"): ExprNode => boolLit(op === "and");
export const isPlaceholderForOp = (node: ExprNode, op: "and" | "or"): boolean =>
  node.kind === "bool" && node.value === (op === "and");

const COMPARISON = new Set<BinaryOp>(["==", "!=", ">", ">=", "<", "<="]);
export const isComparisonOp = (op: BinaryOp): boolean => COMPARISON.has(op);

// --- read --------------------------------------------------------------------

/** The node at `path`, or null if any segment fails to resolve. */
export function getNodeAt(ast: ExprNode, path: AstPath): ExprNode | null {
  let node: ExprNode | null = ast;
  for (let i = 0; i < path.length; i++) {
    if (!node) return null;
    const seg = path[i];
    if (node.kind === "binary" && seg === "left") node = node.left;
    else if (node.kind === "binary" && seg === "right") node = node.right;
    else if (node.kind === "unary" && seg === "operand") node = node.operand;
    else if (node.kind === "call" && seg === "args") { node = node.args[path[++i] as number] ?? null; }
    else return null;
  }
  return node;
}

// --- write (structural sharing) ---------------------------------------------

/** Replace the node at `path` with `next`. `path.length === 0` returns `next`. */
export function setNodeAt(ast: ExprNode, path: AstPath, next: ExprNode): ExprNode {
  if (path.length === 0) return next;
  const [seg, ...rest] = path;
  if (ast.kind === "binary" && seg === "left") return { ...ast, left: setNodeAt(ast.left, rest, next) };
  if (ast.kind === "binary" && seg === "right") return { ...ast, right: setNodeAt(ast.right, rest, next) };
  if (ast.kind === "unary" && seg === "operand") return { ...ast, operand: setNodeAt(ast.operand, rest, next) };
  if (ast.kind === "call" && seg === "args") {
    const idx = rest[0] as number;
    const args = ast.args.map((a, i) => (i === idx ? setNodeAt(a, rest.slice(1), next) : a));
    return { ...ast, args };
  }
  throw new Error(`cannot descend into ${ast.kind} via '${String(seg)}'`);
}

/**
 * Delete the node at `path`, collapsing its parent:
 *   - binary parent -> the surviving sibling replaces the parent (`A and B`, del B -> `A`)
 *   - unary parent  -> the operand replaces the unary (strips the wrapper)
 *   - call parent   -> the arg is spliced out
 * Deleting the root (`path === []`) returns null (the caller clears the expression).
 */
export function deleteAt(ast: ExprNode, path: AstPath): ExprNode | null {
  if (path.length === 0) return null;
  const last = path[path.length - 1];
  // call arg: [..., "args", index]
  if (typeof last === "number" && path[path.length - 2] === "args") {
    const callPath = path.slice(0, -2);
    const call = getNodeAt(ast, callPath);
    if (call?.kind !== "call") return ast;
    return setNodeAt(ast, callPath, { ...call, args: call.args.filter((_, i) => i !== last) });
  }
  const parentPath = path.slice(0, -1);
  const parent = getNodeAt(ast, parentPath);
  if (parent?.kind === "binary") {
    const survivor = last === "left" ? parent.right : parent.left;
    return setNodeAt(ast, parentPath, survivor);
  }
  if (parent?.kind === "unary") {
    return setNodeAt(ast, parentPath, parent.operand);
  }
  return ast; // nothing sensible to collapse
}

/** Wrap the node at `path` in a new `binary(op, …)`, the clause on `side`. */
export function insertSiblingClauseAt(
  ast: ExprNode, path: AstPath, op: "and" | "or", side: "left" | "right", clause: ExprNode,
): ExprNode {
  const target = getNodeAt(ast, path);
  if (!target) return ast;
  const wrapped = side === "right" ? binary(op, target, clause) : binary(op, clause, target);
  return setNodeAt(ast, path, wrapped);
}

/** True iff the node at `path` is the operand of a `not`. */
export function isWrappedInNot(ast: ExprNode, path: AstPath): boolean {
  if (path[path.length - 1] !== "operand") return false;
  const parent = getNodeAt(ast, path.slice(0, -1));
  return parent?.kind === "unary" && parent.op === "not";
}

/** Wrap the node at `path` in `not(…)`. */
export function wrapInNotAt(ast: ExprNode, path: AstPath): ExprNode {
  const target = getNodeAt(ast, path);
  return target ? setNodeAt(ast, path, notNode(target)) : ast;
}

/** Add a `not` if absent, strip it if present. */
export function toggleNotAt(ast: ExprNode, path: AstPath): ExprNode {
  if (isWrappedInNot(ast, path)) {
    const inner = getNodeAt(ast, path);
    return inner ? setNodeAt(ast, path.slice(0, -1), inner) : ast;
  }
  return wrapInNotAt(ast, path);
}

/**
 * If the node at `path` is one operand of a COMPARISON whose other operand is a property
 * reference, return that property - so a literal can offer that property's choices (an enum's
 * values, a quality's stages).
 *
 * Every comparison counts, not just `==` / `!=`. Equality was enough while an enum was the only
 * type with a closed value list, because an enum is never ordered; a QUALITY is ordered, and
 * `@investigation >= "certain"` is the shape its type exists for. Restricting to equality left
 * exactly that clause offering a free-text box where the ladder should be.
 *
 * Whether the peer HAS choices is not decided here - that is `choicesOf`'s job. This answers only
 * "which property is this literal being compared against", so a number's `> 1` resolves its peer
 * and then offers nothing, as before.
 */
export function findChoicePeer(ast: ExprNode, path: AstPath): { scope: string; name: string } | null {
  const last = path[path.length - 1];
  if (last !== "left" && last !== "right") return null;
  const parent = getNodeAt(ast, path.slice(0, -1));
  if (parent?.kind !== "binary" || !isComparisonOp(parent.op)) return null;
  const other = last === "left" ? parent.right : parent.left;
  return other.kind === "scopedvar" ? { scope: other.scope, name: other.name } : null;
}

/** @deprecated Renamed to {@link findChoicePeer} - it serves qualities as well as enums now. */
export const findEnumPeer = findChoicePeer;

/** A name-form ref in ONE form, so two spellings of the same property compare equal: the default
 *  scope may be written or left off (`@patter.debt` and `@debt`), and refs are case-insensitive. */
export const normaliseRef = (ref: string, defaultScope: string): string => {
  const low = ref.toLowerCase();
  const prefix = `@${defaultScope.toLowerCase()}.`;
  return low.startsWith(prefix) ? `@${low.slice(prefix.length)}` : low;
};

/** The set/clear-a-flag value: `set_flags(@scope.name, +flag)` - adjust one
 *  flag, keep the rest, which is what outcomes on a flags property
 *  overwhelmingly do (and the form a whole-value change cannot express).
 *  Lives here with the other pure ref helpers so the value wizard can build
 *  it without importing the effects mount (which imports the wizard). */
export const flagChangeSrc = (targetRef: string, sign: "+" | "-", flag: string): string =>
  `set_flags(${targetRef}, ${sign}${flag})`;

/** The name-form ref a call ADVANCES, when the call is the plain `advance(@x)` shape: one scopedvar
 *  argument and nothing else. Null for any other call, and for an argument that is not a property
 *  (`advance(f(@x))` keeps its explicit form, since collapsing it would hide the middle).
 *
 *  `advance` is the language's own built-in rather than a dialect function, so it is matched by name
 *  here the way the evaluator and validator match it. */
export function advancedRef(node: ExprNode, defaultScope: string): string | null {
  if (node.kind !== "call" || node.name !== "advance" || node.args.length !== 1) return null;
  const arg = node.args[0]!;
  return arg.kind === "scopedvar" ? normaliseRef(`@${arg.scope}.${arg.name}`, defaultScope) : null;
}

/**
 * DFS for the first unfilled slot in a template-inserted clause: an empty string
 * literal (a tag / value the author still has to set) or an unnamed flag delta.
 * Returns its path relative to `node`, or null when the clause is complete —
 * wizard-built clauses have no empty slots, so they never auto-open anything.
 */
export function firstEmptyLeafPath(node: ExprNode, base: AstPath = []): AstPath | null {
  switch (node.kind) {
    case "string":    return node.value === "" ? base : null;
    case "flagdelta": return node.name === "" ? base : null;
    case "unary":     return firstEmptyLeafPath(node.operand, [...base, "operand"]);
    case "binary":
      return firstEmptyLeafPath(node.left, [...base, "left"]) ?? firstEmptyLeafPath(node.right, [...base, "right"]);
    case "call": {
      for (let i = 0; i < node.args.length; i++) {
        const p = firstEmptyLeafPath(node.args[i]!, [...base, "args", i]);
        if (p) return p;
      }
      return null;
    }
    default: return null;
  }
}
