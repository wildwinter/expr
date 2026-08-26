// ---------------------------------------------------------------------------
// Read-only PILL previews of a condition / an effects list, for surfaces that
// show the value compactly (e.g. an inspector row) but want the same pill
// rendering as the editor - so non-coders read pills everywhere, not name-form
// text. The pills are non-interactive (pointer-events suppressed in CSS), so a
// click falls through to whatever wraps the preview (typically a "open editor"
// button). The host keeps a `</>` text fallback for the raw name-form.
// ---------------------------------------------------------------------------

import type { Dialect, ExprNode, ExpressionSchema } from "@wildwinter/expr";
import { validateSource } from "./validate.js";
import { renderNode } from "./flat.js";
import { el, openPopover, propertyMenuBody } from "./dom.js";
import { propertyTip, refOf, type CatalogueEntry } from "./schema.js";
import type { EditCtx } from "./types.js";
import { isSelfAdvance, type EditorEffect } from "./effects.js";

export interface PreviewOptions {
  schema: ExpressionSchema;
  dialect: Dialect;
  catalogue: CatalogueEntry[];
  scopeOrder?: string[];
  /** Resolve a node id to a readable label for seen()/visits() node pills. */
  nodeLabel?: (id: string) => string;
  /** Host actions for a property pill (e.g. "Go to definition"). When set, the
   *  preview becomes right-click interactive on property pills (left-click still
   *  falls through to the host); otherwise the preview is fully non-interactive. */
  propertyActions?(ref: { scope: string; name: string }): Array<{ label: string; run: () => void }>;
  /** Where the property menu mounts (default document.body). */
  popoverContainer?: HTMLElement;
}

/** A frozen edit-context: enough for `renderNode` to draw pills, but every editing hook is a no-op
 *  (the preview is non-interactive for left-click). `pickNode` is stubbed so node-ref args still
 *  render as labelled node pills. When `propertyActions` is set, `openMenu` opens a real popover so
 *  the property right-click menu works while left-click editing stays inert (openPopover no-op). */
function frozenCtx(src: string, o: PreviewOptions, selfAdvanceRef?: string): { ctx: EditCtx; ast: ExprNode | null } {
  const v = validateSource(src, o.schema, o.dialect);
  const ctx: EditCtx = {
    schema: o.schema, dialect: o.dialect, defaultScope: o.dialect.defaultScope,
    catalogue: o.catalogue, scopeOrder: o.scopeOrder ?? [], functions: [],
    compact: true,
    byPath: v.byPath,
    getAst: () => v.ast as ExprNode,
    apply: () => {},
    openPopover: () => {},
    pickNode: () => {}, // enables labelled node pills; never fires (preview is read-only)
    ...(selfAdvanceRef ? { selfAdvanceRef } : {}),
    ...(o.nodeLabel ? { nodeLabel: o.nodeLabel } : {}),
    ...(o.propertyActions ? {
      propertyActions: o.propertyActions,
      openMenu: (anchor, render) => { openPopover(anchor, render, { container: o.popoverContainer }); },
    } : {}),
  };
  return { ctx, ast: v.ast };
}

/** Pills for one expression string (a condition, or an effect's value / arg). Unparseable -> raw text. */
function exprPills(src: string, o: PreviewOptions, selfAdvanceRef?: string): HTMLElement {
  const { ctx, ast } = frozenCtx(src, o, selfAdvanceRef);
  return ast ? renderNode(ast, [], ctx) : el("span", "exed-preview-raw", [src]);
}

/** Read-only pill strip for a condition (name-form). Empty/unparseable is the caller's concern; a
 *  non-empty unparseable string falls back to its raw text. */
export function renderConditionPreview(src: string, o: PreviewOptions): HTMLElement {
  // With propertyActions the preview is right-click interactive (a class enables
  // pointer events on property pills); without, it stays fully non-interactive.
  const cls = o.propertyActions ? "exed-preview exed-preview-interactive" : "exed-preview";
  return el("div", cls, [exprPills(src, o)]);
}

/** The set row's TARGET pill, which is a property like any other and was the one that never said so:
 *  the value pills go through the renderer and pick up the tip and the menu on the way, while this
 *  one was built here as bare text. It is the property being WRITTEN, so on an inspector row it is
 *  the first thing a reader asks about. */
function targetPill(ref: string, o: PreviewOptions): HTMLElement {
  const pill = el("span", "exed-pill exed-pill-prop", [ref || "(property)"]);
  const entry = o.catalogue.find((e) => refOf(e, o.dialect.defaultScope) === ref);
  if (!entry) return pill;
  const tip = propertyTip(entry);
  if (tip) pill.title = tip;
  const actions = o.propertyActions?.({ scope: entry.scope, name: entry.name }) ?? [];
  if (actions.length) pill.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    openPopover(pill, (close) => propertyMenuBody(actions, close), { container: o.popoverContainer });
  });
  return pill;
}

/** Read-only pill strip for an effects list: each `set` as `target = value`, each `emit` as
 *  `emit event(args…)`, one per line. */
export function renderEffectsPreview(effects: EditorEffect[], o: PreviewOptions): HTMLElement {
  // Same rule as the condition preview: with host actions the pills accept a right-click, without
  // them the whole strip stays inert and a click falls through to the row's "open editor" control.
  const wrap = el("div", `exed-preview exed-preview-effects${o.propertyActions ? " exed-preview-interactive" : ""}`);
  for (const eff of effects) {
    const row = el("div", "exed-preview-eff");
    if (eff.kind === "set") {
      // `debt = advance(debt)` reads the property three times; when a set advances its own target the
      // row loses the `=` and the call becomes one word, so it reads `debt advances`. This is the half
      // the read surfaces need: outcome lists and inspector rows all come through here.
      const advances = isSelfAdvance(eff, o.dialect.defaultScope, o.dialect);
      row.append(targetPill(eff.target, o));
      if (!advances) row.append(el("span", "exed-effect-eq", ["="]));
      row.append(exprPills(eff.value, o, advances ? eff.target : undefined));
    } else {
      row.append(el("span", "exed-effect-kw", ["emit"]));
      row.append(el("span", "exed-pill exed-pill-event", [eff.event ? `"${eff.event}"` : "(name)"]));
      row.append(el("span", "exed-paren", ["("]));
      eff.args.forEach((a, i) => {
        if (i > 0) row.append(el("span", "exed-comma", [", "]));
        row.append(exprPills(a, o));
      });
      row.append(el("span", "exed-paren", [")"]));
    }
    wrap.append(row);
  }
  return wrap;
}
