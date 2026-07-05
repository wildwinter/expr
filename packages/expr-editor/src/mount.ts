// ---------------------------------------------------------------------------
// mountExpressionEditor — the public, framework-neutral entry. Mounts the hybrid
// tree / flat / raw-text editor into a host element, parses the name-form `value`
// to an ExprNode, and emits name-form on every mutation. Scopes, properties and
// the function templates are injected, so it is tool-agnostic.
// ---------------------------------------------------------------------------

import { unparse } from "@wildwinter/expr";
import type { ExprNode, BinaryOp, Dialect, ExpressionSchema, AstPath } from "@wildwinter/expr";
import { boolLit, binary, numLit, scopedVar } from "./ast.js";
import { validateSource } from "./validate.js";
import { ARITHMETIC_OPS, BINARY_LABEL } from "./ops.js";
import type { CatalogueEntry } from "./schema.js";
import { el, button, textField, openPopover, type Popover } from "./dom.js";
import { renderNode, propertyPicker } from "./flat.js";
import { renderTree, clauseMenu, requestFocusForInsert } from "./treeview.js";
import type { EditCtx, FunctionTemplateSpec } from "./types.js";

export type { FunctionTemplateSpec } from "./types.js";

export interface ExpressionEditorOptions {
  /** Current expression in name-form (`@gold > 0 and @met`); "" = always / empty. */
  value: string;
  schema: ExpressionSchema;
  dialect: Dialect;
  /** Properties the picker offers. */
  catalogue: CatalogueEntry[];
  /** Scope display order for the picker groups. */
  scopeOrder?: string[];
  /** Dialect-specific clause templates (beyond the generic property comparisons). */
  functions?: FunctionTemplateSpec[];
  /** "tree" (default) for conditions, "flat" for a single inline expression. */
  mode?: "tree" | "flat";
  /** Flat mode only: show an optional "+ term" affordance that extends the value with one more term -
   *  type-led: "arithmetic" extends a number (`5` → `5 + @bonus`); "boolean" extends a true/false value
   *  with a logical term (`true` → `true and @met`). Omit for text / enum (no meaningful extension). */
  addTerm?: "arithmetic" | "boolean";
  /** Label for the empty/always pill (default "always"). */
  nullLabel?: string;
  /** Host picker for flow-node reference args (seen/visits); renders those args as a node pill. */
  pickNode?: EditCtx["pickNode"];
  /** Resolve a node id to a readable label for node-ref pills. */
  nodeLabel?: EditCtx["nodeLabel"];
  /** Start in raw-text mode (the host's global "show as text" toggle drives this; no inline `</>`). */
  text?: boolean;
  /** Render the editor's own validation message list under the pills (default true).
   *  Hosts that display their own validation messages pass false to avoid doubling up. */
  messages?: boolean;
  /** Where to append the popover micro-editors (default document.body). Pass a
   *  container inside a focus-trapping dialog (Radix, etc.) so opening a pill's
   *  popover does not dismiss the surrounding dialog. */
  popoverContainer?: HTMLElement;
  /** Emitted on every edit (name-form; "" when cleared). */
  onChange: (src: string) => void;
  /** Notified when the author starts (true) / stops (false) editing inside a popover
   *  micro-editor — lets the host suppress its own validation display mid-edit. */
  onEditingChange?: (editing: boolean) => void;
}

export interface ExpressionEditorHandle {
  setValue(v: string): void;
  /** Flip between the pill view and the raw-text view (driven by the host's global toggle). */
  setText(on: boolean): void;
  destroy(): void;
}

