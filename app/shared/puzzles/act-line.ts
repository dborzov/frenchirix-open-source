// "Play the character" (act-line): the kid says a full dialogue line, long ones included, inside
// the scene. The slideshow shows that moment; the line before plays (its boxes lighting up); then
// "à toi !": the kid's line is shown as boxes with the speaker's name, the microphone opens by itself
// (after the first permission) and closes on silence; then the scene goes on with the next line. The
// first and last lines of a scene have only one neighbour.
//
// Scoring is the speaking core's (speak-core.ts): what was heard stays lit across tries, so a long
// line can be said piece by piece; the third try always passes.

import type { Line, Scene } from '../content';
import type { BotHooks } from '../practice/bot';
import type { BuildCtx, PuzzleType, PuzzleBase } from '../practice/types';
import { letterCount, wordCount } from './match';
import { canFail, failingVerdict, frWords, LISTEN_MAX_MS, passingVerdict, recordLimitMs, speakInit, speakReduce, type SpeakAction, type SpeakState } from './speak-core';

export interface ActLinePuzzle extends PuzzleBase {
  type: 'act-line';
  lineId: string;
  speaker: string | null;
  text: string; // the line's French: what the kid says
  beforeIds: string[]; // the line(s) played before the kid's turn (empty for the scene's first line)
  afterId: string | null; // the line played after it (null for the scene's last line)
  startMs: number; // the kid's line window (the model, replayed when something is missing)
  endMs: number;
  maxRecordMs: number;
}

export type ActLineState = SpeakState;
export type ActLineAction = SpeakAction;

/** Lines that play before the kid's turn: the previous one, or two when the previous one is very short. */
function before(scene: Scene, i: number): Line[] {
  if (i === 0) return [];
  const prev = scene.lines[i - 1]!;
  if (i >= 2 && wordCount(prev.fr) <= 2) return [scene.lines[i - 2]!, prev];
  return [prev];
}

function usable(line: Line): boolean {
  return letterCount(line.fr) >= 4 && wordCount(line.fr) >= 2 && line.endMs - line.startMs >= 500;
}

export const actLine: PuzzleType<ActLinePuzzle, ActLineState, ActLineAction> & BotHooks<ActLinePuzzle, ActLineState, ActLineAction> = {
  type: 'act-line',
  meta: {
    role: 'produce',
    minLevel: 1,
    maxLevel: 6,
    needsMic: true,
    seconds: 45,
    weight: 2,
    name: 'Play the character',
    purpose: 'The scene plays up to a line, then the kid says that whole line as the character, and the scene goes on: speaking a full, long line in its context.',
    depth: 'advanced',
    scope: 'long-line',
  },

  build(ctx: BuildCtx): ActLinePuzzle | null {
    const { scene, rng, focusUnitIds, usedLineIds } = ctx;
    if (scene.lines.length < 2) return null;
    const cands = scene.lines
      .map((l, i) => ({ l, i }))
      .filter(({ l }) => usable(l) && (!ctx.targetLineId || l.id === ctx.targetLineId))
      .map(({ l, i }) => ({
        l,
        i,
        used: usedLineIds.has(l.id),
        // Long lines first: this is the puzzle for them.
        score: Math.min(wordCount(l.fr), 16) * 0.5 + l.units.filter((u) => focusUnitIds.has(u.id)).length * 2 + rng.next() * 2,
      }));
    if (!cands.length) return null;
    cands.sort((a, b) => Number(a.used) - Number(b.used) || b.score - a.score);
    const { l: line, i } = cands[0]!;
    const pre = before(scene, i);
    const next = scene.lines[i + 1] ?? null;
    usedLineIds.add(line.id);
    const key = line.units.filter((u) => u.key).map((u) => u.id);
    for (const id of key) ctx.usedUnitIds.add(id);
    return {
      id: `${scene.id}:act-line:${line.id}`,
      type: 'act-line',
      sceneId: scene.id,
      helpLineIds: [...pre.map((l) => l.id), line.id, ...(next ? [next.id] : [])],
      unitIds: key.length ? key : line.units.map((u) => u.id),
      lineId: line.id,
      speaker: line.speaker,
      text: line.fr,
      beforeIds: pre.map((l) => l.id),
      afterId: next?.id ?? null,
      startMs: line.startMs,
      endMs: line.endMs,
      maxRecordMs: recordLimitMs(line.endMs - line.startMs),
    };
  },

  init: () => speakInit(),
  reduce: (_puzzle, state, action) => speakReduce(state, action),
  isDone: (_puzzle, state) => state.done !== null,
  mistakes: (_puzzle, state) => state.mistakes,
  missedUnitIds: (puzzle, state) => (state.mistakes > 0 ? puzzle.unitIds : []),
  solve: (puzzle) => passingVerdict(frWords(puzzle.text)),
  wrongAction: (puzzle, state) => (canFail(state) ? failingVerdict(frWords(puzzle.text)) : null),

  validate(puzzle: ActLinePuzzle, scene: Scene): string[] {
    const p: string[] = [];
    const i = scene.lines.findIndex((l) => l.id === puzzle.lineId);
    if (i < 0) return [`act-line: line ${puzzle.lineId} is not in the scene`];
    const line = scene.lines[i]!;
    if (line.fr !== puzzle.text) p.push('act-line: the text is not the line\'s French');
    if (!puzzle.beforeIds.length && !puzzle.afterId) p.push('act-line: the line has no neighbour to act with');
    const expectBefore = before(scene, i).map((l) => l.id);
    if (expectBefore.join('|') !== puzzle.beforeIds.join('|')) p.push('act-line: the lines before are not the ones preceding it');
    if ((scene.lines[i + 1]?.id ?? null) !== puzzle.afterId) p.push('act-line: the line after is not the next one');
    for (const id of [...puzzle.beforeIds, puzzle.lineId, ...(puzzle.afterId ? [puzzle.afterId] : [])])
      if (!puzzle.helpLineIds.includes(id)) p.push(`act-line: line ${id} is not on the help strip`);
    if (puzzle.endMs <= puzzle.startMs || puzzle.endMs > scene.audio.durationMs + 50) p.push('act-line: the line window is outside the audio');
    if (puzzle.maxRecordMs < 3000 || puzzle.maxRecordMs > LISTEN_MAX_MS) p.push('act-line: odd recording limit');
    return p;
  },
};
