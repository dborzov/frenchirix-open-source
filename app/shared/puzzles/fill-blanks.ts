// "Fill the blanks": one line of the scene loops, its English is shown, and 1 to 4 of its key units
// (the words that carry meaning, not grammar) are blanks. The kid taps words from a bank (the
// missing pieces plus distractors) and each flies into the next blank, or into the blank they chose.
// A wrong word bounces back and counts a mistake against that blank; after two wrong words on one
// blank the right word glows in the bank.
//
// Blanks: the kid's weak units first, then the most meaningful (expressions, longer words), never
// proper names when anything else is there; more blanks with the level. Distractors: other key
// units of the scene first (not of this line), then the practice's other scenes, then the content
// bank; never a text equal to any blank's (accents and punctuation ignored), never sharing a French
// content word with a blank or with another distractor, never a meaning close to a blank's or to
// another distractor's (docs/app-games.md, "Choices").

import type { Line, Scene, Unit } from '../content';
import type { BotHooks } from '../practice/bot';
import type { Rng } from '../practice/rng';
import type { BuildCtx, PuzzleType, PuzzleBase } from '../practice/types';
import { WRONG_BEFORE_REVEAL } from '../rules';
import { frenchRelated, sharedEnWords } from './distinct';
import { nearlyEqual, normalizeEn } from './listen-pick';
import { foldFr, letterCount, nameLike, wordCount } from './match';

export interface FillBlank {
  unitId: string;
  fr: string;
}

export interface FillWord {
  fr: string;
}

export interface FillBlanksPuzzle extends PuzzleBase {
  type: 'fill-blanks';
  lineId: string;
  blanks: FillBlank[]; // in line order
  words: FillWord[]; // the bank, shuffled: every blank's French plus distractors
}

export interface FillBlanksState {
  filled: (number | null)[]; // per blank: the bank index placed there (only right words stay)
  wrong: number[]; // per blank: wrong words tried
  mistakes: number;
}

/** Put bank word `word` into blank `blank`. */
export type FillBlanksAction = { kind: 'place'; blank: number; word: number };

export const FILL_REVEAL_AFTER = WRONG_BEFORE_REVEAL;
export const FILL_MAX_BLANKS = 4;
export const FILL_MAX_WORDS = 8;

export function blanksForLevel(level: number): number {
  return level <= 1 ? 1 : level === 2 ? 2 : level <= 4 ? 3 : 4;
}
export function distractorsForLevel(level: number): number {
  return level <= 1 ? 2 : level <= 3 ? 3 : 4;
}

/** How much a unit is worth blanking: meaning first. */
function signature(u: Unit): number {
  let s = Math.min(letterCount(u.fr), 12) / 3;
  if (u.kind === 'expression') s += 2;
  if (nameLike(u)) s -= 6;
  if (letterCount(u.fr) <= 2) s -= 3;
  return s;
}

function blankable(u: Unit): boolean {
  return u.key && letterCount(u.fr) > 0 && u.fr.length <= 30;
}

/** True when word `w` is a right answer for blank `b`. */
export function fits(puzzle: FillBlanksPuzzle, b: number, w: number): boolean {
  const blank = puzzle.blanks[b];
  const word = puzzle.words[w];
  return !!blank && !!word && foldFr(blank.fr) === foldFr(word.fr);
}

/** Bank indices not placed yet. */
export function freeWords(puzzle: FillBlanksPuzzle, state: FillBlanksState): number[] {
  const used = new Set(state.filled.filter((x): x is number => x !== null));
  return puzzle.words.map((_, i) => i).filter((i) => !used.has(i));
}

/** The first empty blank, or -1. */
export function nextBlank(state: FillBlanksState): number {
  return state.filled.findIndex((x) => x === null);
}

function lineUsable(line: Line): boolean {
  const n = wordCount(line.fr);
  return n >= 2 && n <= 22 && line.units.length >= 2 && !!normalizeEn(line.en) && line.units.some(blankable);
}

