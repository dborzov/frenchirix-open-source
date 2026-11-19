// The speaking core every microphone puzzle shares (say-line, say-hidden, act-line; say-chain uses it
// per item). The server's verdict on one recording reaches the reducer as an action, so the logic
// stays pure.
//
// The user's rule (2026-11-14): friction from speech recognition is worse than a gameable puzzle.
// - Partial credit builds: the expected words heard in any try stay lit (`lit`, OR over tries).
// - A try passes when the server says so, or when every word has been heard across the tries.
// - The third try at the same target always passes, whatever came back (`auto`), with the same
//   celebration as a real pass. Tries one and two that fail count a mistake (stars only).
// - Recognition unavailable (503): listen-back, then "c'est moi !"; no score, no mistake.
// - A take in which no voice was heard (silent, or too short) is no try at all: the view never sends
//   it and nothing reaches the reducer (web/src/speech: "I didn't hear you", and the microphone again).
// - The microphone listens LISTEN_MAX_MS at most per take (the user: never listen long).

import { SPEECH_MAX_TRIES } from '../rules';

export interface SpeakVerdict {
  pass: boolean;
  score: number;
  matched: { word: string; ok: boolean }[]; // the expected words, in order, and whether each was heard
  transcript?: string;
}

export interface SpeakState {
  tries: number; // scored attempts so far
  passed: boolean;
  /** Passed by the third-try rule rather than by recognition. */
  auto: boolean;
  last: SpeakVerdict | null; // the latest verdict, for the view
  /** Per expected word: heard in at least one try so far. */
  lit: boolean[];
  mode: 'speak' | 'listen-back'; // listen-back: recognition unavailable this round
  done: 'passed' | 'listened' | 'skipped' | null;
  mistakes: number; // failed tries before the pass
}

export type SpeakAction =
  | ({ kind: 'verdict' } & SpeakVerdict) // the server's answer to one recording (or a quiet timeout: pass false, nothing matched)
  | { kind: 'unavailable' } // POST /api/speech gave no verdict: switch to listen-back
  | { kind: 'me' } // listen-back: "c'est moi !"
  | { kind: 'skip' }; // no microphone: skip without penalty

export function speakInit(): SpeakState {
  return { tries: 0, passed: false, auto: false, last: null, lit: [], mode: 'speak', done: null, mistakes: 0 };
}

/** OR-merges the words heard in a verdict into what was heard before. */
export function mergeLit(lit: readonly boolean[], matched: readonly { ok: boolean }[]): boolean[] {
  const n = Math.max(lit.length, matched.length);
  return Array.from({ length: n }, (_, i) => !!lit[i] || !!matched[i]?.ok);
}

/** True when the next failing try would still leave the round open (the third try always passes). */
export function canFail(state: SpeakState): boolean {
  return state.done === null && state.mode === 'speak' && state.tries < SPEECH_MAX_TRIES - 1;
}

export function speakReduce(state: SpeakState, action: SpeakAction): SpeakState {
  if (!action || state.done) return state;
  switch (action.kind) {
    case 'verdict': {
      if (state.mode !== 'speak') return state;
      const last: SpeakVerdict = { pass: !!action.pass, score: action.score, matched: action.matched ?? [], ...(action.transcript !== undefined ? { transcript: action.transcript } : {}) };
      const lit = mergeLit(state.lit, last.matched);
      const tries = state.tries + 1;
      const allHeard = lit.length > 0 && lit.every(Boolean);
      if (last.pass || allHeard) return { ...state, tries, passed: true, last, lit, done: 'passed' };
      if (tries >= SPEECH_MAX_TRIES) return { ...state, tries, passed: true, auto: true, last, lit, done: 'passed' };
      return { ...state, tries, last, lit, mistakes: state.mistakes + 1 };
    }
    case 'unavailable':
      return state.mode === 'listen-back' ? state : { ...state, mode: 'listen-back' };
    case 'me':
      return state.mode === 'listen-back' ? { ...state, done: 'listened' } : state;
    case 'skip':
      return { ...state, done: 'skipped' };
    default:
      return state;
  }
}

export type VerdictAction = { kind: 'verdict' } & SpeakVerdict;
export const passingVerdict = (words: string[]): VerdictAction => ({ kind: 'verdict', pass: true, score: 1, matched: words.map((word) => ({ word, ok: true })) });
export const failingVerdict = (words: string[]): VerdictAction => ({ kind: 'verdict', pass: false, score: 0, matched: words.map((word) => ({ word, ok: false })), transcript: 'brrr' });

/** The words of a French text as the server lists them (SpeechResponse.matched): whitespace-split, as written. */
export function frWords(text: string): string[] {
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
}

/** Character spans [cs, ce) of frWords(text) in text. */
export function frWordSpans(text: string): { cs: number; ce: number }[] {
  const out: { cs: number; ce: number }[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) if (/[\p{L}\p{N}]/u.test(m[0])) out.push({ cs: m.index, ce: m.index + m[0].length });
  return out;
}

/**
 * How much of each span (a unit's [cs, ce) in the target text) has been heard: the share of the
 * target's words overlapping it that are lit. 1 = all heard, 0 = none (or no word inside).
 */
export function spanCredit(text: string, lit: readonly boolean[], cs: number, ce: number): number {
  const spans = frWordSpans(text);
  let n = 0;
  let k = 0;
  spans.forEach((s, i) => {
    if (s.ce > cs && s.cs < ce) {
      n++;
      if (lit[i]) k++;
    }
  });
  return n ? k / n : 0;
}

/**
 * The longest the microphone listens in one take, whatever the target (the user, 2026-11-14: "every
 * time the microphone is turned on … no more than 10 seconds"). The release's longest line lasts 5.7 s
 * in the scene; a take cut at this limit is sent as it is, and the words heard stay lit for the next try.
 */
export const LISTEN_MAX_MS = 10_000;

/** Recording limit for a target that lasts `ms` in the scene (kids speak slower than cartoons), at most LISTEN_MAX_MS. */
export function recordLimitMs(ms: number, cap = LISTEN_MAX_MS): number {
  return Math.round(Math.min(cap, LISTEN_MAX_MS, Math.max(4000, ms * 2.5 + 2500)));
}
