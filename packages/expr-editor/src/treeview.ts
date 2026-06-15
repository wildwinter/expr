// ---------------------------------------------------------------------------
// The tree chrome: render the derived TreeRow model as nested AND/OR groups +
// leaf rows, with per-row NOT / move / delete, container op-flip + NOT, and the
// "+ Add condition" / "+ Add group" affordances. Each leaf delegates its content
// to the flat pill editor (flat.ts). Ported from the storylets tree editor.
// ---------------------------------------------------------------------------

import type { ExprNode, AstPath } from "@wildwinter/expr";
import {
  deleteAt, binary, scopedVar, strLit, isPlaceholderForOp, getNodeAt as getNode, setNodeAt,
} from "./ast.js";
import {
  astToTree, addChildToContainer, flipContainerOp, toggleContainerNot, buildSubGroupClause, moveChildInContainer,
  redirectDeleteForPlaceholderSibling, type TreeRow,
} from "./tree.js";
import { el, button } from "./dom.js";
import { renderNode } from "./flat.js";
import { comparisonWizard, booleanWizard, checkFlagsWizard, randomWizard, type ClauseWizardCtx } from "./clausewizard.js";
import type { EditCtx, FunctionTemplateSpec } from "./types.js";

/** Render the whole expression as a tree into a fresh element. */
export function renderTree(ctx: EditCtx): HTMLElement {
  const row = astToTree(ctx.getAst(), []);
  const wrap = el("div", "exed-tree");
  wrap.append(renderRow(ctx, row, { root: true }));
  // A single-condition root has no container add-bar of its own; give it one so it can grow.
  if (row.kind !== "container") wrap.append(rootAddBar(ctx));
  return wrap;
}

interface RowEnv { root?: boolean; index?: number; count?: number; chainPath?: AstPath; }

function renderRow(ctx: EditCtx, row: TreeRow, env: RowEnv): HTMLElement {
  if (row.kind === "container") return renderContainer(ctx, row, env);
  return renderLeaf(ctx, row, env);
}

function notToggle(ctx: EditCtx, path: AstPath): HTMLButtonElement {
  return button("exed-rowbtn", "NOT", () => ctx.apply(toggleContainerNot(ctx.getAst(), path)), "toggle NOT");
}

function rowActions(ctx: EditCtx, row: TreeRow, env: RowEnv): HTMLElement {
  const acts = el("div", "exed-rowacts");
  acts.append(notToggle(ctx, row.path));
  if (env.chainPath && env.count != null && env.index != null) {
    if (env.index > 0) acts.append(button("exed-rowbtn", "↑", () => ctx.apply(moveChildInContainer(ctx.getAst(), env.chainPath!, env.index!, env.index! - 1)), "move up"));
    if (env.index < env.count - 1) acts.append(button("exed-rowbtn", "↓", () => ctx.apply(moveChildInContainer(ctx.getAst(), env.chainPath!, env.index!, env.index! + 1)), "move down"));
  }
  acts.append(button("exed-rowbtn danger", "✕", () => {
    if (env.root) { ctx.apply(null); return; }
    // If this row's AST sibling is a temp group placeholder, collapse the whole
    // half-filled sub-group instead of leaving the placeholder (`true`/`false`)
    // floating up as a bare clause.
    const target = redirectDeleteForPlaceholderSibling(ctx.getAst(), row.path);
    ctx.apply(deleteAt(ctx.getAst(), target));
  }, "delete"));
  return acts;
}

function renderLeaf(ctx: EditCtx, row: Extract<TreeRow, { kind: "comparison" | "wrapped" }>, env: RowEnv): HTMLElement {
  // A placeholder sentinel renders as a dashed "click to add" row.
  if (row.kind === "wrapped" && (isPlaceholderForOp(row.node, "and") || isPlaceholderForOp(row.node, "or"))) {
    return placeholderRow(ctx, row.path);
  }
  const line = el("div", "exed-row");
  if (row.negated) line.append(el("span", "exed-not", ["NOT"]));
  const content = row.kind === "comparison"
    ? renderNode(nodeAtContent(ctx, row.contentPath), row.contentPath, ctx)
    : renderNode(row.node, row.contentPath, ctx);
  line.append(el("span", "exed-rowcontent", [content]));
  line.append(rowActions(ctx, row, env));
  return line;
}

const nodeAtContent = (ctx: EditCtx, path: AstPath): ExprNode => {
  // For a comparison row the content is the binary at contentPath.
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return getNode(ctx.getAst(), path)!;
};

function renderContainer(ctx: EditCtx, row: Extract<TreeRow, { kind: "container" }>, env: RowEnv): HTMLElement {
  const box = el("div", `exed-group exed-group-${row.op}`);
  const head = el("div", "exed-grouphead");
  if (row.negated) head.append(el("span", "exed-not", ["NOT"]));
  // Root container can flip op; a sub-group's op is fixed (flipping would dissolve it).
  const label = row.op === "and" ? "ALL OF THESE:" : "ANY OF THESE:";
  if (env.root) {
    head.append(button("exed-flip", label, () => ctx.apply(flipContainerOp(ctx.getAst(), row.chainPath, row.op === "and" ? "or" : "and")), "switch AND / OR"));
  } else {
    head.append(el("span", "exed-grouplabel", [label]));
  }
  const headActs = el("div", "exed-rowacts");
  headActs.append(notToggle(ctx, row.path));
  if (!env.root) headActs.append(button("exed-rowbtn danger", "✕", () => ctx.apply(deleteAt(ctx.getAst(), row.path)), "delete group"));
  head.append(headActs);
  box.append(head);

  const body = el("div", "exed-groupbody");
  row.children.forEach((child, i) => {
    // Each child sits in a flex row with a left-gutter AND/OR connector, so the
    // chain reads as a sentence ("X · AND · Y · AND · Z"). The first child has an
    // empty gutter (keeps every row's content column-aligned).
    const childRow = el("div", "exed-child");
    childRow.append(el("span", "exed-connector", [i === 0 ? "" : row.op.toUpperCase()]));
    childRow.append(renderRow(ctx, child, { index: i, count: row.children.length, chainPath: row.chainPath }));
    body.append(childRow);
  });
  body.append(addBar(ctx, row.chainPath, row.op));
  box.append(body);
  return box;
}

