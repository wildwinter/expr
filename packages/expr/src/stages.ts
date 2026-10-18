// ---------------------------------------------------------------------------
// Quality ladders, outside an expression.
//
// The evaluator knows how to order a quality's stages; nothing else did. Every
// validator that took a quality declaration wrote its own idea of a valid
// ladder, and the two product families disagreed (Patter wanted two stages,
// the Storylet compiler one). The rule is a fact about what a ladder is, so it
// lives here, beside the evaluator that gives a ladder its meaning.
//
// Design: patterkit design/proposals/patter-qualities.md, sections 3 and 6.
// ---------------------------------------------------------------------------

import type { ExprNode } from "./ast.js";
import type { Dialect } from "./dialect.js";
import { EvalError } from "./evaluate.js";
import { KEYWORD_NAMES, literalSpans, parse } from "./parser.js";
import { unparse } from "./unparse.js";

/** One way a quality declaration breaks the rule. A caller words it. */
export type QualityDeclarationProblem =
  /** Fewer than two stages: a ladder with one rung has nothing to order. */
  | { kind: "too-few-stages"; count: number }
  /** A stage whose name is empty or only spaces, by its position. */
  | { kind: "empty-stage"; index: number }
  /** A stage listed again, once per repeat: "which position?" has no answer. */
  | { kind: "duplicate-stage"; stage: string }
  /** A default that is given but is not one of the stages. */
  | { kind: "default-not-a-stage"; value: unknown };

/**
 * Check a quality declaration against the family's one rule: at least two
 * stages, none empty, none twice; a default is optional (pass `undefined` for
 * none), and when given it must be a stage. Returns the problems in ladder
 * order, then the default; an empty list means the declaration is sound.
 *
 * A host that requires a default checks that it is present itself: this rule
 * only says what a given one must be.
 */
export function qualityDeclarationProblems(
  stages: readonly string[] | undefined, defaultValue?: unknown,
): QualityDeclarationProblem[] {
  const problems: QualityDeclarationProblem[] = [];
  const ladder = stages ?? [];
  if (ladder.length < 2) problems.push({ kind: "too-few-stages", count: ladder.length });
  const seen = new Set<string>();
  ladder.forEach((stage, index) => {
    if (typeof stage !== "string" || stage.trim() === "") {
      problems.push({ kind: "empty-stage", index });
    } else if (seen.has(stage)) {
      problems.push({ kind: "duplicate-stage", stage });
    } else {
      seen.add(stage);
    }
  });
  if (ladder.length > 0 && defaultValue !== undefined && (typeof defaultValue !== "string" || !seen.has(defaultValue))) {
    problems.push({ kind: "default-not-a-stage", value: defaultValue });
  }
  return problems;
}

// --- the ladder outside an expression -----------------------------------------
//
// A host holding a quality's value (a field, a game-data value, a property it
// read) needs the order the evaluator uses, and each game was re-implementing
// it. These three are that order, stated once (patter-qualities.md section 3).
// Each takes a bare ladder or the declaration carrying one, so a host writes
// `compareStages(fieldDecl, card.fields.act, current)`.

/** A quality's ladder, or a declaration with `stages` (a field's, a
 *  property's, a game-data field's). A declaration without them has none. */
export type StageLadder = readonly string[] | { readonly stages?: readonly string[] };

const ladderOf = (ladder: StageLadder): readonly string[] =>
  (Array.isArray(ladder) ? ladder : (ladder as { readonly stages?: readonly string[] }).stages ?? []);

const typeWord = (v: unknown): string =>
  (Array.isArray(v) ? "flags" : v === null || v === undefined ? "nothing" : typeof v);

/** The position of a stage, or -1 when the value is not one of the stages. */
export function stageIndex(ladder: StageLadder, value: unknown): number {
  return typeof value === "string" ? ladderOf(ladder).indexOf(value) : -1;
}

/** The position of a stage, or the evaluator's own error when it is not one. */
function positionOf(stages: readonly string[], value: unknown): number {
  if (typeof value !== "string") throw new EvalError(`a stage is a name, got ${typeWord(value)}`);
  const i = stages.indexOf(value);
  if (i < 0) throw new EvalError(`"${value}" is not a stage of this quality (stages: ${stages.join(", ")})`);
  return i;
}

/** -1, 0 or 1 as `a` is below, at or above `b` on the ladder. An error when
 *  either is not a stage: an unknown stage has no position to compare. */
export function compareStages(ladder: StageLadder, a: unknown, b: unknown): -1 | 0 | 1 {
  const stages = ladderOf(ladder);
  const d = positionOf(stages, a) - positionOf(stages, b);
  return d < 0 ? -1 : d > 0 ? 1 : 0;
}

/** One rung up, staying on the top rung, as `advance()` does. An error when
 *  the value is not a stage (a drifted save, a deleted stage). */
export function nextStage(ladder: StageLadder, value: unknown): string {
  const stages = ladderOf(ladder);
  return stages[Math.min(positionOf(stages, value) + 1, stages.length - 1)]!;
}

/**
 * The stages either side of `stage`, with it, in ladder order: the one below,
 * the stage, the one above, each where the ladder has it. A coverage driver
 * proposes these for a gate such as `@q >= "x"`, so both sides of the gate are
 * played; an editor offers them as the stages nearest a value.
 *
 * A name that is not a stage has no position to be beside (a deleted stage
 * took its place with it), so the answer is then the whole ladder, in order:
 * only the author knows where such a value belongs now.
 */
