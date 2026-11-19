// "Meaning line-up" (line-meaning): three or four lines of the scene, in a row, wait as numbered
// speakers whose French is hidden; their English meanings lie shuffled. The kid taps a speaker (it
// loops that line), then the meaning that goes with it; a matched speaker turns into its French, in
// boxes. The stretch can also loop as a whole, the speaker being heard lighting up. Matching is by
// ear: the French text shows only once matched. Scope: multi-line.
//
// A wrong meaning counts a mistake on that line; after two the right meaning glows when the line
// is selected.

import type { Line, Scene } from '../content';
import type { BotHooks } from '../practice/bot';
import type { Rng } from '../practice/rng';
import type { BuildCtx, PuzzleType, PuzzleBase } from '../practice/types';
import { WRONG_BEFORE_REVEAL } from '../rules';
import { checkHelp, linesById, linesCloseInMeaning, linesConfusable, shuffleNotIdentity, usableLine } from './arcade';

export interface LineMeaningPuzzle extends PuzzleBase {
  type: 'line-meaning';
  lineIds: string[]; // in scene order: the speakers, N° 1..n
  meanings: string[]; // the same line ids, in the order their English is shown (shuffled)
}

export interface LineMeaningState {
  matched: string[]; // line ids matched, in order
  wrong: number[]; // per line (lineIds order): wrong meanings tried
}

export type LineMeaningAction = { kind: 'pair'; lineId: string; meaning: string };

export const LINE_MEANING_REVEAL_AFTER = WRONG_BEFORE_REVEAL;
export const LINE_MEANING_MAX_SPAN_MS = 30000;

export function lineMeaningCount(level: number): number {
  return level >= 3 ? 4 : 3;
}

/**
 * Runs of n consecutive usable lines whose French and English can be told apart pairwise: every
 * meaning is a wrong choice for the other speakers, so no two say mostly the same things
 * (linesCloseInMeaning, docs/app-games.md, "Choices").
 */
function runs(scene: Scene, n: number): Line[][] {
  const out: Line[][] = [];
  for (let i = 0; i + n <= scene.lines.length; i++) {
    const run = scene.lines.slice(i, i + n);
    if (!run.every(usableLine)) continue;
    if (run[n - 1]!.endMs - run[0]!.startMs > LINE_MEANING_MAX_SPAN_MS) continue;
    let ok = true;
    for (let x = 0; x < n && ok; x++)
      for (let y = x + 1; y < n && ok; y++) if (linesCloseInMeaning(run[x]!.en, run[y]!.en) || linesConfusable(run[x]!.fr, run[y]!.fr)) ok = false;
    if (ok) out.push(run);
  }
  return out;
}

