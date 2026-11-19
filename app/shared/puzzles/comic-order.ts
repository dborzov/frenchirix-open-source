// "Order the comic" (comic-order): three or four consecutive lines of the scene loop as one stretch;
// their panels (the frame where each is said, the French, its English) lie shuffled; the kid taps
// the panel that comes next and it slams into the comic strip, N° 1 to N° 4. Each panel can loop
// its own line from a speaker button. When the strip is complete it plays through, each panel
// lighting up as its line is spoken. Role: recall (every level; four panels from titanium, level 4).
//
// A wrong panel counts a mistake on that slot; after two on the same slot the right panel glows.

import type { Line, Scene } from '../content';
import type { BotHooks } from '../practice/bot';
import type { Rng } from '../practice/rng';
import type { BuildCtx, PuzzleType, PuzzleBase } from '../practice/types';
import { WRONG_BEFORE_REVEAL } from '../rules';
import { checkHelp, enWords, nearlyEqual, normalizeFr, shuffleNotIdentity, uniq } from './arcade';

export interface ComicOrderPuzzle extends PuzzleBase {
  type: 'comic-order';
  answer: string[]; // line ids in spoken order
  cards: string[]; // the same line ids in display order (shuffled)
}

export interface ComicOrderState {
  placed: number;
  wrongAt: number[];
}

export type ComicOrderAction = { kind: 'place'; lineId: string };

export const COMIC_REVEAL_AFTER = WRONG_BEFORE_REVEAL;
/** The looping stretch must stay short enough to remember. */
export const COMIC_MAX_SPAN_MS = 24000;

export function comicPanels(level: number): number {
  return level >= 4 ? 4 : 3;
}

function usable(line: Line): boolean {
  return line.endMs - line.startMs >= 450 && enWords(line.en) > 0 && normalizeFr(line.fr).length > 0;
}

/** Runs of n consecutive lines that can be told apart and are spoken one after the other. */
/**
 * The index of the slideshow frame a line's panel shows (the view uses the frame at the line's
 * start + 250 ms, the start being the earliest of the line and its units unless times are estimated).
 */
export function panelFrameIndex(scene: Scene, line: Line): number {
  let start = line.startMs;
  if (!line.approxTimes) for (const u of line.units) start = Math.min(start, u.startMs);
  const t = Math.max(0, start) + 250;
  let idx = 0;
  scene.frames.forEach((f, i) => {
    if (f.t <= t) idx = i;
  });
  return idx;
}

function runs(scene: Scene, n: number): Line[][] {
  const lines = scene.lines;
  const out: Line[][] = [];
  for (let i = 0; i + n <= lines.length; i++) {
    const run = lines.slice(i, i + n);
    if (!run.every(usable)) continue;
    let ok = true;
    for (let k = 1; k < n && ok; k++) if (run[k]!.startMs <= run[k - 1]!.startMs) ok = false;
    if (!ok) continue;
    if (run[n - 1]!.endMs - run[0]!.startMs > COMIC_MAX_SPAN_MS) continue;
    const frs = run.map((l) => normalizeFr(l.fr));
    if (new Set(frs).size !== n) continue;
    // Panels must be told apart by their pictures too: every line on its own frame.
    if (new Set(run.map((l) => panelFrameIndex(scene, l))).size !== n) continue;
    if (run.some((a, x) => run.some((b, y) => x < y && nearlyEqual(a.en, b.en) && (frs[x]!.includes(frs[y]!) || frs[y]!.includes(frs[x]!))))) continue;
    out.push(run);
  }
  return out;
}

