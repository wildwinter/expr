// ---------------------------------------------------------------------------
// Validation - static checks of a parsed AST against a property schema.
//
// Issues are keyed to AST node paths so a consumer (e.g. a pill renderer) can
// highlight the offending term in place; each also carries a human-readable
// message, and the result composes a `summary`.
//
// Generic core: scope/property resolution, function arity, operand-type
// checking, division-by-zero, and enum-value compares. Function-specific rules
// (e.g. non-empty tag args, flags-call shape) are supplied by each Dialect
// FunctionDef's optional `validate` hook.
//
// Ported from @storylets/expressions (storylets/packages/expressions/src/validate.ts),
// generalised by injecting functions + defaultScope from the Dialect.
// ---------------------------------------------------------------------------

import type { AstPath, BinaryOp, ExprNode, UnaryOp } from "./ast.js";
import type { Dialect, ReturnType } from "./dialect.js";
import { parse } from "./parser.js";

/** Property value types a schema can declare. */
export type PropertyType = "boolean" | "number" | "string" | "enum" | "flags";

export interface PropertyMeta {
  type: PropertyType;
  enumValues?: string[];
}

export interface ExpressionSchema {
  /**
   * Property metadata keyed by scope token, then by property name (lowercase).
   * A scope absent from the map is "unknown" - references to it are not flagged
   * (the dialect/parser still constrains which scope tokens are legal).
   */
  properties: Map<string, Map<string, PropertyMeta>>;
}

export type ValidationErrorKind =
  | "unparseable"
  | "unresolved-property"
  | "unresolved-scoped-property"
  | "unknown-function"
  | "unknown-enum-value"
  | "unknown-flag-name"
  | "wrong-arg-count"
  | "wrong-arg-type"
  | "empty-string-arg"
  | "operand-type-mismatch"
  | "division-by-zero";

export type ValidationSeverity = "error" | "warning";

export interface ExpressionValidationIssue {
  path: AstPath;
  kind: ValidationErrorKind;
  severity: ValidationSeverity;
  message: string;
  reference?: string;
}

export interface ExpressionValidationResult {
  ok: boolean;
  issues: readonly ExpressionValidationIssue[];
  summary: string;
}