export const fillBlanks: PuzzleType<FillBlanksPuzzle, FillBlanksState, FillBlanksAction> & BotHooks<FillBlanksPuzzle, FillBlanksState, FillBlanksAction> = {
  type: 'fill-blanks',
  meta: {
    role: 'recall',
    minLevel: 1,
    maxLevel: 6,
    needsMic: false,
    seconds: 22,
    weight: 3,
    name: "Fill the blanks",
    purpose:
      "One line loops with its English shown; one to four of its key words are blanks, filled by tapping from a word bank. Reinforces recalling a line's key expressions in context.",
    depth: 'core',
    scope: 'line',
  },

  build(ctx: BuildCtx): FillBlanksPuzzle | null {
    const { scene, rng, focusUnitIds, usedLineIds } = ctx;
    const target = ctx.targetLineId;
    const lines = scene.lines.filter((l) => (target ? l.id === target && l.units.length >= 2 && !!normalizeEn(l.en) : lineUsable(l)));
    if (!lines.length) return null;
    const targetUnits = target && ctx.targetUnitIds?.length ? new Set(ctx.targetUnitIds) : null;
    const want = blanksForLevel(ctx.level);

    const scored = lines.map((l) => {
      const blk = l.units.filter((u) => blankable(u) && !nameLike(u));
      const focus = blk.filter((u) => focusUnitIds.has(u.id)).length;
      const n = wordCount(l.fr);
      let score = focus * 4 + Math.min(blk.length, want) * 1.5 + rng.next() * 2;
      if (n < 3) score -= 2;
      if (n > 14 && ctx.level < 4) score -= 2;
      if (!blk.length) score -= 5;
      return { l, score, used: usedLineIds.has(l.id) };
    });
    scored.sort((a, b) => Number(a.used) - Number(b.used) || b.score - a.score);

    for (const { l: line } of scored) {
      // A targeted build blanks exactly the asked units (when they can be blanks), nothing else.
      const cands = targetUnits ? line.units.filter((u) => targetUnits.has(u.id) && blankable(u)) : line.units.filter(blankable);
      if (targetUnits && cands.length !== targetUnits.size) return null;
      // Never blank every unit of a line: keep at least one piece to read.
      const max = targetUnits ? Math.min(cands.length, FILL_MAX_BLANKS, line.units.length - 1) : Math.min(want, FILL_MAX_BLANKS, cands.length, line.units.length - 1);
      if (max < 1 || (targetUnits && max < cands.length)) continue;
      const ranked = cands
        .map((u) => ({ u, s: (focusUnitIds.has(u.id) ? 10 : 0) + signature(u) + rng.next() }))
        .sort((a, b) => b.s - a.s);
      const chosen = ranked.slice(0, max).map((x) => x.u);
      chosen.sort((a, b) => a.cs - b.cs);
      const blankFolds = new Set(chosen.map((u) => foldFr(u.fr)));

      // Distractors: other key units of the scene (not on this line), then other scenes, then the bank.
      const lineUnitFolds = new Set(line.units.map((u) => foldFr(u.fr)));
      const ok = ({ fr, en }: { fr: string; en: string }, have: Set<string>) => {
        const f = foldFr(fr);
        return (
          letterCount(fr) > 0 &&
          fr.length <= 30 &&
          !blankFolds.has(f) &&
          !lineUnitFolds.has(f) &&
          !have.has(f) &&
          ![...chosen, ...taken].some((u) => frenchRelated(fr, u.fr) || nearlyEqual(en, u.en) || sharedEnWords(en, u.en).length > 0)
        );
      };
      const keyGlosses = (l: Line) => l.units.filter((u) => u.key).map((u) => ({ fr: u.fr, en: u.en }));
      const pools: { fr: string; en: string }[][] = [
        rng.shuffle(scene.lines.filter((x) => x.id !== line.id).flatMap(keyGlosses)),
        rng.shuffle(ctx.others.flatMap((o) => o.lines.flatMap(keyGlosses))),
        rng.shuffle(ctx.bank.units),
      ];
      const nd = Math.min(distractorsForLevel(ctx.level), FILL_MAX_WORDS - chosen.length);
      const have = new Set<string>();
      const distractors: string[] = [];
      const taken: { fr: string; en: string }[] = []; // the distractors' glosses: no two close either
      // Prefer distractors of a similar length to the blanks (a kid should not pick by size alone).
      const lens = chosen.map((u) => u.fr.length);
      const similar = (fr: string) => lens.some((n) => fr.length >= n / 2 - 1 && fr.length <= n * 2 + 2);
      for (const strict of [true, false])
        for (const pool of pools)
          for (const g of pool) {
            if (distractors.length >= nd) break;
            if ((!strict || similar(g.fr)) && ok(g, have)) {
              distractors.push(g.fr);
              taken.push(g);
              have.add(foldFr(g.fr));
            }
          }
      if (distractors.length < Math.min(1, nd)) continue;

      const words = rng.shuffle([...chosen.map((u) => ({ fr: u.fr })), ...distractors.map((fr) => ({ fr }))]);
      usedLineIds.add(line.id);
      for (const u of chosen) ctx.usedUnitIds.add(u.id);
      return {
        id: `${scene.id}:fill-blanks:${line.id}`,
        type: 'fill-blanks',
        sceneId: scene.id,
        helpLineIds: [line.id],
        unitIds: chosen.map((u) => u.id),
        lineId: line.id,
        blanks: chosen.map((u) => ({ unitId: u.id, fr: u.fr })),
        words,
      };
    }
    return null;
  },

  init(puzzle): FillBlanksState {
    return { filled: puzzle.blanks.map(() => null), wrong: puzzle.blanks.map(() => 0), mistakes: 0 };
  },

  reduce(puzzle, state, action): FillBlanksState {
    if (!action || action.kind !== 'place') return state;
    const { blank, word } = action;
    if (!puzzle.blanks[blank] || !puzzle.words[word]) return state;
    if (state.filled[blank] !== null) return state;
    if (state.filled.includes(word)) return state;
    if (fits(puzzle, blank, word)) {
      const filled = state.filled.slice();
      filled[blank] = word;
      return { ...state, filled };
    }
    const wrong = state.wrong.slice();
    wrong[blank] = (wrong[blank] ?? 0) + 1;
    return { ...state, wrong, mistakes: state.mistakes + 1 };
  },

  isDone(_puzzle, state) {
    return state.filled.every((x) => x !== null);
  },

  mistakes(_puzzle, state) {
    return state.mistakes;
  },

  missedUnitIds(puzzle, state) {
    return puzzle.blanks.filter((_, i) => (state.wrong[i] ?? 0) > 0).map((b) => b.unitId);
  },

  solve(puzzle, state): FillBlanksAction {
    const blank = nextBlank(state);
    const word = freeWords(puzzle, state).find((w) => fits(puzzle, blank, w)) ?? -1;
    return { kind: 'place', blank, word };
  },

  wrongAction(puzzle: FillBlanksPuzzle, state: FillBlanksState, rng: Rng): FillBlanksAction | null {
    const blank = nextBlank(state);
    if (blank < 0) return null;
    const bad = freeWords(puzzle, state).filter((w) => !fits(puzzle, blank, w));
    return bad.length ? { kind: 'place', blank, word: rng.pick(bad) } : null;
  },

  validate(puzzle: FillBlanksPuzzle, scene: Scene): string[] {
    const p: string[] = [];
    const line = scene.lines.find((l) => l.id === puzzle.lineId);
    if (!line) return [`fill-blanks: line ${puzzle.lineId} is not in the scene`];
    if (!puzzle.helpLineIds.includes(line.id)) p.push('fill-blanks: the line is not on the help strip');
    const n = puzzle.blanks.length;
    if (n < 1 || n > FILL_MAX_BLANKS) p.push(`fill-blanks: ${n} blanks`);
    if (n >= line.units.length) p.push('fill-blanks: every unit of the line is blank');
    let lastCs = -1;
    const seen = new Set<string>();
    for (const b of puzzle.blanks) {
      const u = line.units.find((x) => x.id === b.unitId);
      if (!u) {
        p.push(`fill-blanks: blank ${b.unitId} is not in the line`);
        continue;
      }
      if (seen.has(u.id)) p.push(`fill-blanks: unit ${u.id} blanked twice`);
      seen.add(u.id);
      if (u.fr !== b.fr) p.push(`fill-blanks: blank ${u.id} text differs from the unit`);
      if (!u.key) p.push(`fill-blanks: blank ${u.id} is not a key unit`);
      if (u.cs <= lastCs) p.push('fill-blanks: blanks are not in line order');
      lastCs = u.cs;
      if (!puzzle.unitIds.includes(u.id)) p.push(`fill-blanks: unit ${u.id} missing from unitIds`);
    }
    if (puzzle.words.length > FILL_MAX_WORDS) p.push(`fill-blanks: ${puzzle.words.length} words in the bank`);
    // Every blank has its own word in the bank (multiplicity counted).
    const need = new Map<string, number>();
    for (const b of puzzle.blanks) need.set(foldFr(b.fr), (need.get(foldFr(b.fr)) ?? 0) + 1);
    const have = new Map<string, number>();
    for (const w of puzzle.words) have.set(foldFr(w.fr), (have.get(foldFr(w.fr)) ?? 0) + 1);
    for (const [f, k] of need) if ((have.get(f) ?? 0) !== k) p.push(`fill-blanks: the bank has ${have.get(f) ?? 0} of "${f}", ${k} blanks need it`);
    for (const [f, k] of have) if (!need.has(f) && k > 1) p.push(`fill-blanks: distractor "${f}" appears ${k} times`);
    if (puzzle.words.length <= n) p.push('fill-blanks: no distractor in the bank');
    for (const w of puzzle.words) if (!letterCount(w.fr)) p.push('fill-blanks: an empty word in the bank');
    // A distractor that equals a visible unit of the line would read as an answer.
    const visible = new Set(line.units.filter((u) => !seen.has(u.id)).map((u) => foldFr(u.fr)));
    for (const [f] of have) if (!need.has(f) && visible.has(f)) p.push(`fill-blanks: distractor "${f}" is a visible word of the line`);
    // A distractor never shares a French content word with a blank or another distractor (docs/app-games.md, "Choices").
    const extra = puzzle.words.filter((w) => !need.has(foldFr(w.fr)));
    extra.forEach((w, i) => {
      const b = puzzle.blanks.find((x) => frenchRelated(w.fr, x.fr));
      if (b) p.push(`fill-blanks: distractor "${w.fr}" is related to the blank "${b.fr}"`);
      const d = extra.slice(i + 1).find((x) => foldFr(x.fr) !== foldFr(w.fr) && frenchRelated(w.fr, x.fr));
      if (d) p.push(`fill-blanks: distractors "${w.fr}" and "${d.fr}" are related`);
    });
    if (line.endMs <= line.startMs) p.push('fill-blanks: the line has an empty window');
    return p;
  },
};
