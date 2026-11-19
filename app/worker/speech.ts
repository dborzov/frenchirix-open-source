// Speech: POST /api/speech scores a kid saying a line, a unit, an alternate of a line, or one of
// several candidates (a line and its alternates, for say-choice). Whisper (Workers AI) transcribes the
// WAV with vad_filter and, by default, the show's names plus the expected text(s) as initial_prompt
// (measured, docs/app-server.md "Why this speech design": honest attempts accepted 86% -> 97%; never `prefix`);
// shared/speech.ts scores the transcript. When that does not pass, a small text model (the judge)
// is asked whether the transcript is an attempt at the target by sound; a yes passes. When the judge
// fails or times out, a lenient rule decides. The audio is not stored; the transcript and the verdict go
// to the activity log (worker/activity.ts).
import { Hono } from 'hono';
import type { SpeechDebug, SpeechDecider, SpeechResponse } from '../shared/api';
import { SPEECH_HINT, judgeMessages, lenientPass, parseJudge, scoreSpeech, type JudgeVerdict, type SpeechScore } from '../shared/speech';
import { logTx } from './activity';
import { isAdmin } from './admin';
import { getContent, getScene } from './content';
import { ensureDaily } from './daily';
import type { AppEnv, Env } from './env';
import { runTx } from './session';
import { fail, testMode } from './util';

export const WHISPER = '@cf/openai/whisper-large-v3-turbo';
export const SPEECH_MAX_BYTES = 1_200_000;
export const SPEECH_MAX_S = 30;
export const SPEECH_PER_DAY = 600;
/** The judge: chosen by measurement (docs/app-server.md, "Why this speech design"). */
export const JUDGE = '@cf/google/gemma-4-26b-a4b-it';
export const JUDGE_TIMEOUT_MS = 2500;
/** From this try on the client accepts anyway, so the judge is not asked. */
export const JUDGE_LAST_ATTEMPT = 2;