function placeholderRow(ctx: EditCtx, path: AstPath): HTMLElement {
  const b = button("exed-placeholder", "Click to add condition", (e) => {
    clauseMenu(ctx, e.currentTarget as HTMLElement, (node) => ctx.apply(replaceAt(ctx, path, node)));
  });
  return b;
}

/** "+ condition" and "+ AND/OR group" controls for a container chain. */
function addBar(ctx: EditCtx, chainPath: AstPath, op: "and" | "or"): HTMLElement {
  const bar = el("div", "exed-addbar");
  bar.append(button("exed-add", "+ Add condition", (e) => {
    clauseMenu(ctx, e.currentTarget as HTMLElement, (node) => ctx.apply(addChildToContainer(ctx.getAst(), chainPath, node)));
  }));
  bar.append(button("exed-add", `+ Add ${op === "and" ? "OR" : "AND"} group`, () => {
    ctx.apply(addChildToContainer(ctx.getAst(), chainPath, buildSubGroupClause(op, seedClause(ctx))));
  }, "add a nested group"));
  return bar;
}

/** The root add-bar (for a single-condition or empty root): grows it into a chain. */
export function rootAddBar(ctx: EditCtx): HTMLElement {
  const bar = el("div", "exed-addbar");
  bar.append(button("exed-add", "+ Add condition", (e) => {
    clauseMenu(ctx, e.currentTarget as HTMLElement, (node) => ctx.apply(addChildToContainer(ctx.getAst(), [], node)));
  }));
  bar.append(button("exed-add", "+ Add group", () => {
    ctx.apply(addChildToContainer(ctx.getAst(), [], buildSubGroupClause("and", seedClause(ctx))));
  }));
  return bar;
}

// --- clause templates --------------------------------------------------------

/** A sensible first clause: the first property compared to an empty value, else `true`. */
export function seedClause(ctx: EditCtx): ExprNode {
  const first = ctx.catalogue[0];
  if (!first) return { kind: "bool", value: true };
  if (first.type === "boolean") return scopedVar(first.scope, first.name);
  return binary("==", scopedVar(first.scope, first.name), first.type === "number" ? { kind: "number", value: 0 } : strLit(""));
}

/** The "+ Add condition" template menu: generic property clauses + the dialect's functions. */
export function clauseMenu(ctx: EditCtx, anchor: HTMLElement, onPick: (node: ExprNode) => void): void {
  ctx.openPopover(anchor, (close) => {
    const wrap = el("div", "exed-menu");
    wrap.append(el("div", "exed-menu-head", ["Add a clause"]));
    const add = (label: string, hint: string | undefined, make: () => void, disabled = false): void => {
      const b = button(`exed-opt${disabled ? " disabled" : ""}`, "", () => { if (disabled) return; make(); close(); });
      if (disabled) b.disabled = true;
      b.append(el("span", "exed-opt-name", [label]));
      if (hint) b.append(el("span", "exed-opt-purpose", [hint]));
      wrap.append(b);
    };
    // Launch a guided wizard into a fresh popover, committing the built clause.
    const wctx: ClauseWizardCtx = { catalogue: ctx.catalogue, scopeOrder: ctx.scopeOrder, defaultScope: ctx.defaultScope };
    const launch = (run: (host: HTMLElement, w: ClauseWizardCtx, commit: (n: ExprNode) => void, cancel: () => void) => void): void => {
      ctx.openPopover(anchor, (close2) => {
        const host = el("div", "exed-vwiz");
        run(host, wctx, (node) => { onPick(node); close2(); }, close2);
        return host;
      });
    };
    const addFn = (fn: FunctionTemplateSpec): void => add(fn.label, fn.hint, () => {
      if (fn.wizard === "check_flags") launch(checkFlagsWizard);
      else if (fn.wizard === "random") launch(randomWizard);
      else onPick(fn.build());
    }, !!fn.disabled);
    // Dialect flag functions lead (matching storylets' menu), then the generic
    // property clauses, then the remaining dialect functions.
    const flagFns = ctx.functions.filter((f) => f.name === "check_flags");
    const otherFns = ctx.functions.filter((f) => f.name !== "check_flags");
    flagFns.forEach(addFn);
    add("Property comparison", "a property vs a value", () => launch(comparisonWizard));
    add("Property is true", "a boolean property on its own", () => launch(booleanWizard));
    otherFns.forEach(addFn);
    return wrap;
  });
}

// keep the template list reusable for the host
export type { FunctionTemplateSpec };

const replaceAt = (ctx: EditCtx, path: AstPath, node: ExprNode): ExprNode => setNodeAt(ctx.getAst(), path, node);
