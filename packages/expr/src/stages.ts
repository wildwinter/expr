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

import { EvalError } from "./evaluate.js";

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
