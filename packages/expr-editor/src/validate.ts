// ---------------------------------------------------------------------------
// Validation wrapper over @wildwinter/expr's parseAndValidate, plus an
// issue-by-path index so the renderer can ring the offending pill. A parse error
// (kind "unparseable") is what drives the host into the raw-text fallback.
// ---------------------------------------------------------------------------

import { parseAndValidate } from "@wildwinter/expr";
import type {
  ExprNode, AstPath, Dialect, ExpressionSchema, ExpressionValidationIssue, ExpressionValidationResult,
} from "@wildwinter/expr";

export type { ExpressionValidationIssue, ExpressionValidationResult } from "@wildwinter/expr";

/** Stable string key for an AST path (for the issue index). */
export const pathKey = (p: AstPath): string => p.join("/");

export interface Validation extends ExpressionValidationResult {
  ast: ExprNode | null;
  /** Issues keyed by `pathKey(issue.path)`. */
  byPath: Map<string, ExpressionValidationIssue[]>;
  /** True when the source could not even be parsed (the editor should fall back to raw text). */
  unparseable: boolean;
}

export function validateSource(src: string, schema: ExpressionSchema, dialect: Dialect): Validation {
  const r = parseAndValidate(src, schema, dialect);
  const byPath = new Map<string, ExpressionValidationIssue[]>();
  for (const issue of r.issues) {
    const k = pathKey(issue.path);
    const list = byPath.get(k) ?? [];
    list.push(issue);
    byPath.set(k, list);
  }
  const unparseable = r.issues.some((i) => i.kind === "unparseable");
  return { ...r, byPath, unparseable };
}

/** Issues attached to a specific node path. */
export const issuesAt = (byPath: Map<string, ExpressionValidationIssue[]>, path: AstPath): ExpressionValidationIssue[] =>
  byPath.get(pathKey(path)) ?? [];