export const lineMeaning: PuzzleType<LineMeaningPuzzle, LineMeaningState, LineMeaningAction> & BotHooks<LineMeaningPuzzle, LineMeaningState, LineMeaningAction> = {
  type: 'line-meaning',
  meta: {
    role: 'recognise',
    minLevel: 1,
    maxLevel: 6,
    needsMic: false,
    seconds: 45,
    weight: 2,
    name: 'Meaning line-up',
    purpose:
      'Three or four lines in a row wait as hidden speakers and their English meanings lie shuffled; the kid connects each line, by ear, to what it means, and its French appears once matched. Reinforces the meaning of whole lines and tells them apart.',
    depth: 'core',
    scope: 'multi-line',
  },

  build(ctx: BuildCtx): LineMeaningPuzzle | null {
    const { scene, rng } = ctx;
    let rs: Line[][] = [];
    for (let n = lineMeaningCount(ctx.level); n >= 3 && !rs.length; n--) rs = runs(scene, n);
    if (ctx.targetLineId) rs = rs.filter((r) => r.some((l) => l.id === ctx.targetLineId));
    if (!rs.length) return null;
    const scored = rs.map((run) => ({
      run,
      score: -run.filter((l) => ctx.usedLineIds.has(l.id)).length * 2 + run.reduce((s, l) => s + l.units.filter((u) => ctx.focusUnitIds.has(u.id)).length, 0) + rng.next(),
    }));
    scored.sort((a, b) => b.score - a.score);
    const run = scored[0]!.run;
    const lineIds = run.map((l) => l.id);
    for (const id of lineIds) ctx.usedLineIds.add(id);
    const key = run.flatMap((l) => l.units.filter((u) => u.key).map((u) => u.id));
    return {
      id: `${scene.id}:line-meaning:${lineIds[0]}`,
      type: 'line-meaning',
      sceneId: scene.id,
      helpLineIds: lineIds.slice(),
      unitIds: key.length ? key : run.flatMap((l) => l.units.map((u) => u.id)),
      lineIds,
      meanings: shuffleNotIdentity(lineIds, rng),
    };
  },

  init(puzzle): LineMeaningState {
    return { matched: [], wrong: puzzle.lineIds.map(() => 0) };
  },

  reduce(puzzle, state, action): LineMeaningState {
    if (!action || action.kind !== 'pair') return state;
    const li = puzzle.lineIds.indexOf(action.lineId);
    if (li < 0 || !puzzle.meanings.includes(action.meaning)) return state;
    if (state.matched.includes(action.lineId) || state.matched.includes(action.meaning)) return state;
    if (action.lineId === action.meaning) return { ...state, matched: [...state.matched, action.lineId] };
    const wrong = state.wrong.slice();
    wrong[li] = (wrong[li] ?? 0) + 1;
    return { ...state, wrong };
  },

  isDone(puzzle, state) {
    return state.matched.length >= puzzle.lineIds.length;
  },

  mistakes(_puzzle, state) {
    return state.wrong.reduce((a, b) => a + b, 0);
  },

  missedUnitIds(puzzle, state) {
    const lines = new Set(puzzle.lineIds.filter((_, i) => (state.wrong[i] ?? 0) > 0));
    return puzzle.unitIds.filter((u) => lines.has(u.slice(0, u.lastIndexOf(':'))));
  },

  solve(puzzle, state): LineMeaningAction {
    const id = puzzle.lineIds.find((l) => !state.matched.includes(l))!;
    return { kind: 'pair', lineId: id, meaning: id };
  },

  wrongAction(puzzle: LineMeaningPuzzle, state: LineMeaningState, rng: Rng): LineMeaningAction | null {
    const open = puzzle.lineIds.filter((l) => !state.matched.includes(l));
    if (open.length < 2) return null;
    const lineId = rng.pick(open);
    return { kind: 'pair', lineId, meaning: rng.pick(open.filter((m) => m !== lineId)) };
  },

  validate(puzzle: LineMeaningPuzzle, scene: Scene): string[] {
    const p: string[] = [];
    const ls = linesById(scene, puzzle.lineIds);
    if (ls.length !== puzzle.lineIds.length) return ['line-meaning: a line is not in the scene'];
    if (ls.length < 3 || ls.length > 4) p.push(`line-meaning: ${ls.length} lines`);
    if ([...puzzle.meanings].sort().join('|') !== [...puzzle.lineIds].sort().join('|')) p.push('line-meaning: the meanings are not the lines');
    if (puzzle.meanings.join('|') === puzzle.lineIds.join('|')) p.push('line-meaning: the meanings are already in order');
    for (let x = 0; x < ls.length; x++)
      for (let y = x + 1; y < ls.length; y++) {
        if (linesCloseInMeaning(ls[x]!.en, ls[y]!.en)) p.push(`line-meaning: lines ${x} and ${y} mean nearly the same`);
        if (linesConfusable(ls[x]!.fr, ls[y]!.fr)) p.push(`line-meaning: lines ${x} and ${y} sound nearly the same`);
      }
    p.push(...checkHelp('line-meaning', scene, puzzle.helpLineIds, puzzle.lineIds, puzzle.unitIds));
    return p;
  },
};
