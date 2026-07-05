# @wildwinter packages

Monorepo (npm workspaces) for the shared `@wildwinter` packages used by Patter
and Storylet Studio.

- **[`packages/expr`](packages/expr)** — `@wildwinter/expr`: the agnostic
  expression engine (parse / evaluate / validate / serialise). Stateless,
  zero-dependency, portable. Scopes and functions are injected via a `Dialect`;
  state is supplied via an `EvalContext` (a static bag, or a host resolver).
- **[`packages/expr-editor`](packages/expr-editor)** — `@wildwinter/expr-editor`:
  a framework-neutral (vanilla TS + DOM) visual editor for `expr` expressions —
  a hybrid pill-strip + AND/OR tree builder with guided clause wizards, a
  raw-text fallback, a property picker, and live validation. Scopes, properties
  and functions are injected via a `Dialect` + `ExpressionSchema`, so any
  expr-based authoring tool can mount it (Patterpad and Storylet Studio both do).
  Depends on `@wildwinter/expr`.
- **[`packages/scoperegistry`](packages/scoperegistry)** — `@wildwinter/scoperegistry`: the
  scope registry / runtime state container that sits on top of `expr`. Owns the
  world-state (owned bags + foreign resolvers), save/load, and the
  `scopeRegistrySpec` interop format; produces the `EvalContext` / `ExpressionSchema`
  that `expr` consumes. Depends on `@wildwinter/expr`; `expr` never depends on it.

## Layout

```
packages/expr/          @wildwinter/expr (published to public npm)
packages/expr-editor/   @wildwinter/expr-editor (published to public npm)
packages/scoperegistry/ @wildwinter/scoperegistry (published to public npm)
```

## Develop

```sh
npm install            # installs all workspaces
npm test               # test every package
npm run build          # build every package
```

Publishing is per-package via the release workflow (`.github/workflows/publish.yml`):
bump the package's version, then cut a GitHub Release.
