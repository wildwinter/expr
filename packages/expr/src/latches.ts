// ---------------------------------------------------------------------------
// Monotonic-latch analysis over a compiled AST.
//
// The grammar half of the reachability check both product families run
// (Storylet Studio's design/reachability.md, offered to Patterkit 2026-08-30
// and implemented there independently). It answers one question about a
// condition: WHICH LATCHES does this assert, and which of them negated?
//
// A latch is a boolean only ever written `true`, or a flag only ever `+set`.
// Deciding whether a condition is unsatisfiable then reduces to walking a graph
// of who writes what and what gates the writer, and that graph walk is where
// the two families genuinely differ: one has decks and boxes, the other scenes
// and snippets with property defaults and `temporary` reseeding. THIS is the
// part that does not differ, and it was written twice, character for
// character, including the flag key format.
//
// It lives here because it is analysis of the expression language, and because
// the LATCH GRAMMAR is the piece most likely to drift: teach one family that
// `@x != false` asserts what `@x` asserts and the other silently does not
// learn it, so the same content reports a fault in one product and not the
// other.
//
// THE ONE RULE, carried from the original: only report what can be REFUTED.
// Anything this does not understand returns undefined and takes no part in the
// analysis, because a branch is refuted by what is proven, never by what is
// missing.
// ---------------------------------------------------------------------------

import type { AstNode } from "./ast.js";

/** One latch a condition mentions, and whether it was mentioned negated. */
export interface Term {
  key: string;
  negated: boolean;
}

/**
 * How a host keys a scoped ref. Scoping is the family-specific part: Patter's
 * `@scene.x` is a different property in every scene (owner: a scene id),
 * Storylets' `@deck.x` is a different property in every deck (owner: the box
 * and deck it was seen in), and a global ref keys as itself.
 *
 * Generic in the owner, so a host passes whatever identifies a scope in its own
 * model rather than flattening it to a string to get through this door.
 */
export type KeyOf<TOwner = string> = (ref: string, owner: TOwner) => string;

/** `["sv", scope, name]` as the `@scope.name` a host would write. */
export const scopedRef = (ast: AstNode): string | undefined =>
  Array.isArray(ast) && ast[0] === "sv" ? `@${String(ast[1])}.${String(ast[2])}` : undefined;

/**
 * The latch a node asserts, if it is one of the shapes this understands:
 *
 *   `@x`                    the bare reference
 *   `@x == true`            which asserts exactly what `@x` does
 *   `check_flags(@x, +f)`   ONE flag; two in a call is a conjunction that
 *                           could be split, and a needless generality until
 *                           something asks for it
 *
 * Anything else is undefined, and takes no part in the analysis.
 */
export function latchOf<TOwner>(ast: AstNode, owner: TOwner, keyOf: KeyOf<TOwner>): string | undefined {
  const direct = scopedRef(ast);
  if (direct !== undefined) return keyOf(direct, owner);
  if (!Array.isArray(ast)) return undefined;

  if (ast[0] === "bin" && ast[1] === "==") {
    const [, , l, r] = ast as ["bin", string, AstNode, AstNode];
    for (const [a, b] of [[l, r], [r, l]] as Array<[AstNode, AstNode]>) {
      const ref = scopedRef(a);
      if (ref !== undefined && Array.isArray(b) && b[0] === "b" && b[1] === true) return keyOf(ref, owner);
    }
    return undefined;
  }

  if (ast[0] === "call" && ast[1] === "check_flags") {
    const ref = scopedRef(ast[2] as AstNode);
    const args = (ast as unknown as AstNode[]).slice(3);
    if (ref === undefined || args.length !== 1) return undefined;
    const arg = args[0];
    if (Array.isArray(arg) && arg[0] === "fd" && arg[1] === "+") {
      return `${keyOf(ref, owner)}:${String(arg[2])}`;
    }
  }
  return undefined;
}

/** Split a condition on top-level `or`. Every branch must be refuted before the
 *  whole condition is. */
export function disjuncts(ast: AstNode): AstNode[] {
  if (Array.isArray(ast) && ast[0] === "bin" && ast[1] === "or") {
    const [, , l, r] = ast as ["bin", string, AstNode, AstNode];
    return [...disjuncts(l), ...disjuncts(r)];
  }
  return [ast];
}

/** The latches one AND-branch asserts, positively or negated. Terms it does not
 *  understand are simply absent. */
export function terms<TOwner>(
  ast: AstNode,
  owner: TOwner,
  keyOf: KeyOf<TOwner>,
  negated = false,
  into: Term[] = [],
): Term[] {
  const latch = latchOf(ast, owner, keyOf);
  if (latch !== undefined) {
    into.push({ key: latch, negated });
    return into;
  }
  if (!Array.isArray(ast)) return into;
  if (ast[0] === "u" && ast[1] === "not") return terms(ast[2] as AstNode, owner, keyOf, !negated, into);
  if (ast[0] === "bin" && ast[1] === "and" && !negated) {
    terms(ast[2] as AstNode, owner, keyOf, false, into);
    terms(ast[3] as AstNode, owner, keyOf, false, into);
  }
  return into;
}
