// "Matching": French words or expressions of the scene on one side, their English on the other; the
// kid pairs them. Every tap on a French tile loops it (its v1 drill once when it has one, then the
// scene window). A right pair locks together; a wrong pair wobbles, counts a mistake against that
// French tile, and after two wrong pairs on the same French tile its English glows.
//
// Pairs are key units of the scene (4 at bronze, 5 at silver and gold, 6 from titanium), all French
// distinct and all English distinct (no near-duplicate glosses), spread over several lines, the
// kid's weak units first and units already used in this practice last.
//
// Also home of small helpers the other puzzle types of this family share (normFr, nameLike, unitScore).

import type { Line, Scene, Unit } from '../content';
import type { BotHooks } from '../practice/bot';
import type { Rng } from '../practice/rng';
import type { BuildCtx, PuzzleType, PuzzleBase } from '../practice/types';
import { WRONG_BEFORE_REVEAL } from '../rules';
import { frenchRelated, sharedEnWords } from './distinct';
import { nearlyEqual, normalizeEn } from './listen-pick';

// ---- shared helpers ------------------------------------------------------------------------------

/** French compared for equality: lower case, apostrophes unified, no punctuation, single spaces (accents kept). */
export function normFr(s: string): string {
  return s
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/[^\p{L}\p{N}' -]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The same without accents (two words equal here would look like the same answer to a kid). */
export function foldFr(s: string): string {
  return normFr(s).normalize('NFD').replace(/\p{M}+/gu, '');
}

/** A unit whose English is its French (proper names, "Obélix" = "Obélix"): no meaning to match. */
export function nameLike(u: Pick<Unit, 'fr' | 'en'>): boolean {
  return foldFr(u.fr) === foldFr(u.en) || normalizeEn(u.en) === '';
}

export function letterCount(s: string): number {
  return (s.match(/[\p{L}\p{N}]/gu) ?? []).length;
}

export function wordCount(s: string): number {
  return (s.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) ?? []).length;
}

export function lineOf(scene: Scene, unitId: string): Line | undefined {
  const lineId = unitId.slice(0, unitId.lastIndexOf(':'));
  return scene.lines.find((l) => l.id === lineId);
}

export function unitOf(scene: Scene, unitId: string): Unit | undefined {
  return lineOf(scene, unitId)?.units.find((u) => u.id === unitId);
}

/** The ids of the lines holding these units, in scene order. */
export function linesFor(scene: Scene, unitIds: readonly string[]): string[] {
  const want = new Set(unitIds.map((id) => id.slice(0, id.lastIndexOf(':'))));
  return scene.lines.filter((l) => want.has(l.id)).map((l) => l.id);
}

// ---- the puzzleType ------------------------------------------------------------------------------------

export interface MatchPair {
  unitId: string;
  fr: string;
  en: string;
  drill?: string; // the unit's v1 drill, played through once before the scene loop
}

export interface MatchPuzzle extends PuzzleBase {
  type: 'match';
  pairs: MatchPair[]; // in the order of the French column
  enOrder: number[]; // the English column: pair indices, shuffled
}

export interface MatchState {
  matched: number[]; // pair indices locked together, in order
  wrong: number[]; // per pair (French tile): wrong pairings so far
  mistakes: number;
}

/** Pair French tile `fr` with English tile `en` (both pair indices). */
export type MatchAction = { kind: 'pair'; fr: number; en: number };

export const MATCH_MIN_PAIRS = 4;
export const MATCH_MAX_PAIRS = 6;
/** Longest French on a tile (characters); longer units are used only when nothing else fits. */
const TILE_MAX_CHARS = 26;

export function pairsForLevel(level: number): number {
  return level <= 1 ? 4 : level <= 3 ? 5 : 6;
}

/**
 * True when two units could not both be on the board: every English card is a wrong choice for every
 * other French one, so no two may be close in meaning (nearly equal English or a shared English content
 * word) or have related French (the same, or a shared content word), as in docs/app-games.md, "Choices".
 */
export function clash(a: Pick<Unit, 'fr' | 'en'>, b: Pick<Unit, 'fr' | 'en'>): boolean {
  return foldFr(a.fr) === foldFr(b.fr) || nearlyEqual(a.en, b.en) || sharedEnWords(a.en, b.en).length > 0 || frenchRelated(a.fr, b.fr);
}

export const match: PuzzleType<MatchPuzzle, MatchState, MatchAction> & BotHooks<MatchPuzzle, MatchState, MatchAction> = {
  type: 'match',
  meta: {
    role: 'recognise',
    minLevel: 1,
    maxLevel: 6,
    needsMic: false,
    seconds: 30,
    weight: 3,
    name: 'Match pairs',
    purpose:
      'French words and expressions of the scene on one side, their English on the other; the kid pairs them, hearing each French piece loop. Reinforces the meaning of single units, drawn from several lines.',
    depth: 'intro',
    scope: 'unit',
  },

  build(ctx: BuildCtx): MatchPuzzle | null {
    const { scene, rng, focusUnitIds, usedUnitIds } = ctx;
    const want = pairsForLevel(ctx.level);
    const all: { u: Unit; line: Line }[] = [];
    for (const line of scene.lines)
      for (const u of line.units) if (u.key && normalizeEn(u.en) && letterCount(u.fr) > 0) all.push({ u, line });
    if (all.length < MATCH_MIN_PAIRS) return null;

    const scored = all.map(({ u, line }) => {
      let score = rng.next() * 2;
      if (focusUnitIds.has(u.id)) score += 5;
      if (nameLike(u)) score -= 4;
      if (u.fr.length > TILE_MAX_CHARS) score -= 6;
      if (line.approxTimes) score -= 1; // its loop is the whole line
      if (u.drill) score += 0.5;
      return { u, line, score, used: usedUnitIds.has(u.id) };
    });
    scored.sort((a, b) => Number(a.used) - Number(b.used) || b.score - a.score);

    // Greedy, spreading over lines: at most two units of one line in a first pass. A targeted build
    // (the replacement of a speaking round) puts the asked units on the board first, or returns null.
    const picked: { u: Unit; line: Line }[] = [];
    if (ctx.targetUnitIds?.length) {
      for (const id of ctx.targetUnitIds) {
        const c = scored.find((x) => x.u.id === id);
        if (c && picked.length < want && !picked.some((p) => clash(p.u, c.u))) picked.push(c);
      }
      if (!picked.length) return null;
    }
    for (const perLine of [2, Infinity]) {
      for (const c of scored) {
        if (picked.length >= want) break;
        if (picked.some((p) => p.u.id === c.u.id)) continue;
        if (picked.filter((p) => p.line.id === c.line.id).length >= perLine) continue;
        if (picked.some((p) => clash(p.u, c.u))) continue;
        picked.push(c);
      }
    }
    if (picked.length < MATCH_MIN_PAIRS) return null;

    // The French column in scene order (it reads like the dialogue); the English shuffled, and never
    // in the same order as the French.
    const order = new Map(scene.lines.map((l, i) => [l.id, i]));
    picked.sort((a, b) => order.get(a.line.id)! - order.get(b.line.id)! || a.u.cs - b.u.cs);
    const pairs: MatchPair[] = picked.map(({ u }) => ({ unitId: u.id, fr: u.fr, en: u.en, ...(u.drill ? { drill: u.drill } : {}) }));
    let enOrder = rng.shuffle(pairs.map((_, i) => i));
    if (enOrder.every((v, i) => v === i)) enOrder = [...enOrder.slice(1), enOrder[0]!];

    for (const p of pairs) usedUnitIds.add(p.unitId);
    const unitIds = pairs.map((p) => p.unitId);
    return {
      id: `${scene.id}:match`,
      type: 'match',
      sceneId: scene.id,
      helpLineIds: linesFor(scene, unitIds),
      unitIds,
      pairs,
      enOrder,
    };
  },

  init(puzzle): MatchState {
    return { matched: [], wrong: puzzle.pairs.map(() => 0), mistakes: 0 };
  },

  reduce(puzzle, state, action): MatchState {
    if (!action || action.kind !== 'pair') return state;
    const { fr, en } = action;
    if (!puzzle.pairs[fr] || !puzzle.pairs[en]) return state;
    if (state.matched.includes(fr) || state.matched.includes(en)) return state;
    if (fr === en) return { ...state, matched: [...state.matched, fr] };
    const wrong = state.wrong.slice();
    wrong[fr] = (wrong[fr] ?? 0) + 1;
    return { ...state, wrong, mistakes: state.mistakes + 1 };
  },

  isDone(puzzle, state) {
    return state.matched.length >= puzzle.pairs.length;
  },

  mistakes(_puzzle, state) {
    return state.mistakes;
  },

  missedUnitIds(puzzle, state) {
    return puzzle.pairs.filter((_, i) => (state.wrong[i] ?? 0) > 0).map((p) => p.unitId);
  },

  solve(puzzle, state): MatchAction {
    const i = puzzle.pairs.findIndex((_, k) => !state.matched.includes(k));
    return { kind: 'pair', fr: i, en: i };
  },

  wrongAction(puzzle: MatchPuzzle, state: MatchState, rng: Rng): MatchAction | null {
    const open = puzzle.pairs.map((_, i) => i).filter((i) => !state.matched.includes(i));
    if (open.length < 2) return null;
    const fr = rng.pick(open);
    const en = rng.pick(open.filter((i) => i !== fr));
    return { kind: 'pair', fr, en };
  },

  validate(puzzle: MatchPuzzle, scene: Scene): string[] {
    const p: string[] = [];
    const n = puzzle.pairs.length;
    if (n < MATCH_MIN_PAIRS || n > MATCH_MAX_PAIRS) p.push(`match: ${n} pairs, expected ${MATCH_MIN_PAIRS}-${MATCH_MAX_PAIRS}`);
    const sorted = [...puzzle.enOrder].sort((a, b) => a - b);
    if (sorted.length !== n || sorted.some((v, i) => v !== i)) p.push('match: enOrder is not a permutation of the pairs');
    const ids = new Set<string>();
    puzzle.pairs.forEach((pair, i) => {
      if (ids.has(pair.unitId)) p.push(`match: unit ${pair.unitId} appears twice`);
      ids.add(pair.unitId);
      const u = unitOf(scene, pair.unitId);
      const line = lineOf(scene, pair.unitId);
      if (!u || !line) {
        p.push(`match: unit ${pair.unitId} is not in the scene`);
        return;
      }
      if (u.fr !== pair.fr || u.en !== pair.en) p.push(`match: pair ${i} does not match unit ${u.id}`);
      if (!normalizeEn(pair.en)) p.push(`match: pair ${i} has no English`);
      if (!letterCount(pair.fr)) p.push(`match: pair ${i} has no French`);
      if ((pair.drill ?? null) !== (u.drill ?? null)) p.push(`match: pair ${i} drill differs from the unit's`);
      if (!puzzle.helpLineIds.includes(line.id)) p.push(`match: line ${line.id} is not on the help strip`);
      if (!puzzle.unitIds.includes(u.id)) p.push(`match: unit ${u.id} missing from unitIds`);
      if (u.endMs <= u.startMs) p.push(`match: unit ${u.id} has an empty window`);
    });
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        const a = puzzle.pairs[i]!;
        const b = puzzle.pairs[j]!;
        if (foldFr(a.fr) === foldFr(b.fr)) p.push(`match: French tiles ${i} and ${j} are the same ("${a.fr}")`);
        else if (frenchRelated(a.fr, b.fr)) p.push(`match: French tiles ${i} and ${j} are related ("${a.fr}" / "${b.fr}")`);
        if (nearlyEqual(a.en, b.en)) p.push(`match: English tiles ${i} and ${j} are nearly equal ("${a.en}" / "${b.en}")`);
        else if (sharedEnWords(a.en, b.en).length) p.push(`match: English tiles ${i} and ${j} are close in meaning ("${a.en}" / "${b.en}")`);
      }
    return p;
  },
};

/** After this many wrong pairings of one French tile, the view makes its English glow. */
export const MATCH_REVEAL_AFTER = WRONG_BEFORE_REVEAL;
