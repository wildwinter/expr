// Shared interfaces threaded through the UI: the editing context the renderers
// mutate the tree through, and the dialect-driven function-template spec.

import type { ExprNode, Dialect, ExpressionSchema, ExpressionValidationIssue, BinaryOp, AstPath } from "@wildwinter/expr";
import type { CatalogueEntry } from "./schema.js";

/** One step of a declarative clause wizard: a text entry, a number entry, or an
 *  operator pick. The generic runner walks the steps in order (with back/cancel
 *  chrome) and hands the collected values to the spec's `build()`. */
export type WizardStepSpec =
  | { kind: "string"; title: string; caption?: string; placeholder?: string }
  | { kind: "number"; title: string; caption?: string; placeholder?: string; initial?: number }
  /** Operator pick; `ops` defaults to the comparison set. */
  | { kind: "op"; title: string; ops?: BinaryOp[] };

export type WizardValue = string | number | BinaryOp;

/** A declarative multi-step wizard for a dialect function template. Lets a host
 *  add guided flows (e.g. tag -> operator -> threshold) without upstream code. */
export interface WizardSpec {
  steps: WizardStepSpec[];
  /** Build the finished clause from the step values (index-aligned with `steps`). */
  build(values: WizardValue[]): ExprNode;
}

/** A "+ Add condition" template — a named node the wizard inserts; args are then
 *  refined by clicking the resulting pills. Dialect-specific functions (e.g.
 *  patter's `seen` / `check_flags`) are supplied by the host as these. */
export interface FunctionTemplateSpec {
  name: string;
  label: string;
  hint?: string;
  /** Shown greyed and non-pickable (e.g. `check_flags` with no flags property
   *  declared) so the option's existence is still discoverable. */
  disabled?: boolean;
  /** When set, picking this template runs a guided multi-step wizard instead of
   *  inserting `build()` directly: one of the named built-ins (matching the
   *  storylets condition editor) or a declarative `WizardSpec`. */
  wizard?: "check_flags" | "random" | WizardSpec;
  /** Build the node to insert (used when there is no `wizard`, e.g. seen / visits insert-then-pick). */
  build(): ExprNode;
}

/** The editing context every renderer receives. */
export interface EditCtx {
  schema: ExpressionSchema;
  dialect: Dialect;
  defaultScope: string;
  catalogue: CatalogueEntry[];
  scopeOrder: string[];
  functions: FunctionTemplateSpec[];
  byPath: Map<string, ExpressionValidationIssue[]>;
  /** The current root AST (never null here; the empty/always state is handled by mount). */
  getAst(): ExprNode;
  /** Commit a new root AST (null clears the whole expression to "always"). */
  apply(next: ExprNode | null): void;
  /** Open a popover anchored to `anchor`; `render(close)` builds the content. */
  openPopover(anchor: HTMLElement, render: (close: () => void) => Node): void;
  /** Host-provided picker for a flow-node reference arg (e.g. `seen(...)` / `visits(...)`). When set,
   *  the node-ref arg renders as a pill that opens this instead of a free-text field; `onPick` receives
   *  the chosen node id. Absent in dialects / hosts that have no node catalogue. */
  pickNode?(anchor: HTMLElement, current: string, onPick: (id: string) => void): void;
  /** Resolve a node id to its readable label for the node-ref pill (falls back to the raw id). */
  nodeLabel?(id: string): string;
  /** Ask the mount to auto-open the micro-editor of the pill at `path` after the
   *  next render — used by insert-then-refine templates so the author lands
   *  straight in the first unfilled slot instead of chasing the error ring. */
  requestFocus?(path: AstPath): void;
  /** When true, a delete that would empty the whole expression is blocked (the
   *  Delete affordance is withheld). Used by single-value fields that must
   *  always hold at least one term; conditions leave it false (empty = always). */
  requireNonEmpty?: boolean;
  /** Enum values offered when editing the single root literal of a value field
   *  (an enum-typed outcome target). Lets the string editor show an enum picker
   *  even without a comparison peer. No effect on non-root literals. */
  valueEnumValues?: string[];
  /** Host actions for a property pill (e.g. "Go to definition"). When set,
   *  right-clicking a property pill opens a menu of these actions. The host
   *  resolves what each does (navigation etc.); empty array = no menu. */
  propertyActions?(ref: { scope: string; name: string }): Array<{ label: string; run: () => void }>;
}
