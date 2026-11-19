// "Say them in a row" (say-chain): five or six words or expressions of the scene, hands-free. Each
// is shown big with its meaning and played once; the microphone opens by itself; a recognised answer
// moves on by itself with a small reward; a miss replays the model and listens again by itself; the
// third try at an item always passes (speak-core.ts rule). One tap starts the chain (browsers need a
// gesture to open the microphone); none after that. A take with no voice is no try: the view pauses
// the chain ("I didn't hear you") and the kid taps to go on, so the microphone never keeps listening
// to nobody; nothing reaches this logic.
//
// The state follows one item at a time with the speaking core's rules: what was heard of the item
// stays lit across its tries. Recognition unavailable (503): that item becomes listen-back (the model,
// then the kid's voice, then on), with no score; the next item asks again, so a server that answers
// again scores again (a verdict or a timeout is taken in either mode).

import type { Scene, Unit } from '../content';
import type { BotHooks } from '../practice/bot';
import type { Rng } from '../practice/rng';
import type { BuildCtx, PuzzleType, PuzzleBase } from '../practice/types';
import { SPEECH_MAX_TRIES } from '../rules';
import { normalizeEn } from './listen-pick';
import { foldFr, letterCount, nameLike, wordCount } from './match';
import { failingVerdict, frWords, LISTEN_MAX_MS, mergeLit, passingVerdict, recordLimitMs, type SpeakVerdict } from './speak-core';

export interface ChainItem {
  unitId: string;
  lineId: string;
  fr: string;
  en: string;
  startMs: number; // the model: the unit's window in the scene audio
  endMs: number;
  drill?: string; // a v1 recording of the word, used as the model when there is one
}

export interface SayChainPuzzle extends PuzzleBase {
  type: 'say-chain';
  items: ChainItem[];
  maxRecordMs: number; // per item
}

export type ChainResult = { how: 'heard' | 'auto' | 'listened'; tries: number };

export interface SayChainState {
  index: number; // the item being said
  tries: number; // tries on the current item
  lit: boolean[]; // words of the current item heard so far
  last: SpeakVerdict | null; // the latest verdict on the current item
  results: ChainResult[]; // one per finished item
  mistakes: number; // failed tries (stars only)
  mode: 'speak' | 'listen-back'; // listen-back: the last answer was "unavailable", the item ends with `next`
  skipped: boolean;
}

export type SayChainAction =
  | ({ kind: 'verdict' } & SpeakVerdict) // the server's answer for the current item
  | { kind: 'unavailable' } // no verdict: this item is listen-back
  | { kind: 'next' } // listen-back: the kid heard themself, on to the next item
  | { kind: 'timeout' } // the answer took too long: the item counts as done (no friction from a slow server)
  | { kind: 'skip' }; // no microphone

export const CHAIN_MIN = 4;
export const CHAIN_MAX = 6;

export function chainLength(level: number): number {
  return level <= 2 ? 5 : 6;
}

function eligible(unit: Unit, approx: boolean): boolean {
  const k = wordCount(unit.fr);
  return unit.key && !nameLike(unit) && !!normalizeEn(unit.en) && letterCount(unit.fr) >= 2 && k >= 1 && k <= 4 && unit.fr.length <= 26 && unit.endMs - unit.startMs >= 250 && (!approx || !!unit.drill);
}

function advance(state: SayChainState, how: ChainResult['how']): SayChainState {
  return { ...state, index: state.index + 1, tries: 0, lit: [], last: null, results: [...state.results, { how, tries: state.tries + (how === 'listened' ? 0 : 1) }] };
}

