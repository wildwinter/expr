// Shared interfaces threaded through the UI: the editing context the renderers
// mutate the tree through, and the dialect-driven function-template spec.

import type { ExprNode, Dialect, ExpressionSchema, ExpressionValidationIssue } from "@wildwinter/expr";
import type { CatalogueEntry } from "./schema.js";

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
  /** When set, picking this template runs a guided multi-step wizard (matching the storylets
   *  condition editor) instead of inserting `build()` directly. */
  wizard?: "check_flags" | "random";
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
}
