// "Catapult" (catapult): a French expression of the scene loops; Roman legionaries stand on a
// rampart, each holding up a sign with an English meaning; the kid taps the Roman whose sign says
// what the French means and the Gauls' catapult knocks him flying. Three or four rounds, one
// expression each. Role: recognise.
//
// A wrong Roman counts a mistake (the boulder bounces off his shield, he stays, his sign greys out);
// after two wrong shots in a round the right Roman glows. No wrong sign is close in meaning to the
// right one (arcade.ts pickDistractors): the kid hears only the expression, out of its line.

import type { Scene } from '../content';
import type { BotHooks } from '../practice/bot';
import type { Rng } from '../practice/rng';
import type { BuildCtx, PuzzleType, PuzzleBase } from '../practice/types';
import { WRONG_BEFORE_REVEAL } from '../rules';
import { candidateUnits, checkChoices, checkHelp, normalizeFr, pickDistinctUnits, pickDistractors, rankUnits, relatedGlosses, sameFrenchGlosses, uniq, unitGlossPools, unitRef } from './arcade';

export interface CatapultRound {
  unitId: string;
  lineId: string;
  choices: { en: string; correct: boolean }[];
}

export interface CatapultPuzzle extends PuzzleBase {
  type: 'catapult';
  rounds: CatapultRound[];
}

export interface CatapultState {
  round: number;
  wrong: number[][]; // per round, the choice indices shot wrongly
}

export type CatapultAction = { kind: 'fire'; index: number };

export const CATAPULT_REVEAL_AFTER = WRONG_BEFORE_REVEAL;

export function catapultShape(level: number): { rounds: number; choices: number } {
  if (level <= 2) return { rounds: 3, choices: 3 };
  if (level <= 4) return { rounds: 3, choices: 4 };
  return { rounds: 4, choices: 4 };
}

export const catapult: PuzzleType<CatapultPuzzle, CatapultState, CatapultAction> & BotHooks<CatapultPuzzle, CatapultState, CatapultAction> = {
  type: 'catapult',
  meta: {
    role: 'recognise',
    minLevel: 1,
    maxLevel: 6,
    needsMic: false,
    seconds: 28,
    weight: 2,
    name: 'Catapult',
    purpose:
      'A French expression loops; the kid knocks over the Roman whose sign carries its English, three or four rounds. Reinforces the meaning of single expressions, fast.',
    depth: 'intro',
    scope: 'unit',
  },

  build(ctx: BuildCtx): CatapultPuzzle | null {
    const { scene, rng } = ctx;
    const shape = catapultShape(ctx.level);
    const units = pickDistinctUnits(rankUnits(candidateUnits(ctx), ctx, rng), shape.rounds);
    const nRounds = Math.min(shape.rounds, units.length);
    // A targeted build (one line) may be a single round; otherwise at least two.
    if (nRounds < (ctx.targetLineId ? 1 : 2)) return null;
    const pools = unitGlossPools(ctx, rng);
    const rounds: CatapultRound[] = [];
    for (const { line, unit } of units.slice(0, nRounds)) {
      // No sign close in meaning to the right one, nor the English of related French (docs/app-games.md, "Choices").
      const wrong = pickDistractors(unit, pools, shape.choices - 1, relatedGlosses(scene, unit));
      if (wrong.length < shape.choices - 1) return null;
      rounds.push({
        unitId: unit.id,
        lineId: line.id,
        choices: rng.shuffle([{ en: unit.en.trim(), correct: true }, ...wrong.map((en) => ({ en, correct: false }))]),
      });
    }
    for (const r of rounds) {
      ctx.usedUnitIds.add(r.unitId);
      ctx.usedLineIds.add(r.lineId);
    }
    return {
      id: `${scene.id}:catapult:${rounds[0]!.unitId}`,
      type: 'catapult',
      sceneId: scene.id,
      helpLineIds: uniq(rounds.map((r) => r.lineId)),
      unitIds: rounds.map((r) => r.unitId),
      rounds,
    };
  },

  init(puzzle): CatapultState {
    return { round: 0, wrong: puzzle.rounds.map(() => []) };
  },

  reduce(puzzle, state, action): CatapultState {
    if (!action || action.kind !== 'fire' || state.round >= puzzle.rounds.length) return state;
    const r = puzzle.rounds[state.round]!;
    const c = r.choices[action.index];
    if (!c) return state;
    if (c.correct) return { ...state, round: state.round + 1 };
    const mine = state.wrong[state.round] ?? [];
    if (mine.includes(action.index)) return state;
    const wrong = state.wrong.slice();
    wrong[state.round] = [...mine, action.index];
    return { ...state, wrong };
  },

  isDone(puzzle, state) {
    return state.round >= puzzle.rounds.length;
  },

  mistakes(_puzzle, state) {
    return state.wrong.reduce((a, w) => a + w.length, 0);
  },

  missedUnitIds(puzzle, state) {
    return puzzle.rounds.filter((_, i) => (state.wrong[i]?.length ?? 0) > 0).map((r) => r.unitId);
  },

  solve(puzzle, state): CatapultAction {
    return { kind: 'fire', index: puzzle.rounds[state.round]!.choices.findIndex((c) => c.correct) };
  },

  wrongAction(puzzle: CatapultPuzzle, state: CatapultState, rng: Rng): CatapultAction | null {
    const r = puzzle.rounds[state.round];
    if (!r) return null;
    const mine = state.wrong[state.round] ?? [];
    const left = r.choices.map((c, i) => (c.correct || mine.includes(i) ? -1 : i)).filter((i) => i >= 0);
    return left.length ? { kind: 'fire', index: rng.pick(left) } : null;
  },

  validate(puzzle: CatapultPuzzle, scene: Scene): string[] {
    const p: string[] = [];
    if (puzzle.rounds.length < 1 || puzzle.rounds.length > 5) p.push(`catapult: ${puzzle.rounds.length} rounds`);
    const frs = new Set<string>();
    puzzle.rounds.forEach((r, i) => {
      const ref = unitRef(scene, r.unitId);
      if (!ref) {
        p.push(`catapult: round ${i}: unit ${r.unitId} is not in the scene`);
        return;
      }
      if (ref.line.id !== r.lineId) p.push(`catapult: round ${i}: the unit is not in line ${r.lineId}`);
      if (r.choices.length < 2 || r.choices.length > 4) p.push(`catapult: round ${i}: ${r.choices.length} choices`);
      p.push(...checkChoices('catapult', `round ${i}`, r.choices, ref.unit.en, relatedGlosses(scene, ref.unit)));
      for (const other of sameFrenchGlosses(scene, ref.unit))
        if (r.choices.some((c) => !c.correct && c.en.trim().toLowerCase() === other.trim().toLowerCase())) p.push(`catapult: round ${i}: a wrong choice is right for the same French`);
      const fr = normalizeFr(ref.unit.fr);
      if (frs.has(fr)) p.push(`catapult: round ${i}: the same French twice`);
      frs.add(fr);
    });
    p.push(...checkHelp('catapult', scene, puzzle.helpLineIds, puzzle.rounds.map((r) => r.lineId), puzzle.unitIds));
    return p;
  },
};