export function mountExpressionEditor(host: HTMLElement, opts: ExpressionEditorOptions): ExpressionEditorHandle {
  const defaultScope = opts.dialect.defaultScope;
  let src = opts.value ?? "";
  let raw = opts.text ?? false; // raw-text view (host-driven) / forced when unparseable
  let activePopover: Popover | null = null;
  let editing = false;
  let pendingFocus: AstPath | null = null; // pill to auto-open after the next render
  host.classList.add("exed-root");

  const emit = (next: string): void => { src = next; opts.onChange(src); render(); };
  const toSrc = (ast: ExprNode | null): string => (ast ? unparse(ast, { defaultScope }) : "");

  const setEditing = (on: boolean): void => {
    if (on === editing) return;
    editing = on;
    opts.onEditingChange?.(on);
  };
  const closePopover = (): void => { activePopover?.close(); activePopover = null; };

  function buildCtx(ast: ExprNode): EditCtx {
    const v = validateSource(src, opts.schema, opts.dialect);
    return {
      schema: opts.schema, dialect: opts.dialect, defaultScope,
      catalogue: opts.catalogue, scopeOrder: opts.scopeOrder ?? [], functions: opts.functions ?? [],
      byPath: v.byPath,
      getAst: () => ast,
      apply: (next) => emit(toSrc(next)),
      openPopover: (anchor, r) => {
        closePopover();
        const pop = openPopover(anchor, r, {
          container: opts.popoverContainer,
          onClose: () => {
            if (activePopover === pop) activePopover = null;
            setEditing(false);
          },
        });
        activePopover = pop;
        setEditing(true);
      },
      requestFocus: (p) => { pendingFocus = p; },
      ...(opts.pickNode ? { pickNode: opts.pickNode } : {}),
      ...(opts.nodeLabel ? { nodeLabel: opts.nodeLabel } : {}),
    };
  }

  function render(): void {
    closePopover();
    host.replaceChildren();
    const v = validateSource(src, opts.schema, opts.dialect);

    if (raw || v.unparseable) {
      host.append(rawArea());
    } else if (!src.trim() || !v.ast) {
      host.append(emptyState());
    } else {
      const ctx = buildCtx(v.ast);
      const body = el("div", "exed-body");
      if ((opts.mode ?? "tree") === "flat") {
        const flat = el("div", "exed-flat", [renderNode(v.ast, [], ctx)]);
        if (opts.addTerm) flat.append(addTermControl(ctx)); // optional "+ term" for values
        body.append(flat);
      } else body.append(renderTree(ctx));
      host.append(body);
    }

    if ((opts.messages ?? true) && (!v.unparseable || src.trim())) host.append(messages(v.issues));

    // Insert-then-refine follow-through: a template just inserted a clause with an
    // unfilled slot — open that pill's micro-editor so the author lands in it.
    if (pendingFocus) {
      const key = pendingFocus.join("/");
      pendingFocus = null;
      host.querySelector<HTMLElement>(`[data-exed-path="${key}"]`)?.click();
    }
  }

  // --- chrome ---------------------------------------------------------------

  function rawArea(): HTMLElement {
    const ta = el("textarea", "exed-raw");
    ta.value = src;
    ta.placeholder = "@gold > 0 and @met_anna";
    ta.rows = 2;
    ta.addEventListener("input", () => {
      src = ta.value; opts.onChange(src);
      msgHost.replaceChildren(messages(validateSource(src, opts.schema, opts.dialect).issues));
    });
    const msgHost = el("div", "exed-rawmsg");
    const wrap = el("div", "exed-rawwrap", [ta, msgHost]);
    return wrap;
  }

  function emptyState(): HTMLElement {
    const wrap = el("div", "exed-empty");
    wrap.append(el("span", "exed-pill exed-pill-always", [opts.nullLabel ?? "always"]));
    const ctx = buildCtx(boolLit(true));
    wrap.append(button("exed-add", "+ Add your first condition", (e) => {
      clauseMenu(ctx, e.currentTarget as HTMLElement, (node) => {
        requestFocusForInsert(ctx, node, []); // the clause becomes the root
        emit(toSrc(node));
      });
    }));
    return wrap;
  }

  /** The optional "+ term" affordance (flat value mode): extend the value with one more arithmetic
   *  term. Pick the operator (default +) and an operand (a number, or a property), and the whole
   *  current value is wrapped left: `5` → `5 + 1`. NOT a forced step - just an "add one more" chip. */
  function addTermControl(ctx: EditCtx): HTMLElement {
    // Type-led: a boolean value extends with a logical term (and / or + a true/false or boolean property);
    // a number extends with an arithmetic term (+ − × ÷ + a number or numeric property).
    const boolean = opts.addTerm === "boolean";
    const ops: BinaryOp[] = boolean ? ["and", "or"] : ARITHMETIC_OPS;
    const operandType = boolean ? "boolean" : "number";
    return button("exed-add exed-addterm", "+ term", (e) => {
      const anchor = e.currentTarget as HTMLElement;
      let op: BinaryOp = ops[0]!;
      ctx.openPopover(anchor, (close) => {
        const wrap = el("div", "exed-menu");
        wrap.append(el("div", "exed-menu-head", ["Add term"]));
        const commit = (operand: ExprNode): void => { ctx.apply(binary(op, ctx.getAst(), operand)); close(); };
        const opRow = el("div", "exed-field-row");
        const drawOps = (): void => {
          opRow.replaceChildren();
          for (const o of ops) opRow.append(button(`exed-opt${o === op ? " sel" : ""}`, BINARY_LABEL[o], () => { op = o; drawOps(); }));
        };
        drawOps();
        wrap.append(opRow);
        if (boolean) {
          const row = el("div", "exed-field-row");
          row.append(button("exed-opt", "true", () => commit(boolLit(true))), button("exed-opt", "false", () => commit(boolLit(false))));
          wrap.append(row);
        } else {
          wrap.append(textField({
            caption: "by", placeholder: "e.g. 1",
            validate: (v) => v.trim() !== "" && Number.isFinite(Number(v)),
            onCommit: (v) => commit(numLit(Number(v))),
          }));
        }
        wrap.append(button("exed-opt", "…or a property", () => {
          ctx.openPopover(anchor, (c2) => propertyPicker(ctx, { accept: [operandType], onPick: (en) => { commit(scopedVar(en.scope, en.name)); c2(); } }));
        }));
        return wrap;
      });
    }, boolean ? "add a logical term" : "add an arithmetic term");
  }

  function messages(issues: ReturnType<typeof validateSource>["issues"]): HTMLElement {
    const box = el("div", "exed-msgs");
    for (const i of issues) {
      box.append(el("div", `exed-msg exed-msg-${i.severity}`, [i.severity === "error" ? "⚠ " : "△ ", i.message]));
    }
    return box;
  }

  render();
  return {
    setValue: (v) => { src = v ?? ""; render(); }, // text mode is host-driven; don't reset it here
    setText: (on) => { raw = on; render(); },
    destroy: () => { closePopover(); host.replaceChildren(); host.classList.remove("exed-root"); },
  };
}
