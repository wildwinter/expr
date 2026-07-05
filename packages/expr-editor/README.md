# @wildwinter/expr-editor

A **framework-neutral** (vanilla TypeScript + DOM, no React) visual editor for
[`@wildwinter/expr`](../expr) expressions — the hybrid **pill-strip + AND/OR tree**
condition builder, with a raw-text fallback, a property picker, and live validation.

Scopes, properties and the function/wizard set are **injected** (an `ExpressionSchema`,
a `Dialect`, a property catalogue and a function-template config), so any expr-based
authoring tool can mount it — it knows nothing about any one tool's domain.

```ts
import { mountExpressionEditor } from "@wildwinter/expr-editor";
import "@wildwinter/expr-editor/styles.css";

const editor = mountExpressionEditor(hostEl, {
  value: "@gold > 0 and @met_anna",   // name-form; "" = always
  schema,                              // ExpressionSchema (from @wildwinter/expr)
  dialect,                             // the Dialect (valid scopes + functions)
  catalogue,                           // properties the picker offers
  functions,                           // dialect-specific clause templates (optional)
  onChange: (src) => persist(src),     // emits name-form on every edit; "" when cleared
});
// editor.setValue(src); editor.destroy();
```

The editor owns its `ExprNode` internally; the **string** (name-form `src`) is the
contract with the host. See [PORTING-SPEC.md](./PORTING-SPEC.md) for the full model.

Notable options beyond the basics:

- `mode: "tree" | "flat"` — the AND/OR tree (conditions) or a single inline
  expression (values); flat mode can add a `+ term` affordance via `addTerm`.
- `wizard` on a function template — `"check_flags"` / `"random"` run the built-in
  guided flows; a declarative `WizardSpec` (`steps` + `build`) defines a custom
  multi-step flow (e.g. tag → operator → threshold) with no editor changes.
  Templates without a wizard insert-then-refine: the editor auto-opens the
  first unfilled slot of the inserted clause.
- `onEditingChange(editing)` — fires as popover micro-editors open/close, so the
  host can suppress its own validation display mid-edit.
- `messages: false` — hide the editor's internal validation list when the host
  renders its own.
- `popoverContainer` — where the popover micro-editors mount (default
  `document.body`). Pass a container inside a focus-trapping dialog (Radix,
  etc.) so opening a pill's popover counts as "inside" that layer and does not
  dismiss the dialog; the popover is then positioned relative to that container.
- `setText(on)` — the host's raw-text toggle (`</>`); unparseable input falls
  back to raw text automatically.

### Effects (outcome) editor

`mountEffectsEditor` edits an ordered **list** of effects — the write-side companion to
the read-only condition. Each effect is a `set` (assign a property a value) or an `emit`
(raise a host event with argument expressions); every value/argument is itself a full
pill/tree expression, edited by an embedded `mountExpressionEditor`. Modelled on the
storylets outcome editor.

```ts
import { mountEffectsEditor } from "@wildwinter/expr-editor";

const fx = mountEffectsEditor(hostEl, {
  effects: [{ kind: "set", target: "@gold", value: "@gold - 5" }],
  schema, dialect, catalogue, functions,   // same injected config as the condition editor
  events: ["fanfare", "questComplete"],     // known host events to suggest (optional)
  onChange: (effects) => persist(effects),  // the whole new list on every edit
});
// fx.setValue(effects); fx.destroy();
```

The pure list operations (`addSet`, `addEmit`, `removeAt`, `moveAt`, `updateAt`,
`addArg`, `setArgAt`, `removeArgAt`, `seedValueSrc`) are exported and node-testable.

## Layers

- **Pure logic** (`ast.ts`, `tree.ts`, `ops.ts`, `schema.ts`, `validate.ts`) — AST path
  mutation, the AND/OR tree model, operator metadata, the property catalogue, and a
  validation wrapper. Node-testable, no DOM.
- **UI** (`mount.ts`, `ui/*`) — pills, popover micro-editors, the property picker, clause
  wizards, the tree chrome, and the raw-text fallback. Verified in a host's browser preview.

## Status

Ported from the storylets authoring tool's React condition editor (same `ExprNode`
language). MIT, `@wildwinter` scope, published alongside `@wildwinter/expr`.