/** Duration of a PCM WAV in seconds, or null when it is not a WAV we understand. */
export function wavSeconds(buf: ArrayBuffer): number | null {
  const v = new DataView(buf);
  if (buf.byteLength < 44) return null;
  const tag = (o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;
  let o = 12;
  let byteRate = 0;
  while (o + 8 <= buf.byteLength) {
    const id = tag(o);
    const size = v.getUint32(o + 4, true);
    if (id === 'fmt ') byteRate = v.getUint32(o + 16, true);
    if (id === 'data') {
      if (!byteRate) return null;
      return Math.min(size, buf.byteLength - o - 8) / byteRate;
    }
    o += 8 + size + (size % 2);
  }
  return null;
}

/** x-test-transcript is percent-encoded (header values must be Latin-1). */
export function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** The initial_prompt: the show's names, plus the expected text(s) unless mode is 'names'. */
export function speechHint(mode: 'expected' | 'names', texts: string[]): string {
  return mode === 'names' ? SPEECH_HINT : [SPEECH_HINT, ...texts].join(' ');
}

export async function transcribe(env: Env, wav: ArrayBuffer, hint: string): Promise<string> {
  const out = (await env.AI.run(WHISPER as any, {
    audio: toBase64(wav),
    language: 'fr',
    task: 'transcribe',
    initial_prompt: hint,
    vad_filter: true,
    condition_on_previous_text: false,
  } as any)) as { text?: string };
  return out?.text ?? '';
}

const JUDGE_SCHEMA = {
  type: 'object',
  properties: { attempt: { type: 'boolean' }, candidate: { type: 'integer' } },
  required: ['attempt', 'candidate'],
};

export interface JudgeResult {
  verdict: JudgeVerdict | null;
  raw: string;
  ms: number;
  promptChars: number;
  error?: string;
}

/** The text of a Workers AI chat answer, in either response shape (legacy `response` or OpenAI `choices`). */
function answerText(out: unknown): unknown {
  const o = out as { response?: unknown; choices?: { message?: { content?: unknown; reasoning?: unknown } }[] } | null;
  if (o?.response !== undefined && o.response !== null) return o.response;
  const m = o?.choices?.[0]?.message;
  return m?.content ?? m?.reasoning ?? null;
}

/** Ask the judge whether `heard` is an attempt at one of `candidates`; never throws. */
export async function judge(env: Env, candidates: string[], heard: string, timeoutMs = JUDGE_TIMEOUT_MS): Promise<JudgeResult> {
  const messages = judgeMessages(candidates, heard);
  const promptChars = messages.reduce((n, m) => n + m.content.length, 0);
  const t0 = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const call = env.AI.run(JUDGE as any, {
      messages,
      max_tokens: 40,
      temperature: 0,
      response_format: { type: 'json_schema', json_schema: JUDGE_SCHEMA },
      chat_template_kwargs: { enable_thinking: false },
    } as any);
    const timeout = new Promise<'timeout'>((r) => (timer = setTimeout(() => r('timeout'), timeoutMs)));
    const out = await Promise.race([call, timeout]);
    const ms = Date.now() - t0;
    if (out === 'timeout') return { verdict: null, raw: '', ms, promptChars, error: 'timeout' };
    const ans = answerText(out);
    const raw = typeof ans === 'string' ? ans : JSON.stringify(ans ?? null);
    return { verdict: parseJudge(ans, candidates.length), raw, ms, promptChars };
  } catch (e) {
    return { verdict: null, raw: '', ms: Date.now() - t0, promptChars, error: String((e as Error)?.message ?? e).slice(0, 200) };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export interface SpeechDecision {
  scores: SpeechScore[]; // per candidate
  best: number; // the candidate the answer describes
  pass: boolean;
  by: SpeechDecider;
  judge?: JudgeResult;
}

/**
 * The decision for one transcript: the sound-alike scorer first; when it does not pass and something
 * was heard (and the client is not about to accept the try anyway), the judge; when the judge gives no
 * usable answer, the lenient rule.
 */
export async function decideSpeech(
  candidates: string[],
  transcript: string,
  kind: 'line' | 'unit',
  attempt: number,
  ask: (candidates: string[], heard: string) => Promise<JudgeResult>,
): Promise<SpeechDecision> {
  const scores = candidates.map((x) => scoreSpeech(x, transcript, { kind }));
  let best = 0;
  scores.forEach((x, i) => {
    if (x.score > scores[best]!.score) best = i;
  });
  if (scores[best]!.pass) return { scores, best, pass: true, by: 'scorer' };
  if (!scores.some((x) => x.heardWords.length > 0) || attempt > JUDGE_LAST_ATTEMPT) return { scores, best, pass: false, by: 'none' };
  const jr = await ask(candidates, transcript);
  if (jr.verdict) {
    const k = jr.verdict.candidate;
    if (jr.verdict.attempt && k >= 0 && k < candidates.length) best = k;
    return { scores, best, pass: jr.verdict.attempt, by: 'judge', judge: jr };
  }
  let k = -1;
  scores.forEach((x, i) => {
    if (lenientPass(x) && (k < 0 || x.score > scores[k]!.score)) k = i;
  });
  return { scores, best: k >= 0 ? k : best, pass: k >= 0, by: 'fallback', judge: jr };
}

interface AltLine {
  fr: string;
}

export const speechRoutes = new Hono<AppEnv>();

speechRoutes.post('/speech', async (c) => {
  const q = (k: string) => c.req.query(k);
  const sceneId = q('scene') ?? '';
  const targets = (['line', 'unit', 'alt', 'choice'] as const).filter((k) => q(k));
  if (!sceneId || targets.length !== 1) return fail(400, 'bad-request', 'scene and exactly one of line, unit, alt, choice');
  const target = targets[0]!;
  const ref = q(target)!;
  const hintMode = q('hint') === 'names' ? 'names' : 'expected';
  const attempt = Math.max(1, Math.min(99, Number(q('attempt')) || 1));
  const len = Number(c.req.header('content-length') ?? 0);
  if (len > SPEECH_MAX_BYTES) return fail(413, 'bad-request', 'too big');
  const debug = q('debug') === '1' && (await isAdmin(c));
  const content = await getContent(c.env);
  return runTx(c, async (tx) => {
    await tx.preload(['progress', 'daily', 'achievements']);
    if (!(await tx.progress()).has(sceneId)) return fail(403, 'scene-locked');
    const scene = await getScene(c.env, sceneId);
    if (!scene) return fail(404, 'not-found', 'scene');
    const line = (id: string) => scene.lines.find((l) => l.id === id);
    const alts = (id: string) => ((line(id) as { alternates?: AltLine[] } | undefined)?.alternates ?? []).map((a) => a.fr);
    // The candidates: one, except for `choice` (the line, then its alternates).
    let candidates: string[] = [];
    if (target === 'line') candidates = [line(ref)?.fr ?? ''];
    else if (target === 'unit') candidates = [scene.lines.flatMap((l) => l.units).find((u) => u.id === ref)?.fr ?? ''];
    else if (target === 'alt') {
      const i = ref.lastIndexOf(':');
      candidates = [alts(ref.slice(0, i))[Number(ref.slice(i + 1))] ?? ''];
    } else if (line(ref)) candidates = [line(ref)!.fr, ...alts(ref)];
    if (!candidates.length || candidates.some((x) => !x)) return fail(404, 'not-found', 'target');
    const d = await ensureDaily(tx, content);
    if (d.speech_n >= SPEECH_PER_DAY) return fail(429, 'rate-limited', 'speech per day');

    const wav = await c.req.arrayBuffer();
    if (wav.byteLength > SPEECH_MAX_BYTES) return fail(413, 'bad-request', 'too big');
    const secs = wavSeconds(wav);
    if (secs === null) return fail(400, 'bad-request', 'not a WAV');
    if (secs > SPEECH_MAX_S) return fail(413, 'bad-request', 'too long');

    const hint = speechHint(hintMode, candidates);
    let raw: string;
    const t0 = Date.now();
    const fake = testMode(c.env) ? c.req.header('x-test-transcript') : undefined;
    if (fake !== undefined) raw = safeDecode(fake);
    else {
      try {
        raw = await transcribe(c.env, wav, hint);
      } catch (e) {
        console.error('whisper failed', e);
        return fail(503, 'speech-unavailable');
      }
    }
    const ms = Date.now() - t0;
    const transcript = raw.trim();
    const kind = target === 'unit' ? 'unit' : 'line';
    // Test mode: x-test-judge is the judge's answer ('fail' = the judge failed; 'real' = ask the real
    // judge). With a fake transcript and no x-test-judge, the judge counts as failed (no model call).
    let fakeJudge = testMode(c.env) ? c.req.header('x-test-judge') : undefined;
    if (fakeJudge === undefined && fake !== undefined) fakeJudge = 'fail';
    const ask = (cands: string[], heard: string): Promise<JudgeResult> =>
      fakeJudge === undefined || fakeJudge === 'real'
        ? judge(c.env, cands, heard)
        : Promise.resolve(fakeJudge === 'fail' ? { verdict: null, raw: '', ms: 0, promptChars: 0, error: 'test' } : { verdict: parseJudge(fakeJudge, cands.length), raw: fakeJudge, ms: 0, promptChars: 0 });
    const { scores, best, pass, by, judge: jr } = await decideSpeech(candidates, transcript, kind, attempt, ask);
    const s = scores[best]!;
    const totalMs = Date.now() - t0;
    d.speech_n++;
    tx.saveDaily();
    if (pass) tx.bumpStat('linesSpoken');
    logTx(tx, c, 'speech', { type: q('type')?.slice(0, 30) ?? null, scene: sceneId, target, ref, attempt, hint: hintMode, expected: candidates.map((x) => x.slice(0, 200)), transcript: transcript.slice(0, 300), score: s.score, pass, by, best, ms, judgeMs: jr?.ms, judgeError: jr?.error, totalMs });
    await tx.commit();
    console.log(
      JSON.stringify({
        speech: { scene: sceneId, target, ref, attempt, hint: hintMode, score: s.score, pass, by, best, ms, judgeMs: jr?.ms, judgeError: jr?.error, totalMs },
      }),
    );
    const res: SpeechResponse = {
      transcript,
      score: s.score,
      pass,
      matched: s.expectedWords.map((word, i) => ({ word, ok: !!s.matched[i] })),
      expectedWords: s.expectedWords,
      heardWords: s.heardWords,
      by,
      patch: tx.patch,
    };
    if (target === 'choice') res.choice = { index: best, scores: scores.map((x) => x.score) };
    if (debug) {
      res.debug = { hint, ms, raw, attempt, by, totalMs } satisfies SpeechDebug;
      if (jr) res.debug.judge = { model: JUDGE, ms: jr.ms, promptChars: jr.promptChars, raw: jr.raw, verdict: jr.verdict, ...(jr.error ? { error: jr.error } : {}) };
    }
    return c.json(res);
  });
});