export const comicOrder: PuzzleType<ComicOrderPuzzle, ComicOrderState, ComicOrderAction> & BotHooks<ComicOrderPuzzle, ComicOrderState, ComicOrderAction> = {
  type: 'comic-order',
  meta: {
    role: 'recall',
    minLevel: 1,
    maxLevel: 6,
    needsMic: false,
    seconds: 30,
    weight: 2,
    name: 'Order the comic',
    purpose:
      'Three or four consecutive lines lie shuffled as comic panels (frame, French, English); the kid puts them in the order they are said. Reinforces how the lines follow each other and what they mean together.',
    depth: 'core',
    scope: 'multi-line',
  },

  build(ctx: BuildCtx): ComicOrderPuzzle | null {
    const { scene, rng } = ctx;
    let n = comicPanels(ctx.level);
    // A targeted build: the stretch must contain the target line.
    const withTarget = (r: Line[][]) => (ctx.targetLineId ? r.filter((run) => run.some((l) => l.id === ctx.targetLineId)) : r);
    let rs = withTarget(runs(scene, n));
    if (!rs.length && n === 4) {
      n = 3;
      rs = withTarget(runs(scene, n));
    }
    if (!rs.length) return null;
    const scored = rs.map((run) => ({
      run,
      used: run.filter((l) => ctx.usedLineIds.has(l.id)).length,
      score: run.reduce((s, l) => s + l.units.filter((u) => ctx.focusUnitIds.has(u.id)).length, 0) * 3 + rng.next() * 2,
    }));
    scored.sort((a, b) => a.used - b.used || b.score - a.score);
    const run = scored[0]!.run;
    const answer = run.map((l) => l.id);
    for (const l of run) ctx.usedLineIds.add(l.id);
    const key = run.flatMap((l) => l.units.filter((u) => u.key).map((u) => u.id));
    for (const id of key) ctx.usedUnitIds.add(id);
    return {
      id: `${scene.id}:comic-order:${answer[0]}`,
      type: 'comic-order',
      sceneId: scene.id,
      helpLineIds: answer.slice(),
      unitIds: key.length ? key : run.flatMap((l) => l.units.map((u) => u.id)),
      answer,
      cards: shuffleNotIdentity(answer, rng),
    };
  },

  init(puzzle): ComicOrderState {
    return { placed: 0, wrongAt: puzzle.answer.map(() => 0) };
  },

  reduce(puzzle, state, action): ComicOrderState {
    if (!action || action.kind !== 'place' || state.placed >= puzzle.answer.length) return state;
    const at = puzzle.answer.indexOf(action.lineId);
    if (at < 0 || at < state.placed) return state;
    if (at === state.placed) return { ...state, placed: state.placed + 1 };
    const wrongAt = state.wrongAt.slice();
    wrongAt[state.placed] = (wrongAt[state.placed] ?? 0) + 1;
    return { ...state, wrongAt };
  },

  isDone(puzzle, state) {
    return state.placed >= puzzle.answer.length;
  },

  mistakes(_puzzle, state) {
    return state.wrongAt.reduce((a, b) => a + b, 0);
  },

  missedUnitIds(puzzle, state) {
    const lines = new Set(puzzle.answer.filter((_, i) => (state.wrongAt[i] ?? 0) > 0));
    return puzzle.unitIds.filter((u) => lines.has(u.slice(0, u.lastIndexOf(':'))));
  },

  solve(puzzle, state): ComicOrderAction {
    return { kind: 'place', lineId: puzzle.answer[state.placed]! };
  },

  wrongAction(puzzle: ComicOrderPuzzle, state: ComicOrderState, rng: Rng): ComicOrderAction | null {
    const left = puzzle.answer.slice(state.placed + 1);
    return left.length ? { kind: 'place', lineId: rng.pick(left) } : null;
  },

  validate(puzzle: ComicOrderPuzzle, scene: Scene): string[] {
    const p: string[] = [];
    const lines = puzzle.answer.map((id) => scene.lines.find((l) => l.id === id));
    if (lines.some((l) => !l)) return ['comic-order: a line is not in the scene'];
    const ls = lines as Line[];
    if (ls.length < 3 || ls.length > 4) p.push(`comic-order: ${ls.length} panels`);
    if (uniq(puzzle.answer).length !== puzzle.answer.length) p.push('comic-order: a line twice');
    if (new Set(ls.map((l) => panelFrameIndex(scene, l))).size !== ls.length) p.push('comic-order: two panels show the same frame');
    for (let k = 1; k < ls.length; k++) if (ls[k]!.startMs <= ls[k - 1]!.startMs) p.push('comic-order: the answer is not in spoken order');
    if ([...puzzle.cards].sort().join('|') !== [...puzzle.answer].sort().join('|')) p.push('comic-order: the cards are not the answer\'s lines');
    if (puzzle.cards.join('|') === puzzle.answer.join('|')) p.push('comic-order: the cards are already in order');
    if (new Set(ls.map((l) => normalizeFr(l.fr))).size !== ls.length) p.push('comic-order: two panels have the same French');
    if (ls[ls.length - 1]!.endMs > scene.audio.durationMs + 50) p.push('comic-order: a line is outside the audio');
    p.push(...checkHelp('comic-order', scene, puzzle.helpLineIds, puzzle.answer, puzzle.unitIds));
    return p;
  },
};
