// "Place the words" (place-words): the opener of a practice, replacing `watch`. The whole scene
// loops with its slideshow and its full dialogue strip; up to five words or expressions are lifted
// out of the strip (key units, spread over as many lines as possible, never two with the same text)
// and wait in a tray; the kid puts each into its gap, finding it by listening while the scene plays
// and the current line lights up. Either order: a piece then its gap, or a gap then its piece; the
// action names both. Role: intro, scope: scene.
//
// A piece put in the wrong gap bounces back and counts one mistake, on that piece and on that gap.
// After two on the same piece its gap glows; after two on the same gap its piece glows (the view
// shows whichever the kid has selected). A line with approxTimes can have a gap: nothing here needs
// word timing.

import type { Scene, Unit } from '../content';
import type { BotHooks } from '../practice/bot';
import type { Rng } from '../practice/rng';
import type { BuildCtx, PuzzleType, PuzzleBase } from '../practice/types';
import { WRONG_BEFORE_REVEAL } from '../rules';
import { checkHelp, meaningUnits, normalizeFr, unitRef } from './arcade';

export interface PlaceWordsPuzzle extends PuzzleBase {
  type: 'place-words';
  gaps: string[]; // unit ids lifted out of the strip, in scene order
  tray: string[]; // the same unit ids, in tray order (shuffled)
}

export interface PlaceWordsState {
  placed: string[]; // unit ids put in their gap, in the order placed
  wrong: number[]; // per tray piece: wrong gaps tried
  wrongGap: number[]; // per gap (puzzle.gaps order): wrong pieces tried
}

export type PlaceWordsAction = { kind: 'place'; piece: string; gap: string };

export const PLACE_MAX = 5;
export const PLACE_REVEAL_AFTER = WRONG_BEFORE_REVEAL;

/**
 * What glows for the kid's selection: with a piece selected, its gap after PLACE_REVEAL_AFTER wrong
 * gaps for it; with a gap selected, its piece after as many wrong pieces for it. The answer is always
 * the same unit id (a gap's piece is the gap's unit).
 */
export function placeReveal(puzzle: PlaceWordsPuzzle, state: PlaceWordsState, sel: { piece?: string | null; gap?: string | null }): string | null {
  if (sel.piece && !state.placed.includes(sel.piece) && (state.wrong[puzzle.tray.indexOf(sel.piece)] ?? 0) >= PLACE_REVEAL_AFTER) return sel.piece;
  if (sel.gap && !state.placed.includes(sel.gap) && (state.wrongGap[puzzle.gaps.indexOf(sel.gap)] ?? 0) >= PLACE_REVEAL_AFTER) return sel.gap;
  return null;
}

function eligible(u: Unit): boolean {
  const fr = normalizeFr(u.fr);
  return u.key && !!fr && u.fr.trim().length <= 30;
}

