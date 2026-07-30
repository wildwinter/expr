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

Since 0.2.0 this package is also the **state kernel** the Patter and
Storylet Engine runtime families share (their "one properties implementer"):

- **`PropertyBag`** is a first-class citizen: typed declarations + defaults,
  the firing rule (engine writes notify `subscribe`rs; host writes pass
  `{ silent: true, reason }` and reach only the always-on `onAudit` hook),
  examiner `rows()`, one sanctioned `clone()` door, in-place `reseed`, and
  bare-value `save()`/`load()`. Name normalisation is a policy: lowercase by
  default, or pass `{ normalise }` (a case-significant product passes
  identity).
- Owned registry scopes are bags: `ownedBag(token)` exposes them, and
  `mountOwned(token, bag)` attaches a bag another holder owns (the shared
  state container for a mixed two-engine game).
- **`listProperties()`** returns examiner rows across owned scopes and
  declared foreign scopes, for the shared in-engine property panels.
- **`saveFragment()`/`loadFragment()`** speak a versioned
  `OwnedStateFragment` (`{ version, scopes }`), the one serialisation shape
  both products' save envelopes embed when they adopt the kernel.
  `save()`/`load()` keep the bare 0.1.x shape, so existing consumers' save
  formats are untouched.

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
