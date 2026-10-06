// ---------------------------------------------------------------------------
// The tree chrome: render the derived TreeRow model as nested AND/OR groups +
// leaf rows, with per-row NOT / move / delete, container op-flip + NOT, and the
// "+ Add condition" / "+ Add group" affordances. Each leaf delegates its content
// to the flat pill editor (flat.ts). Ported from the storylets tree editor.
// ---------------------------------------------------------------------------

import type { ExprNode, AstPath } from "@wildwinter/expr";
import {
  deleteAt, isPlaceholderForOp, getNodeAt as getNode, setNodeAt, firstEmptyLeafPath,
} from "./ast.js";
import {
  astToTree, addChildToContainer, flipContainerOp, toggleContainerNot, buildSubGroupClause, moveChildInContainer,
  redirectDeleteForPlaceholderSibling, type TreeRow,
} from "./tree.js";
import { el, button } from "./dom.js";
import { renderNode } from "./flat.js";
import { comparisonWizard, booleanWizard, checkFlagsWizard, randomWizard, genericWizard, type ClauseWizardCtx } from "./clausewizard.js";
import type { EditCtx, FunctionTemplateSpec } from "./types.js";

/** Ask the mount to auto-open the first unfilled slot of a just-inserted clause
 *  (insert-then-refine templates: the author lands straight in the empty tag /
 *  flag pill). `base` is where the clause sits in the post-insert AST. */
export function requestFocusForInsert(ctx: EditCtx, clause: ExprNode, base: AstPath): void {
  const rel = firstEmptyLeafPath(clause);
  if (rel) ctx.requestFocus?.([...base, ...rel]);
}

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

function notToggle(ctx: EditCtx, path: AstPath, pressed: boolean): HTMLButtonElement {
  const b = button("exed-rowbtn", "NOT", () => ctx.apply(toggleContainerNot(ctx.getAst(), path)), "toggle NOT", pressed ? "remove NOT" : "apply NOT");
  b.setAttribute("aria-pressed", String(pressed));
  return b;
}

function rowActions(ctx: EditCtx, row: TreeRow, env: RowEnv): HTMLElement {
  const acts = el("div", "exed-rowacts");
  acts.append(notToggle(ctx, row.path, row.negated));
  if (env.chainPath && env.count != null && env.index != null) {
    if (env.index > 0) acts.append(button("exed-rowbtn", "↑", () => ctx.apply(moveChildInContainer(ctx.getAst(), env.chainPath!, env.index!, env.index! - 1)), "move up", "move up"));
    if (env.index < env.count - 1) acts.append(button("exed-rowbtn", "↓", () => ctx.apply(moveChildInContainer(ctx.getAst(), env.chainPath!, env.index!, env.index! + 1)), "move down", "move down"));
  }
  acts.append(button("exed-rowbtn danger", "✕", () => {
    if (env.root) { ctx.apply(null); return; }
    // If this row's AST sibling is a temp group placeholder, collapse the whole
    // half-filled sub-group instead of leaving the placeholder (`true`/`false`)
    // floating up as a bare clause.
    const target = redirectDeleteForPlaceholderSibling(ctx.getAst(), row.path);
    ctx.apply(deleteAt(ctx.getAst(), target));
  }, "delete", "delete this condition"));
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
  headActs.append(notToggle(ctx, row.path, row.negated));
  if (!env.root) headActs.append(button("exed-rowbtn danger", "✕", () => ctx.apply(deleteAt(ctx.getAst(), row.path)), "delete group", "delete this group"));
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
    clauseMenu(ctx, e.currentTarget as HTMLElement, (node) => {
      requestFocusForInsert(ctx, node, path);
      ctx.apply(replaceAt(ctx, path, node));
    });
  });
  return b;
}

