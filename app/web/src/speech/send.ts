// Sends a take to POST /api/speech and turns the answer into a puzzle type action: a verdict, or
// 'unavailable' (503 speech-unavailable, the daily limit, offline: anything that is not a verdict),
// which switches the round to listen-back. Never throws: a kid is never stuck on a network error.
//
// Dev builds only: `?transcript=<French>` in the page URL is forwarded as the x-test-transcript
// header (a worker in TEST_MODE uses it instead of Whisper; the fixture client scores it), and
// `?transcript=!unavailable` makes the fixture client answer 503.
import type { SpeechQuery, SpeechResponse } from '../../../shared/api';
import type { VerdictAction } from '../../../shared/puzzles/speak-core';
import { api, ApiRequestError } from '../api';
import { puzzleWhere } from '../log';
import { usePlayer } from '../state/player';

export function devTestTranscript(): string | undefined {
  if (!import.meta.env.DEV || typeof location === 'undefined') return undefined;
  const v = new URLSearchParams(location.search).get('transcript');
  return v === null ? undefined : v;
}

/** The raw answer (for say-choice and the speaking lab), or null when there is no verdict. */
/** How long a kid waits for recognition before the puzzle goes on without it (listen-back), in every speaking type. */
export const SPEECH_TIMEOUT_MS = 8000;

export async function askSpeech(query: SpeechQuery, wav: Blob, testTranscript = devTestTranscript(), timeoutMs = SPEECH_TIMEOUT_MS): Promise<{ res: SpeechResponse; ms: number } | { error: string; ms: number }> {
  const t0 = performance.now();
  try {
    let timer = 0;
    const late = new Promise<never>((_, reject) => {
      timer = window.setTimeout(() => reject(new Error('timeout')), timeoutMs);
    });
    // The puzzle type asking goes into the server's speech log.
    const type = query.type ?? puzzleWhere()?.type;
    const q = type ? { ...query, type } : query;
    const res = await Promise.race([api.speech(q, wav, testTranscript !== undefined ? { testTranscript } : undefined), late]).finally(() => window.clearTimeout(timer));
    usePlayer.getState().apply(res.patch);
    return { res, ms: Math.round(performance.now() - t0) };
  } catch (e) {
    const timeout = e instanceof Error && e.message === 'timeout';
    if (!timeout && (!(e instanceof ApiRequestError) || e.code !== 'speech-unavailable')) console.warn('[speech] no verdict:', e);
    return { error: timeout ? 'timeout' : e instanceof ApiRequestError ? e.code : String(e), ms: Math.round(performance.now() - t0) };
  }
}

export async function sendSpeech(query: SpeechQuery, wav: Blob): Promise<VerdictAction | { kind: 'unavailable' }> {
  const r = await askSpeech(query, wav);
  if ('error' in r) return { kind: 'unavailable' };
  const res = r.res;
  return { kind: 'verdict', pass: res.pass, score: res.score, matched: res.matched, transcript: res.transcript };
}
