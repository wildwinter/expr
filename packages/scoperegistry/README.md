# @wildwinter/scoperegistry

The scope registry / runtime state container that sits on top of
[`@wildwinter/expr`](../expr). expr is a stateless calculator; this package is
the **state layer**.

It owns the world state as a set of named **scopes**, each either:

- **owned** — a property bag this registry stores, seeds from declaration
  defaults, and serializes via `save`/`load`; or
- **foreign** — host- or other-engine-resolved at runtime through a
  `{ get, set? }` resolver, never stored here (read-only if there's no setter).

It then produces the two things expr consumes:

- **`toEvalContext()`** → the `EvalContext` for `evaluate` (owned bags + foreign
  resolvers).
- **`toSchema()`** → the `ExpressionSchema` for `validateExpr` (from declarations;
  undeclared scopes are opaque and unflagged).

Plus **`readScopeRegistrySpec(json)`** — extract a `scopeRegistrySpec` (the
interop format) from any JSON value (a `.storyworld` bundle, or a standalone
manifest), so one owner's scope declarations can be imported for validation by
another engine.

`expr` never depends on this; this depends one-way on `expr`. Read-only is
settable per scope (a resolver with no `set`) and per property
(`writable: false`), enforced by `set`.

```ts
import { ScopeRegistry } from "@wildwinter/scoperegistry";

const reg = new ScopeRegistry()
  .defineOwned("patter", [{ name: "hp", type: "number", default: 10 }])
  .defineForeign("game", { get: (n) => host.read(n), set: (n, v) => host.write(n, v) });

evaluate(ast, reg.toEvalContext(), dialect);   // reads owned + foreign
validateExpr(ast, reg.toSchema(), dialect);    // checks declared scopes
const blob = reg.save();                        // owned scopes only
```

Design rationale: `design/scope-registry.md` in the Patter repo.
