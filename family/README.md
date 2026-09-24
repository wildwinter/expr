# The family's shared vocabulary

`engine-scopes.json` lists every engine's GAME-WIDE scope token: the one scope each engine
registers under its own name in a game's registry, which every other engine in the game can
read. Each product's compiler accepts every token here that is not its own, by default, with no
project setting: a card can name `@patter.gold` and a Patter condition `@story.act`, and the
game wires nothing. The compiler lets such a reference through unchecked (the other engine owns
its names and types). At run time the engine refuses to open a flow or load a save when no
engine on its registry has registered a token the content names, before anything changes.

Only compilers read this list. `@wildwinter/scoperegistry` stays product-neutral: the registry
never learns these names, and a clash between two engines still fails at registration.

`scripts/sync-conformance.mjs` writes it into each product as a generated TypeScript module
(`packages/dialect/src/engine-scopes.ts`), with `--check` in CI. A new family (Lockstep) adds
its game-wide tokens here and gets the other engines' for free.