/** Helpers passed to a FunctionDef's optional `validate` hook. */
export interface ValidateHelpers {
  schema: ExpressionSchema;
  /** Path to the call node (build child paths with [...path, "args", i]). */
  path: AstPath;
  /** The dialect's default scope (bare `@name`). */
  defaultScope: string;
  report: (issue: ExpressionValidationIssue) => void;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function validateExpressionAst(
  node: ExprNode,
  schema: ExpressionSchema,
  dialect: Dialect,
): ExpressionValidationResult {
  const issues: ExpressionValidationIssue[] = [];
  walkValidate(node, schema, dialect, [], issues);
  return finaliseResult(issues);
}

export function parseAndValidate(
  source: string,
  schema: ExpressionSchema,
  dialect: Dialect,
): ExpressionValidationResult & { ast: ExprNode | null } {
  if (!source.trim()) {
    return { ok: true, issues: [], summary: "", ast: null };
  }
  let ast: ExprNode;
  try {
    ast = parse(source, dialect);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const issue: ExpressionValidationIssue = { path: [], kind: "unparseable", severity: "error", message };
    return { ok: false, issues: [issue], summary: message, ast: null };
  }
  const result = validateExpressionAst(ast, schema, dialect);
  return { ...result, ast };
}

export function validateExpr(
  node: ExprNode,
  schema: ExpressionSchema,
  dialect: Dialect,
): readonly ExpressionValidationIssue[] {
  return validateExpressionAst(node, schema, dialect).issues;
}

// ---------------------------------------------------------------------------
// Internal: result composer + recursive walk
// ---------------------------------------------------------------------------

function finaliseResult(issues: ExpressionValidationIssue[]): ExpressionValidationResult {
  const hasError = issues.some((i) => i.severity === "error");
  const summary = issues.map((i) => i.message).join("; ");
  return { ok: !hasError, issues, summary };
}

function walkValidate(
  node: ExprNode,
  schema: ExpressionSchema,
  dialect: Dialect,
  path: AstPath,
  issues: ExpressionValidationIssue[],
): void {
  switch (node.kind) {
    case "bool":
    case "number":
    case "string":
    case "flagdelta":
      return;

    case "scopedvar": {
      const scopeMap = schema.properties.get(node.scope);
      if (scopeMap && !scopeMap.has(node.name)) {
        const isDefault = node.scope === dialect.defaultScope;
        issues.push({
          path,
          kind: isDefault ? "unresolved-property" : "unresolved-scoped-property",
          severity: "error",
          message: isDefault
            ? `unresolved property reference '@${node.name}'`
            : `unresolved ${node.scope} property reference '@${node.scope}.${node.name}'`,
          reference: isDefault ? node.name : `${node.scope}.${node.name}`,
        });
      }
      return;
    }

    case "call": {
      const def = dialect.functions[node.name];
      if (!def) {
        issues.push({ path, kind: "unknown-function", severity: "error", message: `unknown function '${node.name}'` });
        return;
      }
      if (node.args.length < def.minArgs) {
        issues.push({
          path, kind: "wrong-arg-count", severity: "error",
          message: `${node.name}() requires at least ${def.minArgs} argument(s), got ${node.args.length}`,
        });
      }
      if (def.maxArgs !== undefined && node.args.length > def.maxArgs) {
        issues.push({
          path, kind: "wrong-arg-count", severity: "error",
          message: `${node.name}() takes at most ${def.maxArgs} argument(s), got ${node.args.length}`,
        });
      }
      for (let i = 0; i < node.args.length; i++) {
        walkValidate(node.args[i]!, schema, dialect, [...path, "args", i], issues);
      }
      // Function-specific validation supplied by the dialect.
      if (def.validate) {
        def.validate(node.args, {
          schema,
          path,
          defaultScope: dialect.defaultScope,
          report: (issue) => issues.push(issue),
        });
      }
      return;
    }

    case "unary": {
      walkValidate(node.operand, schema, dialect, [...path, "operand"], issues);
      checkUnaryOperandType(node.op, node.operand, schema, dialect, [...path, "operand"], issues);
      return;
    }

    case "binary": {
      walkValidate(node.left, schema, dialect, [...path, "left"], issues);
      walkValidate(node.right, schema, dialect, [...path, "right"], issues);
      checkBinaryOperandTypes(node.op, node.left, node.right, schema, dialect, path, issues);
      if (node.op === "/" && node.right.kind === "number" && node.right.value === 0) {
        issues.push({
          path: [...path, "right"], kind: "division-by-zero", severity: "error",
          message: "division by zero - pick a non-zero divisor",
        });
      }
      if (node.op === "==" || node.op === "!=") {
        const left = node.left, right = node.right;
        let propNode: { kind: "scopedvar"; scope: string; name: string } | null = null;
        let strNode: { kind: "string"; value: string } | null = null;
        let strSide: "left" | "right" | null = null;
        if (left.kind === "scopedvar" && right.kind === "string") { propNode = left; strNode = right; strSide = "right"; }
        else if (right.kind === "scopedvar" && left.kind === "string") { propNode = right; strNode = left; strSide = "left"; }
        if (propNode && strNode && strSide) {
          const meta = schema.properties.get(propNode.scope)?.get(propNode.name);
          if (meta?.type === "enum" && meta.enumValues && !meta.enumValues.includes(strNode.value)) {
            issues.push({
              path: [...path, strSide], kind: "unknown-enum-value", severity: "error",
              message: `'${strNode.value}' is not a valid value for this property - expected one of: ${meta.enumValues.join(", ")}`,
              reference: strNode.value,
            });
          }
        }
      }
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// Operand-type checking
// ---------------------------------------------------------------------------

type InferredType = "boolean" | "number" | "string" | "flags" | "unknown";

function inferredFromPropertyType(t: PropertyType): InferredType {
  if (t === "boolean") return "boolean";
  if (t === "number") return "number";
  if (t === "string" || t === "enum") return "string";
  if (t === "flags") return "flags";
  return "unknown";
}

function inferredFromReturn(t: ReturnType): InferredType {
  return t;
}

function typeOf(node: ExprNode, schema: ExpressionSchema, dialect: Dialect): InferredType {
  switch (node.kind) {
    case "bool": return "boolean";
    case "number": return "number";
    case "string": return "string";
    case "flagdelta": return "unknown";
    case "scopedvar": {
      const meta = schema.properties.get(node.scope)?.get(node.name);
      return meta ? inferredFromPropertyType(meta.type) : "unknown";
    }
    case "call": {
      const def = dialect.functions[node.name];
      return def ? inferredFromReturn(def.returnType) : "unknown";
    }
    case "unary":
      return node.op === "not" ? "boolean" : "number";
    case "binary":
      switch (node.op) {
        case "+": case "-": case "*": case "/": return "number";
        case "==": case "!=": case ">": case "<": case ">=": case "<=": case "and": case "or": return "boolean";
      }
  }
}

function describeType(t: InferredType): string {
  return t === "unknown" ? "unknown type" : t;
}

function checkBinaryOperandTypes(
  op: BinaryOp, left: ExprNode, right: ExprNode,
  schema: ExpressionSchema, dialect: Dialect, path: AstPath, issues: ExpressionValidationIssue[],
): void {
  const lt = typeOf(left, schema, dialect);
  const rt = typeOf(right, schema, dialect);

  if (op === "+" || op === "-" || op === "*" || op === "/" || op === ">" || op === "<" || op === ">=" || op === "<=") {
    if (lt !== "unknown" && lt !== "number")
      issues.push({ path: [...path, "left"], kind: "operand-type-mismatch", severity: "error", message: `'${op}' requires a number on the left, got ${describeType(lt)}` });
    if (rt !== "unknown" && rt !== "number")
      issues.push({ path: [...path, "right"], kind: "operand-type-mismatch", severity: "error", message: `'${op}' requires a number on the right, got ${describeType(rt)}` });
    return;
  }

  if (op === "and" || op === "or") {
    if (lt !== "unknown" && lt !== "boolean")
      issues.push({ path: [...path, "left"], kind: "operand-type-mismatch", severity: "error", message: `'${op}' requires a boolean on the left, got ${describeType(lt)}` });
    if (rt !== "unknown" && rt !== "boolean")
      issues.push({ path: [...path, "right"], kind: "operand-type-mismatch", severity: "error", message: `'${op}' requires a boolean on the right, got ${describeType(rt)}` });
    return;
  }

  if (op === "==" || op === "!=") {
    if (lt !== "unknown" && rt !== "unknown" && lt !== rt)
      issues.push({ path, kind: "operand-type-mismatch", severity: "error", message: `'${op}' compares ${describeType(lt)} with ${describeType(rt)}; the values can never be equal` });
  }
}

function checkUnaryOperandType(
  op: UnaryOp, operand: ExprNode,
  schema: ExpressionSchema, dialect: Dialect, path: AstPath, issues: ExpressionValidationIssue[],
): void {
  const t = typeOf(operand, schema, dialect);
  if (t === "unknown") return;
  if (op === "not" && t !== "boolean")
    issues.push({ path, kind: "operand-type-mismatch", severity: "error", message: `'not' requires a boolean operand, got ${describeType(t)}` });
  if (op === "neg" && t !== "number")
    issues.push({ path, kind: "operand-type-mismatch", severity: "error", message: `unary '-' requires a number, got ${describeType(t)}` });
}
