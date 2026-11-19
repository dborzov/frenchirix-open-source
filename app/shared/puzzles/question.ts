// "Funny French questions": a simple question in French about a line of the scene, with 3 or 4
// answers in French, one right and the others funny. The question's pre-generated clip (question.audio,
// a static file) loops from the start with its funny voice preset; tapping an answer plays that
// answer's clip and chooses it. Every piece of French is drawn with GlossText (tap a box: its English).
// A funny wrong answer gets a funny reaction and greys out; after two wrong answers the right one
// glows. With no audio today (503) the question shows silently and the related line loops.
//
// Spacing: only questions in ctx.allowedQuestionIds (when given) are used; the puzzle carries
// questionId so the server can record it.

import type { Question, Scene } from '../content';
import type { BotHooks } from '../practice/bot';
import type { Rng } from '../practice/rng';
import type { BuildCtx, PuzzleType, PuzzleBase } from '../practice/types';
import { WRONG_BEFORE_REVEAL } from '../rules';
import { foldFr } from './match';

export interface QuestionPuzzle extends PuzzleBase {
  type: 'question';
  questionId: string;
  lineId?: string;
  order: number[]; // display order: indices into question.answers (as stored), shuffled by the seed
  correct: number; // index of the right answer in question.answers
}

export interface QuestionState {
  wrong: number[]; // answer indices (as stored) picked wrongly, in order
  picked: number | null; // the right answer once picked
}

/** Choose answer `answer` (index in question.answers as stored). */
export type QuestionAction = { kind: 'pick'; answer: number };

export const QUESTION_REVEAL_AFTER = WRONG_BEFORE_REVEAL;

/** Problems with a question as content (also used by validate). */
export function questionProblems(q: Question, scene: Scene): string[] {
  const p: string[] = [];
  const n = q.answers.length;
  if (n < 3 || n > 4) p.push(`question ${q.id}: ${n} answers`);
  const right = q.answers.filter((a) => a.correct).length;
  if (right !== 1) p.push(`question ${q.id}: ${right} correct answers`);
  if (!q.fr.trim()) p.push(`question ${q.id}: no French`);
  if (q.lineId && !scene.lines.some((l) => l.id === q.lineId)) p.push(`question ${q.id}: line ${q.lineId} is not in the scene`);
  for (let i = 0; i < n; i++) {
    if (!q.answers[i]!.fr.trim()) p.push(`question ${q.id}: answer ${i} is empty`);
    for (let j = i + 1; j < n; j++) if (foldFr(q.answers[i]!.fr) === foldFr(q.answers[j]!.fr)) p.push(`question ${q.id}: answers ${i} and ${j} are the same`);
  }
  return p;
}

export const question: PuzzleType<QuestionPuzzle, QuestionState, QuestionAction> & BotHooks<QuestionPuzzle, QuestionState, QuestionAction> = {
  type: 'question',
  meta: {
    role: 'fun',
    minLevel: 1,
    maxLevel: 6,
    needsMic: false,
    seconds: 22,
    weight: 3,
    name: 'Funny question',
    purpose:
      'A simple French question about a line, read aloud, with three or four French answers, one right and the others funny. Reinforces understanding what is going on in that line, in French.',
    depth: 'core',
    scope: 'line',
  },

  build(ctx: BuildCtx): QuestionPuzzle | null {
    const { scene, rng, usedLineIds, focusUnitIds } = ctx;
    const allowed = ctx.allowedQuestionIds;
    const cands = scene.questions
      .filter((q) => (!allowed || allowed.has(q.id)) && questionProblems(q, scene).length === 0)
      .map((q) => {
        const line = q.lineId ? scene.lines.find((l) => l.id === q.lineId) : undefined;
        const focus = line ? line.units.filter((u) => focusUnitIds.has(u.id)).length : 0;
        return { q, line, score: focus * 2 + rng.next() * 3, used: !!q.lineId && usedLineIds.has(q.lineId), target: !!ctx.targetLineId && q.lineId === ctx.targetLineId };
      });
    if (!cands.length) return null;
    // A question about the target line first (the practice composer covering it), then any allowed one.
    cands.sort((a, b) => Number(b.target) - Number(a.target) || Number(a.used) - Number(b.used) || b.score - a.score);
    const { q, line } = cands[0]!;
    if (line) usedLineIds.add(line.id);
    const helpLines = line ? [line] : scene.lines.slice(0, 1);
    const key = helpLines.flatMap((l) => l.units.filter((u) => u.key));
    let order = rng.shuffle(q.answers.map((_, i) => i));
    // The right answer is not always first: if the shuffle put it first, rotate once in a while.
    const correct = q.answers.findIndex((a) => a.correct);
    if (order[0] === correct && rng.next() < 0.5) order = [...order.slice(1), order[0]!];
    return {
      id: `${scene.id}:question:${q.id}`,
      type: 'question',
      sceneId: scene.id,
      helpLineIds: helpLines.map((l) => l.id),
      unitIds: (key.length ? key : helpLines.flatMap((l) => l.units)).map((u) => u.id),
      questionId: q.id,
      ...(line ? { lineId: line.id } : {}),
      order,
      correct,
    };
  },

  init(): QuestionState {
    return { wrong: [], picked: null };
  },

  reduce(puzzle, state, action): QuestionState {
    if (state.picked !== null || !action || action.kind !== 'pick') return state;
    const a = action.answer;
    if (!puzzle.order.includes(a)) return state;
    if (a === puzzle.correct) return { ...state, picked: a };
    if (state.wrong.includes(a)) return state;
    return { ...state, wrong: [...state.wrong, a] };
  },

  isDone(_puzzle, state) {
    return state.picked !== null;
  },

  mistakes(_puzzle, state) {
    return state.wrong.length;
  },

  missedUnitIds(puzzle, state) {
    return state.wrong.length ? puzzle.unitIds : [];
  },

  solve(puzzle): QuestionAction {
    return { kind: 'pick', answer: puzzle.correct };
  },

  wrongAction(puzzle: QuestionPuzzle, state: QuestionState, rng: Rng): QuestionAction | null {
    if (state.picked !== null) return null;
    const left = puzzle.order.filter((i) => i !== puzzle.correct && !state.wrong.includes(i));
    return left.length ? { kind: 'pick', answer: rng.pick(left) } : null;
  },

  validate(puzzle: QuestionPuzzle, scene: Scene): string[] {
    const q = scene.questions.find((x) => x.id === puzzle.questionId);
    if (!q) return [`question: ${puzzle.questionId} is not in the scene`];
    const p = questionProblems(q, scene).map((m) => `question: ${m}`);
    if (puzzle.questionId !== q.id) p.push('question: questionId is not set');
    const sorted = [...puzzle.order].sort((a, b) => a - b);
    if (sorted.length !== q.answers.length || sorted.some((v, i) => v !== i)) p.push('question: order is not a permutation of the answers');
    if (!q.answers[puzzle.correct]?.correct) p.push('question: correct does not point at the right answer');
    if (q.lineId && !puzzle.helpLineIds.includes(q.lineId)) p.push('question: the related line is not on the help strip');
    if ((puzzle.lineId ?? null) !== (q.lineId ?? null)) p.push('question: lineId differs from the question\'s');
    return p;
  },
};
