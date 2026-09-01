// ---------------------------------------------------------------------------
// The conformance dialect: the smallest dialect that can PARSE the corpus.
//
// It declares three scopes and NO functions, on purpose. The corpus tests the
// evaluator's own semantics - operator typing, short-circuiting, equality,
// comparison, scope resolution - and every one of those is dialect-agnostic in
// evaluate.ts. Adding a function here would make the corpus untestable by any
// runtime that has not first separated its dialect from its evaluator, which
// today is one of the two families.
//
// So this dialect is used to COMPILE the corpus and to run the JS reference.
// A port needs no equivalent: it evaluates the published ast with whatever
// dialect it already ships, and no case reaches for one.
//
// `gone` is declared but never populated by a case. A scope the dialect knows
// about and the context does not carry resolves to false in the core, before
// any missing-property policy is consulted - which is why the corpus can pin
// that behaviour without pinning a policy.
// ---------------------------------------------------------------------------

import type { Dialect } from "@wildwinter/expr";

export const conformanceDialect: Dialect = {
  scopes: [{ token: "v" }, { token: "w" }, { token: "gone" }],
  defaultScope: "v",
  functions: {},
};
