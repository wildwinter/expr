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
import { el, openPopover } from "./dom.js";
import type { CatalogueEntry } from "./schema.js";
import type { EditCtx } from "./types.js";
import type { EditorEffect } from "./effects.js";

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
function frozenCtx(src: string, o: PreviewOptions): { ctx: EditCtx; ast: ExprNode | null } {
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
    ...(o.nodeLabel ? { nodeLabel: o.nodeLabel } : {}),
    ...(o.propertyActions ? {
      propertyActions: o.propertyActions,
      openMenu: (anchor, render) => { openPopover(anchor, render, { container: o.popoverContainer }); },
    } : {}),
  };
  return { ctx, ast: v.ast };
}

/** Pills for one expression string (a condition, or an effect's value / arg). Unparseable -> raw text. */
function exprPills(src: string, o: PreviewOptions): HTMLElement {
  const { ctx, ast } = frozenCtx(src, o);
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

/** Read-only pill strip for an effects list: each `set` as `target = value`, each `emit` as
 *  `emit event(args…)`, one per line. */
export function renderEffectsPreview(effects: EditorEffect[], o: PreviewOptions): HTMLElement {
  const wrap = el("div", "exed-preview exed-preview-effects");
  for (const eff of effects) {
    const row = el("div", "exed-preview-eff");
    if (eff.kind === "set") {
      row.append(el("span", "exed-pill exed-pill-prop", [eff.target || "(property)"]));
      row.append(el("span", "exed-effect-eq", ["="]));
      row.append(exprPills(eff.value, o));
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