export const placeWords: PuzzleType<PlaceWordsPuzzle, PlaceWordsState, PlaceWordsAction> & BotHooks<PlaceWordsPuzzle, PlaceWordsState, PlaceWordsAction> = {
  type: 'place-words',
  meta: {
    role: 'intro',
    minLevel: 1,
    maxLevel: 6,
    needsMic: false,
    seconds: 70,
    weight: 1,
    name: 'Place the words',
    purpose:
      'The whole scene loops with its pictures and dialogue; up to five words or expressions are missing and wait in a tray, and the kid puts each where it is said, by listening. A first, active pass over the whole scene.',
    depth: 'intro',
    scope: 'scene',
  },

  build(ctx: BuildCtx): PlaceWordsPuzzle | null {
    const { scene, rng } = ctx;
    // Meaning units first (they teach something), then other key units (names) when short of pieces.
    const meaning = new Set(meaningUnits(scene).map((r) => r.unit.id));
    // Text said more than once in the scene (a chorus) makes a poor gap: the kid hears it in two places.
    const said = new Map<string, number>();
    for (const u of scene.lines.flatMap((l) => l.units)) said.set(normalizeFr(u.fr), (said.get(normalizeFr(u.fr)) ?? 0) + 1);
    const perLine = scene.lines.map((l) => {
      const us = l.units.filter(eligible);
      const ranked = rng
        .shuffle(us)
        .map((u) => ({ u, score: (meaning.has(u.id) ? 4 : 0) + (ctx.focusUnitIds.has(u.id) ? 3 : 0) + (ctx.usedUnitIds.has(u.id) ? -2 : 0) + ((said.get(normalizeFr(u.fr)) ?? 0) > 1 ? -5 : 0) }))
        .sort((a, b) => b.score - a.score)
        .map((x) => x.u);
      return ranked;
    });
    // Round-robin over the lines (in a random order), one unit per line per round.
    const order = rng.shuffle(scene.lines.map((_, i) => i));
    const chosen: Unit[] = [];
    const texts = new Set<string>();
    for (let round = 0; chosen.length < PLACE_MAX; round++) {
      let any = false;
      for (const i of order) {
        if (chosen.length >= PLACE_MAX) break;
        const pick = perLine[i]!.find((u) => !texts.has(normalizeFr(u.fr)) && !chosen.includes(u));
        if (!pick) continue;
        // In later rounds only meaning units: a second name in a line is not worth a gap.
        if (round > 0 && !meaning.has(pick.id)) continue;
        chosen.push(pick);
        texts.add(normalizeFr(pick.fr));
        any = true;
      }
      if (!any) break;
    }
    if (chosen.length < 2) return null;
    const pos = new Map(scene.lines.flatMap((l, li) => l.units.map((u, ui) => [u.id, li * 1000 + ui] as const)));
    const gaps = chosen.map((u) => u.id).sort((a, b) => pos.get(a)! - pos.get(b)!);
    let tray = rng.shuffle(gaps);
    if (tray.length > 1 && tray.join('|') === gaps.join('|')) tray = [...tray.slice(1), tray[0]!];
    for (const id of gaps) ctx.usedUnitIds.add(id);
    return {
      id: `${scene.id}:place-words`,
      type: 'place-words',
      sceneId: scene.id,
      helpLineIds: scene.lines.map((l) => l.id),
      unitIds: gaps.slice(),
      gaps,
      tray,
    };
  },

  init(puzzle): PlaceWordsState {
    return { placed: [], wrong: puzzle.tray.map(() => 0), wrongGap: puzzle.gaps.map(() => 0) };
  },

  reduce(puzzle, state, action): PlaceWordsState {
    if (!action || action.kind !== 'place') return state;
    const pi = puzzle.tray.indexOf(action.piece);
    if (pi < 0 || state.placed.includes(action.piece)) return state;
    if (!puzzle.gaps.includes(action.gap) || state.placed.includes(action.gap)) return state; // not an open gap
    if (action.piece === action.gap) return { ...state, placed: [...state.placed, action.piece] };
    const wrong = state.wrong.slice();
    wrong[pi] = (wrong[pi] ?? 0) + 1;
    const gi = puzzle.gaps.indexOf(action.gap);
    const wrongGap = state.wrongGap.slice();
    wrongGap[gi] = (wrongGap[gi] ?? 0) + 1;
    return { ...state, wrong, wrongGap };
  },

  isDone(puzzle, state) {
    return state.placed.length >= puzzle.gaps.length;
  },

  // One wrong move is one mistake (counted on the piece; wrongGap counts the same moves by gap).
  mistakes(_puzzle, state) {
    return state.wrong.reduce((a, b) => a + b, 0);
  },

  missedUnitIds(puzzle, state) {
    return puzzle.tray.filter((_, i) => (state.wrong[i] ?? 0) > 0);
  },

  solve(puzzle, state): PlaceWordsAction {
    const piece = puzzle.gaps.find((g) => !state.placed.includes(g))!;
    return { kind: 'place', piece, gap: piece };
  },

  wrongAction(puzzle: PlaceWordsPuzzle, state: PlaceWordsState, rng: Rng): PlaceWordsAction | null {
    const open = puzzle.gaps.filter((g) => !state.placed.includes(g));
    if (open.length < 2) return null;
    const piece = rng.pick(open);
    return { kind: 'place', piece, gap: rng.pick(open.filter((g) => g !== piece)) };
  },

  validate(puzzle: PlaceWordsPuzzle, scene: Scene): string[] {
    const p: string[] = [];
    if (puzzle.gaps.length < 2 || puzzle.gaps.length > PLACE_MAX) p.push(`place-words: ${puzzle.gaps.length} gaps`);
    if ([...puzzle.tray].sort().join('|') !== [...puzzle.gaps].sort().join('|')) p.push('place-words: the tray is not the gaps');
    if (new Set(puzzle.gaps).size !== puzzle.gaps.length) p.push('place-words: a gap twice');
    const texts = new Set<string>();
    for (const id of puzzle.gaps) {
      const r = unitRef(scene, id);
      if (!r) {
        p.push(`place-words: unit ${id} is not in the scene`);
        continue;
      }
      const k = normalizeFr(r.unit.fr);
      if (texts.has(k)) p.push(`place-words: two pieces read "${r.unit.fr}"`);
      texts.add(k);
    }
    p.push(...checkHelp('place-words', scene, puzzle.helpLineIds, [], puzzle.unitIds));
    return p;
  },
};
