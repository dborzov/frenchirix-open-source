// "Choose by speaking" (say-choice): the moment of the scene is shown and the line before plays; then
// three speech balloons: the original line and its two funny alternates (`line.alternates`). Each is
// tappable for its meaning and playable. The kid says one aloud; the server tells which one
// (POST /api/speech?choice=<line id>, `choice.index`: 0 = the original, k = alternate k-1). That
// balloon wins with a reaction (funnier for the funny ones), and the scene goes on. There is no wrong
// choice. If nothing is recognised by the third try, the closest one wins (the server's best score);
// after a first unrecognised try the kid may also just tap one. A take with no voice is no try (the
// view says it did not hear and the microphone comes back); it never makes a balloon win.

import type { GlossUnit, Line, Scene } from '../content';
import type { BotHooks } from '../practice/bot';
import type { BuildCtx, PuzzleType, PuzzleBase } from '../practice/types';
import { SPEECH_MAX_TRIES } from '../rules';
import { foldFr } from './match';
import { LISTEN_MAX_MS, recordLimitMs } from './speak-core';

/** A written alternative of a line (shared/content.ts `Line.alternates`, rework brief). */
export interface LineAlternate {
  fr: string;
  en: string;
  units: GlossUnit[];
  audio?: string;
}

/** A line's usable alternates; one without pieces gets one piece for the whole sentence (still tappable). */
export function alternatesOf(line: Line): LineAlternate[] {
  return ((line as Line & { alternates?: LineAlternate[] }).alternates ?? [])
    .filter((a) => a && a.fr?.trim() && a.en?.trim())
    .map((a) => (a.units?.length ? a : { ...a, units: [{ fr: a.fr, en: a.en, cs: 0, ce: a.fr.length }] }));
}

export interface ChoiceOption {
  k: number; // the server's candidate index: 0 = the original line, 1.. = alternates in order
  fr: string;
  en: string;
  units: GlossUnit[];
  audio?: string; // generated speech for an alternate; the original plays from the scene
}

export interface SayChoicePuzzle extends PuzzleBase {
  type: 'say-choice';
  lineId: string;
  beforeId: string | null; // the line played first (null for the scene's first line)
  afterId: string | null; // the line played after the choice
  options: ChoiceOption[]; // three, shuffled
  maxRecordMs: number;
}

export interface SayChoiceState {
  tries: number; // tries in which nothing was recognised
  chosen: number | null; // the k of the winning option
  how: 'said' | 'closest' | 'tapped' | null;
  mode: 'speak' | 'tap'; // tap: recognition unavailable, the kid taps a balloon
  skipped: boolean;
}

export type SayChoiceAction =
  | { kind: 'said'; index: number | null; closest?: number } // the server's choice (null: nothing recognised) and its best guess
  | { kind: 'tap'; k: number } // after a first unrecognised try, or without recognition
  | { kind: 'unavailable' }
  | { kind: 'skip' };

/** True when tapping a balloon chooses it (after a first unrecognised try, or without recognition). */
export function canTap(state: SayChoiceState): boolean {
  return state.chosen === null && (state.tries >= 1 || state.mode === 'tap');
}

function original(line: Line): ChoiceOption {
  // The line's own units, as GlossUnits of its French.
  return { k: 0, fr: line.fr, en: line.en, units: line.units.map((u) => ({ fr: u.fr, en: u.en, cs: u.cs, ce: u.ce })) };
}

