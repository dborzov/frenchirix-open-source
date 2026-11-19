// "True or false" (vrai-faux): a French expression of the scene loops on a card with one English
// meaning under it; is that what it means? The kid slams VRAI or FAUX. When the meaning was false,
// the card flips to show the right one. Five to seven cards in a fast run; right answers in a row
// build a combo. Role: recognise.
//
// A wrong answer counts a mistake on that card and the card stays; with two buttons the other one
// is then the answer, so the view makes it glow at once (REVEAL_AFTER is 1 here, on purpose).

import type { Scene } from '../content';
import type { BotHooks } from '../practice/bot';
import type { Rng } from '../practice/rng';
import type { BuildCtx, PuzzleType, PuzzleBase } from '../practice/types';
import { candidateUnits, checkHelp, closeInMeaning, normalizeEn, normalizeFr, pickDistinctUnits, pickDistractors, rankUnits, relatedGlosses, uniq, unitGlossPools, unitRef } from './arcade';

export interface VraiFauxCard {
  unitId: string;
  lineId: string;
  shownEn: string; // the meaning on the card
  truth: boolean; // true when shownEn is the unit's English
  rightEn: string; // the unit's English (shown after a FAUX)
}

export interface VraiFauxPuzzle extends PuzzleBase {
  type: 'vrai-faux';
  cards: VraiFauxCard[];
}

export interface VraiFauxState {
  card: number;
  wrongAt: number[];
  streak: number; // right first time, in a row
  best: number;
}

export type VraiFauxAction = { kind: 'answer'; says: boolean };

/** With two buttons, one wrong answer already leaves only the right one: it glows at once. */
export const VRAI_FAUX_REVEAL_AFTER = 1;

export function vraiFauxCards(level: number): number {
  if (level <= 2) return 5;
  if (level <= 4) return 6;
  return 7;
}

