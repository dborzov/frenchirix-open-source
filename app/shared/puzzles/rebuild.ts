// "Rebuild the line" (rebuild): a line of the scene loops; its pieces lie shuffled as tiles; the kid
// taps them in the order they are heard and they snap into the sentence. Its English is shown above
// as the meaning to build. Young scenes use the line's units as tiles; later levels split the line
// into single words, so there are more, smaller tiles. Role: recall.
//
// A tap on the wrong tile counts a mistake on that slot; after two on the same slot the view makes
// the right tile glow. A tile already placed cannot be tapped again.

import type { Line, Scene } from '../content';
import type { BotHooks } from '../practice/bot';
import type { Rng } from '../practice/rng';
import type { BuildCtx, PuzzleType, PuzzleBase } from '../practice/types';
import { WRONG_BEFORE_REVEAL } from '../rules';
import { checkHelp, displayEn, enWords, normalizeFr, shuffleNotIdentity } from './arcade';

export interface RebuildTile {
  id: string; // unit id, or '<unit id>#<word index>' for a word tile
  fr: string;
  unitId: string;
}

export interface RebuildPuzzle extends PuzzleBase {
  type: 'rebuild';
  lineId: string;
  en: string; // the line's English, as shown
  tiles: RebuildTile[]; // in display order (shuffled)
  answer: string[]; // tile ids in spoken order
  words: boolean; // true when the tiles are single words
}

export interface RebuildState {
  placed: number; // tiles placed so far (answer[0..placed-1])
  wrongAt: number[]; // wrong taps per slot
}

export type RebuildAction = { kind: 'tap'; tile: string };

export const REBUILD_REVEAL_AFTER = WRONG_BEFORE_REVEAL;

/** Tile count range by level. */
export function rebuildRange(level: number): [number, number] {
  if (level <= 2) return [3, 5];
  if (level <= 4) return [3, 7];
  return [4, 8];
}

function unitTiles(line: Line): RebuildTile[] {
  return line.units.map((u) => ({ id: u.id, fr: u.fr.trim(), unitId: u.id }));
}

function wordTiles(line: Line): RebuildTile[] {
  return line.units.flatMap((u) => u.words.map((w, i) => ({ id: `${u.id}#${i}`, fr: w.fr.trim(), unitId: u.id })));
}

function distinctTexts(tiles: RebuildTile[]): boolean {
  const seen = new Set<string>();
  for (const t of tiles) {
    const k = normalizeFr(t.fr);
    if (!k || seen.has(k)) return false;
    seen.add(k);
  }
  return true;
}

/** The tiles for a line at a level, or null when the line does not fit. */
export function tilesFor(line: Line, level: number): { tiles: RebuildTile[]; words: boolean } | null {
  const [lo, hi] = rebuildRange(level);
  const u = unitTiles(line);
  const w = wordTiles(line);
  const fits = (t: RebuildTile[]) => t.length >= lo && t.length <= hi && distinctTexts(t) && t.every((x) => x.fr.length <= 28);
  const order: { tiles: RebuildTile[]; words: boolean }[] = level >= 4 ? [{ tiles: w, words: true }, { tiles: u, words: false }] : [{ tiles: u, words: false }, { tiles: w, words: true }];
  for (const o of order) if (fits(o.tiles)) return o;
  return null;
}

function usable(line: Line): boolean {
  return line.endMs - line.startMs >= 700 && enWords(line.en) > 0 && line.units.length > 0;
}

