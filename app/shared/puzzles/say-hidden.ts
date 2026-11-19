// "Say the hidden expression": the English of a key unit, big, with the scene's frame at that moment
// above it as a memory anchor; below, its French masked: the first letter, then one dot per hidden
// letter, spaces, apostrophes and hyphens kept, so the kid sees the shape. The kid says it and
// records; the server scores it against the unit (POST /api/speech?unit=). On a pass the letters
// flip open. Help is one tap away (the help strip, closed by default) and a listen button replays
// the unit; both count as hints. Not before silver, level 2 (the kid has met the words).
//
// Masking: at silver (level 2) the first letter of each word shows; from gold (level 3) only the first letter of the
// first word.

import type { Line, Scene, Unit } from '../content';
import type { BotHooks } from '../practice/bot';
import type { BuildCtx, PuzzleType, PuzzleBase } from '../practice/types';
import { normalizeEn } from './listen-pick';
import { letterCount, nameLike, wordCount } from './match';
import { canFail, failingVerdict, frWords, LISTEN_MAX_MS, passingVerdict, recordLimitMs, speakInit, speakReduce, type SpeakAction, type SpeakState } from './speak-core';

export interface SayHiddenPuzzle extends PuzzleBase {
  type: 'say-hidden';
  lineId: string;
  unitId: string;
  fr: string;
  en: string;
  mask: string; // fr with hidden letters as MASK_CHAR
  frameMs: number; // the frame shown above (the unit's time)
  startMs: number; // the window the listen button plays
  endMs: number;
  maxRecordMs: number;
}

export type SayHiddenState = SpeakState;
export type SayHiddenAction = SpeakAction;

export const MASK_CHAR = '·';

const isLetter = (c: string) => /[\p{L}\p{N}]/u.test(c);

/**
 * Masks French: 'each' keeps the first letter of each word, 'first' only of the first word. A word
 * starts after a space or a hyphen, or at the start; a letter right after an apostrophe continues
 * the word ("l'homme" -> "l·····"). Everything that is not a letter or digit is kept as is.
 */
export function maskFrench(text: string, mode: 'each' | 'first'): string {
  let out = '';
  let shownWords = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (!isLetter(c)) {
      out += c;
      continue;
    }
    const prev = i > 0 ? text[i - 1]! : ' ';
    const startsWord = !isLetter(prev) && prev !== "'" && prev !== '’';
    if (startsWord && (mode === 'each' || shownWords === 0)) {
      out += c;
      shownWords++;
    } else {
      out += MASK_CHAR;
    }
  }
  return out;
}

export function maskModeForLevel(level: number): 'each' | 'first' {
  return level <= 2 ? 'each' : 'first';
}

function eligible(line: Line, u: Unit): boolean {
  const k = wordCount(u.fr);
  return u.key && !nameLike(u) && !!normalizeEn(u.en) && letterCount(u.fr) >= 3 && k >= 1 && k <= 4 && u.fr.length <= 28 && u.endMs - u.startMs >= 250 && !!line;
}