/** "+ condition" and "+ AND/OR group" controls for a container chain. */
function addBar(ctx: EditCtx, chainPath: AstPath, op: "and" | "or"): HTMLElement {
  const bar = el("div", "exed-addbar");
  bar.append(button("exed-add", "+ Add condition", (e) => {
    clauseMenu(ctx, e.currentTarget as HTMLElement, (node) => {
      // addChildToContainer appends as binary(op, chain, clause) at chainPath,
      // so the inserted clause lands at chainPath + "right".
      requestFocusForInsert(ctx, node, [...chainPath, "right"]);
      ctx.apply(addChildToContainer(ctx.getAst(), chainPath, node));
    });
  }));
  bar.append(button("exed-add", `+ Add ${op === "and" ? "OR" : "AND"} group`, (e) => {
    pickGroup(ctx, e.currentTarget as HTMLElement, op, (group) => {
      requestFocusForInsert(ctx, group, [...chainPath, "right"]);
      ctx.apply(addChildToContainer(ctx.getAst(), chainPath, group));
    });
  }, "add a nested group"));
  return bar;
}

/** The root add-bar (for a single-condition or empty root): grows it into a chain. */
export function rootAddBar(ctx: EditCtx): HTMLElement {
  const bar = el("div", "exed-addbar");
  bar.append(button("exed-add", "+ Add condition", (e) => {
    clauseMenu(ctx, e.currentTarget as HTMLElement, (node) => {
      requestFocusForInsert(ctx, node, ["right"]);
      ctx.apply(addChildToContainer(ctx.getAst(), [], node));
    });
  }));
  bar.append(button("exed-add", "+ Add group", (e) => {
    pickGroup(ctx, e.currentTarget as HTMLElement, "and", (group) => {
      requestFocusForInsert(ctx, group, ["right"]);
      ctx.apply(addChildToContainer(ctx.getAst(), [], group));
    });
  }));
  return bar;
}

// --- clause templates --------------------------------------------------------

/**
 * "+ Add group": the author picks the new group's first two conditions, from the same menu and
 * wizards "+ Add condition" offers, and only then is the group inserted, whole. A group of one
 * is no group (it flattens away), so it never exists half-built. Until October 2026 the button
 * seeded the group with the catalogue's first property compared with an empty value (to the
 * author, a random test) and a placeholder for the other side, which the editor drew as "Click
 * to add condition" and handed the host as `or false`, which the host then complained about.
 * Cancelling either step adds nothing.
 */
function pickGroup(ctx: EditCtx, anchor: HTMLElement, parentOp: "and" | "or", insert: (group: ExprNode) => void): void {
  // The group heads' own words ("Any of these" / "All of these"), so the menu says which group it is building.
  const which = parentOp === "and" ? "Any of these" : "All of these";
  clauseMenu(ctx, anchor, (first) => {
    clauseMenu(ctx, anchor, (second) => insert(buildSubGroupClause(parentOp, first, second)), `${which}: second condition`);
  }, `${which}: first condition`);
}

/** The "+ Add condition" template menu: generic property clauses + the dialect's functions.
 *  `heading` names what is being picked; "+ Add group" asks for each of its first two. */
export function clauseMenu(ctx: EditCtx, anchor: HTMLElement, onPick: (node: ExprNode) => void, heading = "Add a condition"): void {
  ctx.openPopover(anchor, (close) => {
    const wrap = el("div", "exed-menu");
    // "Condition", matching the button that opened this menu ("+ Add
    // condition" / "+ Add your first condition"): a Storyletter antagonist
    // audit (2026-08-29) counted three words for one concept at one
    // interaction site - the button said condition, this head said clause,
    // the table column said When. "Clause" was the precise word (a condition
    // is an AND of clauses) and precision lost to consistency.
    wrap.append(el("div", "exed-menu-head", [heading]));
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
      else if (fn.wizard && typeof fn.wizard === "object") {
        const spec = fn.wizard;
        launch((host, _w, commit, cancel) => genericWizard(host, spec, commit, cancel));
      } else onPick(fn.build());
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
