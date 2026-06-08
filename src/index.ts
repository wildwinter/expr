// ---------------------------------------------------------------------------
// @wildwinter/expr - public surface.
//
// An agnostic expression engine: parse / unparse / evaluate / (de)serialise a
// small condition + effect expression language. Scopes and built-in functions
// are supplied by a Dialect, so the same core powers different host projects
// (e.g. Storylet Studio and Patter).
// ---------------------------------------------------------------------------

import { parse } from "./parser.js";
import { serialiseAst } from "./ast.js";
import type { AstNode } from "./ast.js";
import type { Dialect } from "./dialect.js";

export { parse, ParseError } from "./parser.js";
export { unparse } from "./unparse.js";
export type { UnparseOptions } from "./unparse.js";
export { evaluate, EvalError } from "./evaluate.js";
export { serialiseAst, deserialiseAst } from "./ast.js";
export { validateExpr, validateExpressionAst, parseAndValidate } from "./validate.js";
export type {
  ExpressionSchema, PropertyType, PropertyMeta,
  ExpressionValidationIssue, ExpressionValidationResult,
  ValidationErrorKind, ValidationSeverity, ValidateHelpers,
} from "./validate.js";

export type {
  ExprNode, AstNode, AstPath,
  BinaryOp, UnaryOp, ScalarValue,
} from "./ast.js";
export type {
  Dialect, ScopeDef, FunctionDef, EvalContext, EvalHelpers, ReturnType,
} from "./dialect.js";

/** A compiled expression envelope: canonical source + pre-derived tagged-tuple AST. */
export interface Expression {
  src: string;
  ast: AstNode;
}

/**
 * Parse a source string and package it as the bundle's `{ src, ast }` envelope.
 * The runtime never calls this - compiled bundles already carry the AST; this
 * is for the publish/compile step.
 *
 * Throws ParseError when the source can't be parsed.
 */
export function compile(src: string, dialect: Dialect): Expression {
  return { src, ast: serialiseAst(parse(src, dialect)) };
}