export const sayChain: PuzzleType<SayChainPuzzle, SayChainState, SayChainAction> & BotHooks<SayChainPuzzle, SayChainState, SayChainAction> = {
  type: 'say-chain',
  meta: {
    role: 'produce',
    minLevel: 1,
    maxLevel: 6,
    needsMic: true,
    seconds: 50,
    weight: 2,
    name: 'Say them in a row',
    purpose: 'Five or six words or expressions of the scene, each shown with its meaning and played once, said one after another without tapping: quick, repeated pronunciation of the key pieces.',
    depth: 'core',
    scope: 'unit',
  },

  build(ctx: BuildCtx): SayChainPuzzle | null {
    const { scene, rng, focusUnitIds, usedUnitIds } = ctx;
    const want = chainLength(ctx.level);
    const all: { u: Unit; lineId: string; score: number; used: boolean; target: boolean }[] = [];
    const targets = new Set(ctx.targetUnitIds ?? []);
    for (const line of scene.lines)
      for (const u of line.units) {
        if (!eligible(u, !!line.approxTimes)) continue;
        all.push({ u, lineId: line.id, used: usedUnitIds.has(u.id), target: targets.has(u.id), score: (focusUnitIds.has(u.id) ? 4 : 0) + (u.drill ? 0.5 : 0) + rng.next() * 2 });
      }
    all.sort((a, b) => Number(b.target) - Number(a.target) || Number(a.used) - Number(b.used) || b.score - a.score);
    const picked: typeof all = [];
    for (const c of all) {
      if (picked.length >= want) break;
      if (picked.some((p) => foldFr(p.u.fr) === foldFr(c.u.fr))) continue;
      picked.push(c);
    }
    if (picked.length < CHAIN_MIN) return null;
    if (targets.size && !picked.some((p) => p.target)) return null;
    // In the order of the scene: the chain walks through the dialogue.
    const order = new Map(scene.lines.flatMap((l, li) => l.units.map((u, ui) => [u.id, li * 1000 + ui] as const)));
    picked.sort((a, b) => order.get(a.u.id)! - order.get(b.u.id)!);
    for (const p of picked) usedUnitIds.add(p.u.id);
    const items: ChainItem[] = picked.map(({ u, lineId }) => ({ unitId: u.id, lineId, fr: u.fr, en: u.en, startMs: u.startMs, endMs: u.endMs, ...(u.drill ? { drill: u.drill } : {}) }));
    const lineIds = scene.lines.filter((l) => items.some((it) => it.lineId === l.id)).map((l) => l.id);
    return {
      id: `${scene.id}:say-chain`,
      type: 'say-chain',
      sceneId: scene.id,
      helpLineIds: lineIds,
      unitIds: items.map((it) => it.unitId),
      items,
      maxRecordMs: recordLimitMs(Math.max(...items.map((it) => it.endMs - it.startMs)), 5000),
    };
  },

  init(): SayChainState {
    return { index: 0, tries: 0, lit: [], last: null, results: [], mistakes: 0, mode: 'speak', skipped: false };
  },

  reduce(puzzle, state, action): SayChainState {
    if (!action || state.skipped || state.index >= puzzle.items.length) return state;
    switch (action.kind) {
      case 'verdict': {
        // An answer after a 503 means the server is back: scored as usual (ignoring it looped the item forever).
        const last: SpeakVerdict = { pass: !!action.pass, score: action.score, matched: action.matched ?? [], ...(action.transcript !== undefined ? { transcript: action.transcript } : {}) };
        const lit = mergeLit(state.lit, last.matched);
        const heard = last.pass || (lit.length > 0 && lit.every(Boolean));
        const s = { ...state, lit, last, mode: 'speak' as const };
        if (heard) return advance(s, 'heard');
        if (state.tries + 1 >= SPEECH_MAX_TRIES) return advance(s, 'auto');
        return { ...s, tries: state.tries + 1, mistakes: state.mistakes + 1 };
      }
      case 'unavailable':
        return { ...state, mode: 'listen-back' };
      case 'next':
        return state.mode === 'listen-back' ? advance(state, 'listened') : state;
      case 'timeout':
        return advance({ ...state, mode: 'speak' }, 'auto');
      case 'skip':
        return { ...state, skipped: true };
      default:
        return state;
    }
  },

  isDone: (puzzle, state) => state.skipped || state.index >= puzzle.items.length,
  mistakes: (_puzzle, state) => state.mistakes,
  missedUnitIds(puzzle, state) {
    const missed = puzzle.items.filter((_, i) => (state.results[i]?.tries ?? 0) > 1).map((it) => it.unitId);
    if (state.tries > 0 && puzzle.items[state.index]) missed.push(puzzle.items[state.index]!.unitId);
    return missed;
  },
  solve: (puzzle, state) => passingVerdict(frWords(puzzle.items[state.index]?.fr ?? '')),
  wrongAction(puzzle: SayChainPuzzle, state: SayChainState, _rng: Rng) {
    if (state.skipped || state.mode !== 'speak' || state.index >= puzzle.items.length || state.tries >= SPEECH_MAX_TRIES - 1) return null;
    return failingVerdict(frWords(puzzle.items[state.index]!.fr));
  },

  validate(puzzle: SayChainPuzzle, scene: Scene): string[] {
    const p: string[] = [];
    const n = puzzle.items.length;
    if (n < CHAIN_MIN || n > CHAIN_MAX) p.push(`say-chain: ${n} items`);
    if (puzzle.maxRecordMs < 3000 || puzzle.maxRecordMs > LISTEN_MAX_MS) p.push('say-chain: odd recording limit');
    const seen = new Set<string>();
    for (const it of puzzle.items) {
      const line = scene.lines.find((l) => l.id === it.lineId);
      const u = line?.units.find((x) => x.id === it.unitId);
      if (!line || !u) {
        p.push(`say-chain: unit ${it.unitId} is not in the scene`);
        continue;
      }
      if (u.fr !== it.fr || u.en !== it.en) p.push(`say-chain: item ${it.unitId} differs from its unit`);
      if (!puzzle.helpLineIds.includes(line.id)) p.push(`say-chain: line ${line.id} is not on the help strip`);
      if (!puzzle.unitIds.includes(u.id)) p.push(`say-chain: unit ${u.id} missing from unitIds`);
      if (line.approxTimes && !it.drill) p.push(`say-chain: ${u.id} has no exact model to play`);
      if (it.endMs <= it.startMs || it.endMs > scene.audio.durationMs + 50) p.push(`say-chain: ${u.id} window outside the audio`);
      const f = foldFr(it.fr);
      if (seen.has(f)) p.push(`say-chain: "${it.fr}" twice`);
      seen.add(f);
    }
    return p;
  },
};