export const vraiFaux: PuzzleType<VraiFauxPuzzle, VraiFauxState, VraiFauxAction> & BotHooks<VraiFauxPuzzle, VraiFauxState, VraiFauxAction> = {
  type: 'vrai-faux',
  meta: {
    role: 'recognise',
    minLevel: 1,
    maxLevel: 6,
    needsMic: false,
    seconds: 30,
    weight: 2,
    name: 'True or false',
    purpose:
      'A French expression loops over one English meaning; the kid slams true or false, five to seven cards in a run. Reinforces quick recognition of what expressions mean.',
    depth: 'intro',
    scope: 'unit',
  },

  build(ctx: BuildCtx): VraiFauxPuzzle | null {
    const { scene, rng } = ctx;
    const want = vraiFauxCards(ctx.level);
    const units = pickDistinctUnits(rankUnits(candidateUnits(ctx), ctx, rng), want);
    // A targeted build (one line) may have as few as two cards; otherwise at least four.
    if (units.length < (ctx.targetLineId ? 2 : 4)) return null;
    const n = units.length;
    // Roughly half true, at least two of each (one of each for a short run), in random order.
    const minEach = n >= 4 ? 2 : 1;
    const nTrue = Math.max(minEach, Math.min(n - minEach, Math.round(n / 2 + (rng.next() - 0.5))));
    const truths = rng.shuffle(units.map((_, i) => i < nTrue));
    const pools = unitGlossPools(ctx, rng);
    const cards: VraiFauxCard[] = [];
    for (let i = 0; i < n; i++) {
      const { line, unit } = units[i]!;
      const rightEn = unit.en.trim();
      let shownEn = rightEn;
      if (!truths[i]) {
        // A false meaning: never close in meaning to the right one, nor to the meaning of related French
        // in the scene (docs/app-games.md, "Choices").
        const wrong = pickDistractors(unit, pools.map((p) => rng.shuffle(p)), 1, relatedGlosses(scene, unit));
        if (!wrong.length) return null;
        shownEn = wrong[0]!;
      }
      cards.push({ unitId: unit.id, lineId: line.id, shownEn, truth: !!truths[i], rightEn });
    }
    for (const c of cards) {
      ctx.usedUnitIds.add(c.unitId);
      ctx.usedLineIds.add(c.lineId);
    }
    return {
      id: `${scene.id}:vrai-faux:${cards[0]!.unitId}`,
      type: 'vrai-faux',
      sceneId: scene.id,
      helpLineIds: uniq(cards.map((c) => c.lineId)),
      unitIds: cards.map((c) => c.unitId),
      cards,
    };
  },

  init(puzzle): VraiFauxState {
    return { card: 0, wrongAt: puzzle.cards.map(() => 0), streak: 0, best: 0 };
  },

  reduce(puzzle, state, action): VraiFauxState {
    if (!action || action.kind !== 'answer' || state.card >= puzzle.cards.length) return state;
    const c = puzzle.cards[state.card]!;
    if (action.says === c.truth) {
      const streak = (state.wrongAt[state.card] ?? 0) === 0 ? state.streak + 1 : 0;
      return { ...state, card: state.card + 1, streak, best: Math.max(state.best, streak) };
    }
    const wrongAt = state.wrongAt.slice();
    wrongAt[state.card] = (wrongAt[state.card] ?? 0) + 1;
    return { ...state, wrongAt, streak: 0 };
  },

  isDone(puzzle, state) {
    return state.card >= puzzle.cards.length;
  },

  mistakes(_puzzle, state) {
    return state.wrongAt.reduce((a, b) => a + b, 0);
  },

  missedUnitIds(puzzle, state) {
    return puzzle.cards.filter((_, i) => (state.wrongAt[i] ?? 0) > 0).map((c) => c.unitId);
  },

  solve(puzzle, state): VraiFauxAction {
    return { kind: 'answer', says: puzzle.cards[state.card]!.truth };
  },

  wrongAction(puzzle: VraiFauxPuzzle, state: VraiFauxState, _rng: Rng): VraiFauxAction | null {
    const c = puzzle.cards[state.card];
    return c ? { kind: 'answer', says: !c.truth } : null;
  },

  validate(puzzle: VraiFauxPuzzle, scene: Scene): string[] {
    const p: string[] = [];
    if (puzzle.cards.length < 2 || puzzle.cards.length > 8) p.push(`vrai-faux: ${puzzle.cards.length} cards`);
    const nTrue = puzzle.cards.filter((c) => c.truth).length;
    if (nTrue < 1 || nTrue === puzzle.cards.length) p.push('vrai-faux: the answers are all the same');
    const frs = new Set<string>();
    puzzle.cards.forEach((c, i) => {
      const ref = unitRef(scene, c.unitId);
      if (!ref) {
        p.push(`vrai-faux: card ${i}: unit ${c.unitId} is not in the scene`);
        return;
      }
      if (ref.line.id !== c.lineId) p.push(`vrai-faux: card ${i}: the unit is not in line ${c.lineId}`);
      if (normalizeEn(c.rightEn) !== normalizeEn(ref.unit.en)) p.push(`vrai-faux: card ${i}: rightEn is not the unit's English`);
      if (c.truth && normalizeEn(c.shownEn) !== normalizeEn(ref.unit.en)) p.push(`vrai-faux: card ${i}: a true card shows another meaning`);
      if (!c.truth) {
        if (!normalizeEn(c.shownEn)) p.push(`vrai-faux: card ${i}: empty meaning`);
        if (closeInMeaning(c.shownEn, ref.unit.en)) p.push(`vrai-faux: card ${i}: the false meaning "${c.shownEn}" is close in meaning to "${ref.unit.en}"`);
        if (relatedGlosses(scene, ref.unit).some((g) => closeInMeaning(g, c.shownEn))) p.push(`vrai-faux: card ${i}: the false meaning "${c.shownEn}" is close to the English of related French`);
      }
      const fr = normalizeFr(ref.unit.fr);
      if (frs.has(fr)) p.push(`vrai-faux: card ${i}: the same French twice`);
      frs.add(fr);
    });
    p.push(...checkHelp('vrai-faux', scene, puzzle.helpLineIds, puzzle.cards.map((c) => c.lineId), puzzle.unitIds));
    return p;
  },
};