export const sayHidden: PuzzleType<SayHiddenPuzzle, SayHiddenState, SayHiddenAction> & BotHooks<SayHiddenPuzzle, SayHiddenState, SayHiddenAction> = {
  type: 'say-hidden',
  meta: {
    role: 'produce',
    minLevel: 2,
    maxLevel: 6,
    needsMic: true,
    seconds: 25,
    weight: 3,
    name: 'Say the hidden expression',
    purpose:
      'The English of one expression and its frame are shown, its French masked to first letters; the kid says the French. Reinforces recalling and pronouncing one expression.',
    depth: 'advanced',
    scope: 'unit',
  },

  build(ctx: BuildCtx): SayHiddenPuzzle | null {
    const { scene, rng, focusUnitIds, usedUnitIds, usedLineIds } = ctx;
    const cands: { line: Line; u: Unit; score: number; used: boolean }[] = [];
    for (const line of scene.lines)
      for (const u of line.units) {
        if (!eligible(line, u) || !maskFrench(u.fr, maskModeForLevel(ctx.level)).includes(MASK_CHAR)) continue;
        let score = rng.next() * 2;
        if (focusUnitIds.has(u.id)) score += 5;
        if (u.kind === 'expression') score += 1;
        if (line.approxTimes) score -= 1.5; // its listen button plays the whole line
        if (letterCount(u.fr) >= 5) score += 0.5;
        cands.push({ line, u, score, used: usedUnitIds.has(u.id) || usedLineIds.has(line.id) });
      }
    if (!cands.length) return null;
    cands.sort((a, b) => Number(a.used) - Number(b.used) || b.score - a.score);
    const { line, u } = cands[0]!;
    usedUnitIds.add(u.id);
    const w = line.approxTimes ? { startMs: line.startMs, endMs: line.endMs } : { startMs: u.startMs, endMs: u.endMs };
    return {
      id: `${scene.id}:say-hidden:${u.id}`,
      type: 'say-hidden',
      sceneId: scene.id,
      helpLineIds: [line.id],
      unitIds: [u.id],
      lineId: line.id,
      unitId: u.id,
      fr: u.fr,
      en: u.en,
      mask: maskFrench(u.fr, maskModeForLevel(ctx.level)),
      frameMs: Math.max(0, line.approxTimes ? line.startMs : u.startMs),
      startMs: w.startMs,
      endMs: w.endMs,
      maxRecordMs: recordLimitMs(Math.max(800, u.endMs - u.startMs)),
    };
  },

  init: () => speakInit(),
  reduce: (_puzzle, state, action) => speakReduce(state, action),
  isDone: (_puzzle, state) => state.done !== null,
  mistakes: (_puzzle, state) => state.mistakes,
  missedUnitIds: (puzzle, state) => (state.mistakes > 0 ? puzzle.unitIds : []),
  solve: (puzzle) => passingVerdict(frWords(puzzle.fr)),
  wrongAction: (puzzle, state) => (canFail(state) ? failingVerdict(frWords(puzzle.fr)) : null),

  validate(puzzle: SayHiddenPuzzle, scene: Scene): string[] {
    const p: string[] = [];
    const line = scene.lines.find((l) => l.id === puzzle.lineId);
    const u = line?.units.find((x) => x.id === puzzle.unitId);
    if (!line || !u) return [`say-hidden: unit ${puzzle.unitId} is not in the scene`];
    if (!puzzle.helpLineIds.includes(line.id)) p.push('say-hidden: the line is not on the help strip');
    if (u.fr !== puzzle.fr || u.en !== puzzle.en) p.push('say-hidden: text differs from the unit');
    if (!normalizeEn(puzzle.en)) p.push('say-hidden: no English to show');
    if (puzzle.mask.length !== puzzle.fr.length) p.push('say-hidden: the mask does not have the length of the French');
    else {
      for (let i = 0; i < puzzle.fr.length; i++) {
        const c = puzzle.fr[i]!;
        const m = puzzle.mask[i]!;
        if (!isLetter(c) && m !== c) p.push(`say-hidden: the mask changes "${c}" at ${i}`);
        if (isLetter(c) && m !== c && m !== MASK_CHAR) p.push(`say-hidden: the mask shows a wrong letter at ${i}`);
      }
      const first = [...puzzle.fr].findIndex(isLetter);
      if (first < 0 || puzzle.mask[first] !== puzzle.fr[first]) p.push('say-hidden: the first letter is hidden');
      if (!puzzle.mask.includes(MASK_CHAR)) p.push('say-hidden: nothing is hidden');
    }
    if (puzzle.endMs - puzzle.startMs < 200 || puzzle.endMs > scene.audio.durationMs + 50) p.push('say-hidden: bad listen window');
    if (!puzzle.unitIds.includes(u.id)) p.push('say-hidden: the unit is not in unitIds');
    if (puzzle.maxRecordMs < 3000 || puzzle.maxRecordMs > LISTEN_MAX_MS) p.push('say-hidden: odd recording limit');
    return p;
  },
};
