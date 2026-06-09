# @wildwinter packages

Monorepo (npm workspaces) for the shared `@wildwinter` packages used by Patter
and Storylet Studio.

- **[`packages/expr`](packages/expr)** — `@wildwinter/expr`: the agnostic
  expression engine (parse / evaluate / validate / serialise). Stateless,
  zero-dependency, portable. Scopes and functions are injected via a `Dialect`;
  state is supplied via an `EvalContext` (a static bag, or a host resolver).
- **`packages/scoperegistry`** — `@wildwinter/scoperegistry` (in progress): the
  scope registry / runtime state container that sits on top of `expr`. Owns the
  world-state (owned bags + foreign resolvers), save/load, and the
  `scopeRegistrySpec` interop format; produces the `EvalContext` / `ExpressionSchema`
  that `expr` consumes. Depends on `@wildwinter/expr`; `expr` never depends on it.

## Layout

```
packages/expr/          @wildwinter/expr (published to GitHub Packages, private)
packages/scoperegistry/ @wildwinter/scoperegistry
```

## Develop

```sh
npm install            # installs all workspaces
npm test               # test every package
npm run build          # build every package
```

Publishing is per-package via the release workflow (`.github/workflows/publish.yml`):
bump the package's version, then cut a GitHub Release.
