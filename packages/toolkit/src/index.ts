// ---------------------------------------------------------------------------
// @wildwinter/toolkit - small shared pieces of the authoring tooling.
//
// What belongs here: things both product families' TOOLS need, that are not
// about the expression language (those live in @wildwinter/expr) and do not run
// in a game (game-side sharing is the vendored source in expr/ports, because
// C++, C# and GDScript cannot consume an npm package).
//
// This entry is ISOMORPHIC: no node: imports, so a browser bundle can take it.
// Anything needing Node goes in a subpath entry, as `./archive` does.
//
// Everything here arrived by being found duplicated, not by being anticipated.
// ---------------------------------------------------------------------------

export { newId, slug } from "./ids.js";
export { fnv32 } from "./hash.js";
export { parseSource } from "./source.js";
export { findMatcher } from "./find.js";
export type { FindOptions } from "./find.js";
// The archive guards are NOT here: they need `node:path`, and this entry is
// isomorphic so a browser bundle can take it. They are `@wildwinter/toolkit/archive`.
