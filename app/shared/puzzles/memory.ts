// "Memory" (memory): face-down shields; a French shield speaks its expression (it loops) and shows
// it, an English shield shows a meaning; find the pairs. A found pair slams together and loops once
// more. Four pairs for a new scene, up to six later. Role: fun.
//
// French and English shields have different backs (the view), and while one shield is face up the
// others of its language cannot be turned: a pair is always one of each, so turning two of the same
// language would only waste the kid's time. Turning a French and an English shield that do not match
// is part of the puzzle, not a mistake, unless the kid had already seen where the first shield's
// partner was (then they could have known): that counts a mistake on the pair. After two such
// mistakes on a pair, its partner peeks out whenever one of its shields is turned. From gold (level 3)
// a French shield only speaks (no text until found), so the pairs are made by ear. A mismatched pair
// stays face up until the next tap, which turns them back and turns the tapped shield, so the logic
// never waits for an animation.

import type { Scene } from '../content';
import type { BotHooks } from '../practice/bot';
import type { Rng } from '../practice/rng';
import type { BuildCtx, PuzzleType, PuzzleBase } from '../practice/types';
import { WRONG_BEFORE_REVEAL } from '../rules';
import { candidateUnits, checkHelp, closeInMeaning, frenchRelated, normalizeEn, normalizeFr, pickDistinctUnits, rankUnits, uniq, unitRef } from './arcade';

export interface MemoryPair {
  unitId: string;
  lineId: string;
  fr: string;
  en: string;
}

export interface MemoryCard {
  pair: number;
  side: 'fr' | 'en';
}

export interface MemoryPuzzle extends PuzzleBase {
  type: 'memory';
  pairs: MemoryPair[];
  cards: MemoryCard[]; // display order
  hideFrench: boolean; // from gold (level 3): a French shield only speaks (its text shows once the pair is found)
}

export interface MemoryState {
  open: number[]; // face-up, unmatched card indices (0, 1, or a mismatched 2)
  matched: number[]; // pair indices found, in order
  seen: number[]; // card indices ever turned
  wrongAt: number[]; // mistakes per pair
}

export type MemoryAction = { kind: 'flip'; card: number };

export const MEMORY_REVEAL_AFTER = WRONG_BEFORE_REVEAL;
/** From this level a French shield shows no text until its pair is found: the kid matches by ear. */
export const MEMORY_HIDE_FRENCH_FROM = 3;

export function memoryPairs(level: number): number {
  if (level <= 3) return 4;
  if (level <= 4) return 5;
  return 6;
}

export function partnerOf(puzzle: MemoryPuzzle, card: number): number {
  const c = puzzle.cards[card]!;
  return puzzle.cards.findIndex((x, i) => i !== card && x.pair === c.pair);
}

/**
 * The shields that cannot be turned now: while exactly one is face up, the others of its language
 * (a pair is always one French and one English shield).
 */
export function lockedSide(puzzle: MemoryPuzzle, state: MemoryState): 'fr' | 'en' | null {
  return state.open.length === 1 ? puzzle.cards[state.open[0]!]!.side : null;
}

