// ---------------------------------------------------------------------------
// AST - the in-memory expression tree and its serialised tagged-tuple form.
//
// The in-memory `ExprNode` is a discriminated union (kind field). The published
// `AstNode` is the compact tagged-tuple form that goes into a compiled bundle's
// { src, ast } envelope - what a runtime walks, never parses.
//
// This module is dialect-agnostic: scope tokens and function names are plain
// strings here; meaning is supplied by a Dialect (see dialect.ts).
// ---------------------------------------------------------------------------

export type ScalarValue = boolean | number | string | string[];

export type BinaryOp =
  | "==" | "!=" | ">" | ">=" | "<" | "<="
  | "+" | "-" | "*" | "/"
  | "and" | "or";

export type UnaryOp = "not" | "neg";

export type ExprNode =
  | { kind: "bool";      value: boolean }
  | { kind: "number";    value: number }
  | { kind: "string";    value: string }
  // All property references are scoped: bare `@name` is canonicalised to
  // `@<defaultScope>.name` at parse time. Names are lowercased at parse time.
  | { kind: "scopedvar"; scope: string; name: string }
  | { kind: "call";      name: string; args: ExprNode[] }
  | { kind: "unary";     op: UnaryOp; operand: ExprNode }
  | { kind: "binary";    op: BinaryOp; left: ExprNode; right: ExprNode }
  // Produced only by flag-delta function argument parsing (see Dialect
  // `flagDeltaArgs`) - not valid elsewhere.
  | { kind: "flagdelta"; sign: "+" | "-"; name: string };

/**
 * Path into an ExprNode tree. Each segment names the field on the parent node,
 * with numeric indices for array elements (call args).
 *   binary.left          -> ["left"]
 *   binary.right.args[0] -> ["right", "args", 0]
 *   top-level node       -> []
 */
export type AstPath = readonly (string | number)[];

// ---------------------------------------------------------------------------
// Published tagged-tuple form (JSON arrays, opcode at index 0).
// ---------------------------------------------------------------------------

export type AstNode =
  | ["b", boolean]
  | ["n", number]
  | ["s", string]
  | ["sv", string, string]
  | ["u", UnaryOp, AstNode]
  | ["bin", BinaryOp, AstNode, AstNode]
  | ["call", string, ...AstNode[]]
  | ["fd", "+" | "-", string];

/** In-memory ExprNode -> published tagged-tuple AstNode. */
export function serialiseAst(node: ExprNode): AstNode {
  switch (node.kind) {
    case "bool":      return ["b", node.value];
    case "number":    return ["n", node.value];
    case "string":    return ["s", node.value];
    case "scopedvar": return ["sv", node.scope, node.name];
    case "unary":     return ["u", node.op, serialiseAst(node.operand)];
    case "binary":    return ["bin", node.op, serialiseAst(node.left), serialiseAst(node.right)];
    case "call":      return ["call", node.name, ...node.args.map(serialiseAst)];
    case "flagdelta": return ["fd", node.sign, node.name];
  }
}

/** Published tagged-tuple AstNode -> in-memory ExprNode. */
export function deserialiseAst(node: AstNode): ExprNode {
  switch (node[0]) {
    case "b":   return { kind: "bool",   value: node[1] };
    case "n":   return { kind: "number", value: node[1] };
    case "s":   return { kind: "string", value: node[1] };
    case "sv":  return { kind: "scopedvar", scope: node[1], name: node[2] };
    case "u":   return { kind: "unary",  op: node[1], operand: deserialiseAst(node[2]) };
    case "bin": return { kind: "binary", op: node[1], left: deserialiseAst(node[2]), right: deserialiseAst(node[3]) };
    case "call": {
      const args = (node.slice(2) as AstNode[]).map(deserialiseAst);
      return { kind: "call", name: node[1], args };
    }
    case "fd":  return { kind: "flagdelta", sign: node[1], name: node[2] };
  }
}