export function stagesEitherSide(ladder: StageLadder, stage: unknown): string[] {
  const stages = ladderOf(ladder);
  const i = stageIndex(stages, stage);
  if (i < 0) return [...stages];
  return stages.slice(Math.max(0, i - 1), i + 2);
}

// --- a stage literal in an expression (editors) --------------------------------
//
// A quality's values are stored by stage NAME, so a rename is the one edit that
// has to reach every literal naming the stage (patter-qualities.md section 2),
// and a reorder the one that changes what a gate means without changing any
// text. Both editors walk their own formats for the expressions; these say what
// happens inside one.

/** Does `(scope, name)`, read in an expression, name the quality in question? */
export type StageTargetRef = (scope: string, name: string) => boolean;

const COMPARISONS = new Set(["==", "!=", "<", "<=", ">", ">="]);
const ORDERING = new Set(["<", "<=", ">", ">="]);
const BARE_WORD = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * Rewrite the stage literal `from` to `to` wherever `src` compares it with the
 * quality `isTarget` names, or, with `assigned`, where the whole expression is
 * that literal (an effect's value assigned to the quality). Undefined when
 * nothing changed or the source does not parse.
 *
 * The author's own text is kept where that says exactly the rewritten
 * expression: of the occurrences of `from` (quoted either way, or a bare word),
 * the set whose replacement parses to the rewritten tree. Every one first, as
 * that is the usual case, then each smaller choice, while there are few enough
 * to try; so a condition that also compares another quality with the same word
 * keeps that one as it was. Otherwise the parser's form of the rewritten tree.
 */
export function renameStageInExpression(
  src: string, dialect: Dialect, isTarget: StageTargetRef, from: string, to: string, assigned = false,
): string | undefined {
  let ast: ExprNode;
  try { ast = parse(src, dialect); } catch { return undefined; }
  let hits = 0;
  const isRef = (n: ExprNode): boolean => n.kind === "scopedvar" && isTarget(n.scope, n.name);
  const walk = (n: ExprNode): ExprNode => {
    switch (n.kind) {
      case "binary": {
        let left = walk(n.left);
        let right = walk(n.right);
        if (COMPARISONS.has(n.op)) {
          if (isRef(left) && right.kind === "string" && right.value === from) { right = { kind: "string", value: to }; hits++; }
          if (isRef(right) && left.kind === "string" && left.value === from) { left = { kind: "string", value: to }; hits++; }
        }
        return { ...n, left, right };
      }
      case "unary": return { ...n, operand: walk(n.operand) };
      case "call": return { ...n, args: n.args.map(walk) };
      default: return n;
    }
  };
  let next = walk(ast);
  if (assigned && next.kind === "string" && next.value === from) { next = { kind: "string", value: to }; hits++; }
  if (hits === 0) return undefined;

  const wanted = JSON.stringify(next);
  const quotedTo = (q: string): string => `${q}${to.replace(/\\/g, "\\\\").replace(new RegExp(q, "g"), `\\${q}`)}${q}`;
  const bareTo = BARE_WORD.test(to) && !KEYWORD_NAMES.includes(to) ? to : quotedTo('"');
  // The candidates are the tokeniser's: a string literal or a bare word that IS `from`, never text inside
  // another literal, so a long note mentioning the stage neither counts nor changes.
  const found = literalSpans(src).filter((t) => t.value === from)
    .map((t) => ({ at: t.at, length: t.end - t.at, text: t.quote !== undefined ? quotedTo(t.quote) : bareTo }));
  const says = (text: string): boolean => {
    try { return JSON.stringify(parse(text, dialect)) === wanted; } catch { return false; }
  };
  const replaced = (mask: number): string => {
    let text = "";
    let at = 0;
    found.forEach((f, i) => {
      if (!(mask & (1 << i))) return;
      text += src.slice(at, f.at) + f.text;
      at = f.at + f.length;
    });
    return text + src.slice(at);
  };
  if (found.length > 0 && found.length <= 8) {
    for (let mask = (1 << found.length) - 1; mask > 0; mask--) if (says(replaced(mask))) return replaced(mask);
  }
  return unparse(next, { defaultScope: dialect.defaultScope });
}

/**
 * How many gates in `src` order the quality `isTarget` names against something
 * (`<`, `<=`, `>`, `>=` with the quality on one side), counting each one: the
 * gates whose meaning a reorder of the ladder changes, though no value does.
 * Zero for a source that does not parse, which gates nothing.
 */
export function stageGateCount(src: string, dialect: Dialect, isTarget: StageTargetRef): number {
  let ast: ExprNode;
  try { ast = parse(src, dialect); } catch { return 0; }
  let gates = 0;
  const count = (n: ExprNode): void => {
    switch (n.kind) {
      case "binary":
        if (ORDERING.has(n.op)
          && [n.left, n.right].some((s) => s.kind === "scopedvar" && isTarget(s.scope, s.name))) gates++;
        count(n.left); count(n.right);
        return;
      case "unary": count(n.operand); return;
      case "call": n.args.forEach(count); return;
      default: return;
    }
  };
  count(ast);
  return gates;
}