export const sayChoice: PuzzleType<SayChoicePuzzle, SayChoiceState, SayChoiceAction> & BotHooks<SayChoicePuzzle, SayChoiceState, SayChoiceAction> = {
  type: 'say-choice',
  meta: {
    role: 'fun',
    minLevel: 1,
    maxLevel: 6,
    needsMic: true,
    seconds: 35,
    weight: 2,
    name: 'Choose by speaking',
    purpose: 'Three versions of a line (the real one and two funny ones) are shown with their meaning; the kid picks one by saying it aloud. No wrong answer: practice in pronouncing French and reading for meaning.',
    depth: 'core',
    scope: 'line',
  },

  build(ctx: BuildCtx): SayChoicePuzzle | null {
    const { scene, rng, usedLineIds } = ctx;
    const cands = scene.lines
      .map((l, i) => ({ l, i, alts: alternatesOf(l) }))
      .filter(({ l, alts }) => alts.length >= 2 && (!ctx.targetLineId || l.id === ctx.targetLineId))
      .map((c) => ({ ...c, used: usedLineIds.has(c.l.id), score: rng.next() }));
    if (!cands.length) return null;
    cands.sort((a, b) => Number(a.used) - Number(b.used) || b.score - a.score);
    const { l: line, i, alts } = cands[0]!;
    const options: ChoiceOption[] = [original(line), ...alts.slice(0, 2).map((a, j) => ({ k: j + 1, fr: a.fr, en: a.en, units: a.units, ...(a.audio ? { audio: a.audio } : {}) }))];
    const prev = scene.lines[i - 1] ?? null;
    const next = scene.lines[i + 1] ?? null;
    usedLineIds.add(line.id);
    const key = line.units.filter((u) => u.key).map((u) => u.id);
    return {
      id: `${scene.id}:say-choice:${line.id}`,
      type: 'say-choice',
      sceneId: scene.id,
      helpLineIds: [...(prev ? [prev.id] : []), line.id, ...(next ? [next.id] : [])],
      unitIds: key.length ? key : line.units.map((u) => u.id),
      lineId: line.id,
      beforeId: prev?.id ?? null,
      afterId: next?.id ?? null,
      options: rng.shuffle(options),
      maxRecordMs: recordLimitMs(Math.max(2000, line.endMs - line.startMs) * 1.3),
    };
  },

  init(): SayChoiceState {
    return { tries: 0, chosen: null, how: null, mode: 'speak', skipped: false };
  },

  reduce(puzzle, state, action): SayChoiceState {
    if (!action || state.chosen !== null || state.skipped) return state;
    const ks = puzzle.options.map((o) => o.k);
    switch (action.kind) {
      case 'said': {
        if (state.mode !== 'speak') return state;
        if (action.index !== null && ks.includes(action.index)) return { ...state, chosen: action.index, how: 'said' };
        if (state.tries + 1 >= SPEECH_MAX_TRIES) {
          const k = action.closest !== undefined && ks.includes(action.closest) ? action.closest : 0;
          return { ...state, tries: state.tries + 1, chosen: k, how: 'closest' };
        }
        return { ...state, tries: state.tries + 1 };
      }
      case 'tap':
        return canTap(state) && ks.includes(action.k) ? { ...state, chosen: action.k, how: 'tapped' } : state;
      case 'unavailable':
        return { ...state, mode: 'tap' };
      case 'skip':
        return { ...state, skipped: true };
      default:
        return state;
    }
  },

  isDone: (_puzzle, state) => state.chosen !== null || state.skipped,
  mistakes: () => 0, // there is no wrong choice
  missedUnitIds: () => [],
  solve: () => ({ kind: 'said', index: 0 }),
  // No move is wrong here: an unrecognised try is not a mistake.
  wrongAction: () => null,

  validate(puzzle: SayChoicePuzzle, scene: Scene): string[] {
    const p: string[] = [];
    const i = scene.lines.findIndex((l) => l.id === puzzle.lineId);
    if (i < 0) return [`say-choice: line ${puzzle.lineId} is not in the scene`];
    const line = scene.lines[i]!;
    const alts = alternatesOf(line);
    if (alts.length < 2) p.push('say-choice: the line has fewer than two alternates');
    if (puzzle.options.length !== 3) p.push(`say-choice: ${puzzle.options.length} options`);
    const ks = puzzle.options.map((o) => o.k).sort();
    if (ks.join(',') !== '0,1,2') p.push('say-choice: options are not the line and its first two alternates');
    for (const o of puzzle.options) {
      const want = o.k === 0 ? original(line) : alts[o.k - 1];
      if (!want || want.fr !== o.fr || want.en !== o.en) p.push(`say-choice: option ${o.k} differs from its source`);
      if (!o.units.length) p.push(`say-choice: option ${o.k} has no units`);
    }
    const folds = new Set(puzzle.options.map((o) => foldFr(o.fr)));
    if (folds.size !== puzzle.options.length) p.push('say-choice: two options say the same thing');
    if ((scene.lines[i - 1]?.id ?? null) !== puzzle.beforeId || (scene.lines[i + 1]?.id ?? null) !== puzzle.afterId) p.push('say-choice: wrong neighbours');
    if (!puzzle.helpLineIds.includes(line.id)) p.push('say-choice: the line is not on the help strip');
    if (puzzle.maxRecordMs < 3000 || puzzle.maxRecordMs > LISTEN_MAX_MS) p.push('say-choice: odd recording limit');
    return p;
  },
};