export const memory: PuzzleType<MemoryPuzzle, MemoryState, MemoryAction> & BotHooks<MemoryPuzzle, MemoryState, MemoryAction> = {
  type: 'memory',
  meta: {
    role: 'fun',
    minLevel: 1,
    maxLevel: 6,
    needsMic: false,
    seconds: 35,
    weight: 2,
    name: 'Memory',
    purpose:
      'Face-down shields hide French expressions and their English; the kid finds the pairs, by ear from gold. Reinforces linking units to their meaning.',
    depth: 'core',
    scope: 'unit',
  },

  build(ctx: BuildCtx): MemoryPuzzle | null {
    const { scene, rng } = ctx;
    const want = memoryPairs(ctx.level);
    // Every English shield is a wrong choice for every other French one: no two pairs close in meaning
    // or with related French (docs/app-games.md, "Choices"), which matters most when matched by ear.
    const units = pickDistinctUnits(rankUnits(candidateUnits(ctx).filter((r) => r.unit.fr.length <= 30 && r.unit.en.length <= 32), ctx, rng), want, { apart: true });
    // A targeted build (one line) may have two pairs; otherwise at least three.
    if (units.length < (ctx.targetLineId ? 2 : 3)) return null;
    const pairs: MemoryPair[] = units.map(({ line, unit }) => ({ unitId: unit.id, lineId: line.id, fr: unit.fr.trim(), en: unit.en.trim() }));
    const cards = rng.shuffle(pairs.flatMap((_, i) => [{ pair: i, side: 'fr' as const }, { pair: i, side: 'en' as const }]));
    for (const p of pairs) {
      ctx.usedUnitIds.add(p.unitId);
      ctx.usedLineIds.add(p.lineId);
    }
    return {
      id: `${scene.id}:memory:${pairs[0]!.unitId}`,
      type: 'memory',
      sceneId: scene.id,
      helpLineIds: uniq(pairs.map((p) => p.lineId)),
      unitIds: pairs.map((p) => p.unitId),
      pairs,
      cards,
      hideFrench: ctx.level >= MEMORY_HIDE_FRENCH_FROM,
    };
  },

  init(puzzle): MemoryState {
    return { open: [], matched: [], seen: [], wrongAt: puzzle.pairs.map(() => 0) };
  },

  reduce(puzzle, state, action): MemoryState {
    if (!action || action.kind !== 'flip') return state;
    const card = action.card;
    const c = puzzle.cards[card];
    if (!c || state.matched.includes(c.pair) || state.matched.length >= puzzle.pairs.length) return state;
    const seen = state.seen.includes(card) ? state.seen : [...state.seen, card];
    // A mismatched pair (or nothing) is face up: turn it back and turn this one.
    if (state.open.length !== 1) return { ...state, open: [card], seen };
    const first = state.open[0]!;
    if (first === card) return state;
    if (puzzle.cards[first]!.side === c.side) return state; // the same language as the face-up shield: locked
    if (puzzle.cards[first]!.pair === c.pair) return { ...state, open: [], matched: [...state.matched, c.pair], seen };
    // A mismatch: a mistake only when the first shield's partner had been seen before.
    const knew = state.seen.includes(partnerOf(puzzle, first));
    const wrongAt = knew ? state.wrongAt.map((n, i) => (i === puzzle.cards[first]!.pair ? n + 1 : n)) : state.wrongAt;
    return { ...state, open: [first, card], seen, wrongAt };
  },

  isDone(puzzle, state) {
    return state.matched.length >= puzzle.pairs.length;
  },

  mistakes(_puzzle, state) {
    return state.wrongAt.reduce((a, b) => a + b, 0);
  },

  missedUnitIds(puzzle, state) {
    return puzzle.pairs.filter((_, i) => (state.wrongAt[i] ?? 0) > 0).map((p) => p.unitId);
  },

  /** A player with a perfect memory: match what is known, otherwise turn a shield not seen yet. */
  solve(puzzle, state): MemoryAction {
    const free = puzzle.cards.map((_, i) => i).filter((i) => !state.matched.includes(puzzle.cards[i]!.pair));
    if (state.open.length === 1) {
      const first = state.open[0]!;
      const partner = partnerOf(puzzle, first);
      if (state.seen.includes(partner)) return { kind: 'flip', card: partner };
      const side = puzzle.cards[first]!.side;
      const unseen = free.filter((i) => i !== first && puzzle.cards[i]!.side !== side && !state.seen.includes(i));
      return { kind: 'flip', card: unseen[0] ?? partner };
    }
    const known = free.find((i) => state.seen.includes(i) && state.seen.includes(partnerOf(puzzle, i)));
    if (known !== undefined) return { kind: 'flip', card: known };
    const unseen = free.find((i) => !state.seen.includes(i));
    return { kind: 'flip', card: unseen ?? free[0]! };
  },

  /** A wrong move exists only when a shield is up whose partner the kid has already seen: another shield of the other language. */
  wrongAction(puzzle: MemoryPuzzle, state: MemoryState, rng: Rng): MemoryAction | null {
    if (state.open.length !== 1) return null;
    const first = state.open[0]!;
    const partner = partnerOf(puzzle, first);
    if (!state.seen.includes(partner)) return null;
    const side = puzzle.cards[first]!.side;
    const others = puzzle.cards
      .map((_, i) => i)
      .filter((i) => i !== first && i !== partner && puzzle.cards[i]!.side !== side && !state.matched.includes(puzzle.cards[i]!.pair));
    return others.length ? { kind: 'flip', card: rng.pick(others) } : null;
  },

  validate(puzzle: MemoryPuzzle, scene: Scene): string[] {
    const p: string[] = [];
    if (puzzle.pairs.length < 2 || puzzle.pairs.length > 6) p.push(`memory: ${puzzle.pairs.length} pairs`);
    if (puzzle.cards.length !== puzzle.pairs.length * 2) p.push('memory: not two cards per pair');
    puzzle.pairs.forEach((pair, i) => {
      const sides = puzzle.cards.filter((c) => c.pair === i).map((c) => c.side).sort().join(',');
      if (sides !== 'en,fr') p.push(`memory: pair ${i} does not have one French and one English card`);
      const ref = unitRef(scene, pair.unitId);
      if (!ref) {
        p.push(`memory: pair ${i}: unit ${pair.unitId} is not in the scene`);
        return;
      }
      if (ref.line.id !== pair.lineId) p.push(`memory: pair ${i}: the unit is not in line ${pair.lineId}`);
      if (pair.fr !== ref.unit.fr.trim()) p.push(`memory: pair ${i}: the French is not the unit's`);
      if (normalizeEn(pair.en) !== normalizeEn(ref.unit.en)) p.push(`memory: pair ${i}: the English is not the unit's`);
      for (let j = i + 1; j < puzzle.pairs.length; j++) {
        const o = puzzle.pairs[j]!;
        if (normalizeFr(o.fr) === normalizeFr(pair.fr)) p.push(`memory: pairs ${i} and ${j} have the same French`);
        else if (frenchRelated(o.fr, pair.fr)) p.push(`memory: pairs ${i} and ${j} have related French ("${pair.fr}" / "${o.fr}")`);
        if (closeInMeaning(o.en, pair.en)) p.push(`memory: pairs ${i} and ${j} are close in meaning ("${pair.en}" / "${o.en}")`);
      }
    });
    p.push(...checkHelp('memory', scene, puzzle.helpLineIds, puzzle.pairs.map((x) => x.lineId), puzzle.unitIds));
    return p;
  },
};