export const rebuild: PuzzleType<RebuildPuzzle, RebuildState, RebuildAction> & BotHooks<RebuildPuzzle, RebuildState, RebuildAction> = {
  type: 'rebuild',
  meta: {
    role: 'recall',
    minLevel: 1,
    maxLevel: 6,
    needsMic: false,
    seconds: 28,
    weight: 3,
    name: 'Rebuild the line',
    purpose:
      'A line loops; its pieces lie shuffled and the kid taps them in the order heard. Reinforces the word order and sound of a whole line.',
    depth: 'core',
    scope: 'line',
  },

  build(ctx: BuildCtx): RebuildPuzzle | null {
    const { scene, rng, level } = ctx;
    // A targeted build (the replacement of a speaking round) takes its line at any tile count that fits.
    const target = ctx.targetLineId;
    const tilesAnyLevel = (l: Line) => [level, 1, 3, 5].reduce<ReturnType<typeof tilesFor>>((t, lv) => t ?? tilesFor(l, lv), null);
    const cands = scene.lines
      .filter((l) => (target ? l.id === target : true))
      .filter(usable)
      .map((l) => ({ l, t: target ? tilesAnyLevel(l) : tilesFor(l, level) }))
      .filter((x): x is { l: Line; t: { tiles: RebuildTile[]; words: boolean } } => x.t !== null)
      .map((x) => ({
        ...x,
        used: ctx.usedLineIds.has(x.l.id),
        score: x.l.units.filter((u) => ctx.focusUnitIds.has(u.id)).length * 3 + rng.next() * 2,
      }));
    if (!cands.length) return null;
    cands.sort((a, b) => Number(a.used) - Number(b.used) || b.score - a.score);
    const { l: line, t } = cands[0]!;
    const answer = t.tiles.map((x) => x.id);
    const tiles = shuffleNotIdentity(t.tiles, rng);
    ctx.usedLineIds.add(line.id);
    const key = line.units.filter((u) => u.key).map((u) => u.id);
    for (const id of key) ctx.usedUnitIds.add(id);
    return {
      id: `${scene.id}:rebuild:${line.id}`,
      type: 'rebuild',
      sceneId: scene.id,
      helpLineIds: [line.id],
      unitIds: key.length ? key : line.units.map((u) => u.id),
      lineId: line.id,
      en: displayEn(line.en),
      tiles,
      answer,
      words: t.words,
    };
  },

  init(puzzle): RebuildState {
    return { placed: 0, wrongAt: puzzle.answer.map(() => 0) };
  },

  reduce(puzzle, state, action): RebuildState {
    if (!action || action.kind !== 'tap' || state.placed >= puzzle.answer.length) return state;
    const at = puzzle.answer.indexOf(action.tile);
    if (at < 0) return state; // not a tile of this puzzle
    if (at < state.placed) return state; // already placed: nothing happens
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
    const ids = new Set<string>();
    state.wrongAt.forEach((n, i) => {
      if (n > 0) {
        const tile = puzzle.tiles.find((t) => t.id === puzzle.answer[i]);
        if (tile && puzzle.unitIds.includes(tile.unitId)) ids.add(tile.unitId);
      }
    });
    // A wrong slot on a non-key unit still marks the line's key units as weak.
    if (!ids.size && state.wrongAt.some((n) => n > 0)) return puzzle.unitIds.slice();
    return [...ids];
  },

  solve(puzzle, state): RebuildAction {
    return { kind: 'tap', tile: puzzle.answer[state.placed]! };
  },

  wrongAction(puzzle: RebuildPuzzle, state: RebuildState, rng: Rng): RebuildAction | null {
    const left = puzzle.answer.slice(state.placed + 1);
    return left.length ? { kind: 'tap', tile: rng.pick(left) } : null;
  },

  validate(puzzle: RebuildPuzzle, scene: Scene): string[] {
    const p: string[] = [];
    const line = scene.lines.find((l) => l.id === puzzle.lineId);
    if (!line) return [`rebuild: line ${puzzle.lineId} is not in the scene`];
    const expected = puzzle.words ? wordTiles(line) : unitTiles(line);
    if (puzzle.tiles.length < 2 || puzzle.tiles.length > 9) p.push(`rebuild: ${puzzle.tiles.length} tiles`);
    if (expected.map((x) => x.id).join('|') !== puzzle.answer.join('|')) p.push('rebuild: the answer is not the line\'s pieces in order');
    const ids = puzzle.tiles.map((x) => x.id);
    if ([...ids].sort().join('|') !== [...puzzle.answer].sort().join('|')) p.push('rebuild: the tiles are not the answer\'s pieces');
    if (!distinctTexts(puzzle.tiles)) p.push('rebuild: two tiles have the same text');
    if (puzzle.tiles.length > 1 && ids.join('|') === puzzle.answer.join('|')) p.push('rebuild: the tiles are already in order');
    for (const t of puzzle.tiles) {
      const e = expected.find((x) => x.id === t.id);
      if (!e || e.fr !== t.fr || e.unitId !== t.unitId) p.push(`rebuild: tile ${t.id} does not match the line`);
    }
    if (!enWords(puzzle.en)) p.push('rebuild: no English');
    p.push(...checkHelp('rebuild', scene, puzzle.helpLineIds, [line.id], puzzle.unitIds));
    if (line.endMs <= line.startMs || line.endMs > scene.audio.durationMs + 50) p.push('rebuild: the line window is outside the audio');
    return p;
  },
};
