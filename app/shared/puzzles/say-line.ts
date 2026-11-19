// "Say the line": a whole dialogue line of the scene plays with its frame and its text; the kid
// records themself saying all of it (the user: "Say the line is to say the whole dialog line", never a
// part of it, at every level); the server (POST /api/speech?line=) scores the recording and the words
// it heard light up. Pass: celebration. Not passed: what was heard stays lit, the missing part and the
// line replay, and another go; the third try always passes (speak-core.ts). The server's verdict
// reaches the reducer as an action, so the logic stays pure. When speech recognition is unavailable
// (503), the round becomes a listen-back: the original, then the kid's own recording, and "c'est moi !"
// goes on, with no score and no mistake.
//
// The level only steers which line is chosen (shorter lines first at low levels); the expression-sized
// speaking is say-hidden's and say-chain's.

import type { Line, Scene } from '../content';
import type { BotHooks } from '../practice/bot';
import type { BuildCtx, PuzzleType, PuzzleBase } from '../practice/types';
import { letterCount, nameLike, wordCount } from './match';

// The speaking core moved to speak-core.ts; re-exported here for the puzzle types that import it from here.
export * from './speak-core';
import { canFail, failingVerdict, frWords, LISTEN_MAX_MS, passingVerdict, recordLimitMs, speakInit, speakReduce, type SpeakAction, type SpeakState } from './speak-core';

// ---- the puzzle type ------------------------------------------------------------------------------------

export interface SayLinePuzzle extends PuzzleBase {
  type: 'say-line';
  lineId: string;
  text: string; // the French to say: the whole line
  startMs: number; // the line's window
  endMs: number;
  maxRecordMs: number;
}

export type SayLineState = SpeakState;
export type SayLineAction = SpeakAction;

/** The length of line (in words) a level prefers; longer lines are still said whole, only chosen later. */
export function preferredWordsForLevel(level: number): number {
  return level <= 1 ? 5 : level === 2 ? 7 : level === 3 ? 9 : level === 4 ? 12 : 16;
}

const MIN_LETTERS = 4; // "Mmh ?" is not worth saying

function contentful(line: Line): boolean {
  return line.units.some((u) => u.key && !nameLike(u) && letterCount(u.fr) >= 2);
}

export const sayLine: PuzzleType<SayLinePuzzle, SayLineState, SayLineAction> & BotHooks<SayLinePuzzle, SayLineState, SayLineAction> = {
  type: 'say-line',
  meta: {
    role: 'produce',
    minLevel: 1,
    maxLevel: 6,
    needsMic: true,
    seconds: 25,
    weight: 3,
    name: 'Say the line',
    purpose:
      'A whole dialogue line plays with its frame; the kid records saying all of it and the words heard light up. Reinforces pronouncing French heard in the scene.',
    depth: 'core',
    scope: 'line',
  },

  build(ctx: BuildCtx): SayLinePuzzle | null {
    const { scene, rng, focusUnitIds, usedLineIds } = ctx;
    const preferred = preferredWordsForLevel(ctx.level);
    type Cand = { line: Line; score: number; used: boolean };
    const cands: Cand[] = [];
    const target = ctx.targetLineId;
    for (const line of scene.lines) {
      if (target && line.id !== target) continue;
      if (line.endMs - line.startMs < 500 || letterCount(line.fr) < MIN_LETTERS) continue;
      const n = wordCount(line.fr);
      // A targeted build (the practice composer covering this line) says even a one-word or a name-only line.
      if (!target && (n < 2 || !contentful(line))) continue;
      if (n < 1) continue;
      const focus = line.units.filter((u) => focusUnitIds.has(u.id)).length;
      // The closer to the level's preferred length the better (longer lines cost more), a little randomness.
      const over = Math.max(0, n - preferred);
      const score = focus * 3 + 4 - Math.abs(preferred * 0.7 - n) * 0.4 - over * 0.4 + rng.next() * 2;
      cands.push({ line, score, used: usedLineIds.has(line.id) });
    }
    if (!cands.length) return null;
    cands.sort((a, b) => Number(a.used) - Number(b.used) || b.score - a.score);
    const { line } = cands[0]!;
    usedLineIds.add(line.id);
    const keys = line.units.filter((u) => u.key);
    for (const u of keys) ctx.usedUnitIds.add(u.id);
    return {
      id: `${scene.id}:say-line:${line.id}`,
      type: 'say-line',
      sceneId: scene.id,
      helpLineIds: [line.id],
      unitIds: (keys.length ? keys : line.units).map((u) => u.id),
      lineId: line.id,
      text: line.fr,
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

  validate(puzzle: SayLinePuzzle, scene: Scene): string[] {
    const p: string[] = [];
    const line = scene.lines.find((l) => l.id === puzzle.lineId);
    if (!line) return [`say-line: line ${puzzle.lineId} is not in the scene`];
    if (!puzzle.helpLineIds.includes(line.id)) p.push('say-line: the line is not on the help strip');
    // The whole line, never a part of it (the user's rule).
    if ((puzzle as SayLinePuzzle & { unitId?: string }).unitId) p.push('say-line: only a part of the line is to be said');
    if (line.fr !== puzzle.text) p.push("say-line: the text is not the line's French");
    if (puzzle.startMs !== line.startMs || puzzle.endMs !== line.endMs) p.push("say-line: the window is not the line's");
    if (letterCount(puzzle.text) < 2) p.push('say-line: nothing to say');
    if (puzzle.endMs - puzzle.startMs < 300) p.push('say-line: the window is too short');
    if (puzzle.startMs < 0 || puzzle.endMs > scene.audio.durationMs + 50) p.push('say-line: the window is outside the audio');
    if (puzzle.maxRecordMs < 3000 || puzzle.maxRecordMs > LISTEN_MAX_MS) p.push('say-line: odd recording limit');
    const ids = new Set(line.units.map((u) => u.id));
    for (const u of puzzle.unitIds) if (!ids.has(u)) p.push(`say-line: unit ${u} is not in the line`);
    return p;
  },
};
