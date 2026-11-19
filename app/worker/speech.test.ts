import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Scene } from '../shared/content';
import { FIXTURE_INDEX, FIXTURE_SCENE, fixtureSceneFor } from '../shared/fixtures';
import { SPEECH_HINT } from '../shared/speech';
import { setContentForTests } from './content';
import { parseJudge } from '../shared/speech';
import FIXTURES from './speech-judge.fixtures.json';
import { JUDGE, decideSpeech, speechHint, type JudgeResult } from './speech';
import { ADMIN_PASSWORD, Browser, freshWorld, unlockSome } from './testing';

const LINE = FIXTURE_SCENE.lines[0]!;
const ALTS = ['Les Romains mangent des sangliers tout crus.', 'Obélix danse avec un menhir rose.'];

beforeEach(async () => {
  await freshWorld();
  // The fixture scene with two alternates on its first line (the export adds Line.alternates).
  setContentForTests({
    index: FIXTURE_INDEX,
    scene: (id) => {
      const s = fixtureSceneFor(id);
      if (!s) return null;
      const lines = s.lines.map((l, i) => (i === 0 ? { ...l, alternates: ALTS.map((fr) => ({ fr, en: '', units: [] })) } : l));
      return { ...s, lines } as Scene;
    },
  });
});
afterEach(() => {
  delete (env as { LOCAL_DEV?: string }).LOCAL_DEV;
});

function wav(seconds: number): Uint8Array {
  const n = Math.round(16000 * seconds) * 2;
  const v = new DataView(new ArrayBuffer(44 + n));
  const w = (o: number, s: string) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  w(0, 'RIFF');
  v.setUint32(4, 36 + n, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, 16000, true);
  v.setUint32(28, 32000, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  w(36, 'data');
  v.setUint32(40, n, true);
  return new Uint8Array(v.buffer);
}

async function kid() {
  const b = new Browser();
  await b.start();
  const id = (await unlockSome(b, 1))[0]!;
  const say = (query: string, heard: string) =>
    b.json('POST', `/api/speech?scene=${id}&${query}`, wav(2), { 'content-type': 'audio/wav', 'x-test-transcript': encodeURIComponent(heard) });
  return { b, id, say };
}

describe('speech targets and hints', () => {
  it('the hint is the names plus the expected text(s), or the names alone', () => {
    expect(speechHint('names', ['x'])).toBe(SPEECH_HINT);
    expect(speechHint('expected', ['Bonjour.'])).toBe(`${SPEECH_HINT} Bonjour.`);
    expect(speechHint('expected', ['A.', 'B.'])).toBe(`${SPEECH_HINT} A. B.`);
  });

  it('scores a line, a unit and an alternate; returns expected and heard words', async () => {
    const { say } = await kid();
    const r = await say(`line=${LINE.id}`, LINE.fr);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ pass: true, transcript: LINE.fr });
    expect(r.body.expectedWords.length).toBeGreaterThan(1);
    expect(r.body.heardWords.length).toBeGreaterThan(1);
    expect(r.body.choice).toBeUndefined();
    expect(r.body.debug).toBeUndefined();
    const alt = await say(`alt=${LINE.id}:1`, ALTS[1]!);
    expect(alt.body.pass).toBe(true);
    expect((await say(`alt=${LINE.id}:7`, 'x')).status).toBe(404);
    expect((await say(`line=${LINE.id}&unit=${LINE.units[0]!.id}`, 'x')).status).toBe(400);
  });

  it('choice: scores every candidate and returns the best, with all scores', async () => {
    const { say } = await kid();
    const r = await say(`choice=${LINE.id}`, ALTS[0]!);
    expect(r.body.choice.index).toBe(1);
    expect(r.body.choice.scores).toHaveLength(3);
    expect(r.body.choice.scores[1]).toBe(r.body.score);
    expect(r.body.pass).toBe(true);
    const orig = await say(`choice=${LINE.id}`, LINE.fr);
    expect(orig.body.choice.index).toBe(0);
  });

  it('debug only for an admin or locally, never for a kid', async () => {
    const { say, b } = await kid();
    expect((await say(`line=${LINE.id}&debug=1&attempt=2`, LINE.fr)).body.debug).toBeUndefined();
    // The admin cookie.
    await b.fetch('POST', '/dev/login', { password: ADMIN_PASSWORD });
    const d = await say(`line=${LINE.id}&debug=1&attempt=2`, `  ${LINE.fr} `);
    expect(d.body.debug).toMatchObject({ hint: `${SPEECH_HINT} ${LINE.fr}`, raw: `  ${LINE.fr} `, attempt: 2 });
    expect(typeof d.body.debug.ms).toBe('number');
    const names = await say(`choice=${LINE.id}&hint=names&debug=1`, LINE.fr);
    expect(names.body.debug.hint).toBe(SPEECH_HINT);
    const all = await say(`choice=${LINE.id}&debug=1`, LINE.fr);
    expect(all.body.debug.hint).toBe(`${SPEECH_HINT} ${[LINE.fr, ...ALTS].join(' ')}`);
  });
});

// ---- The judge ---------------------------------------------------------------------------------
// Fixtures: real Whisper transcripts from the measurements in docs/app-server.md, "Why this speech design" (hint = names + expected text),
// with the answer the chosen judge model gave for each. `want` is the frozen decision; `right` says
// whether it is the right one for that audio (false: a known leak or a known miss, documented there).
interface Fixture {
  note: string;
  kind: 'line' | 'unit';
  candidates: string[];
  heard: string;
  judge: string;
  want: 'pass' | 'fail';
  by: 'scorer' | 'judge' | 'fallback' | 'none';
  right: boolean;
  pick?: number;
}

const answer = (raw: string): Promise<JudgeResult> => Promise.resolve({ verdict: parseJudge(raw, 9), raw, ms: 1, promptChars: 1 });

describe('decideSpeech: the scorer, then the judge, then the lenient rule', () => {
  it.each((FIXTURES as Fixture[]).map((f) => [f.note, f] as const))('%s', async (_, f) => {
    let asked = 0;
    const d = await decideSpeech(f.candidates, f.heard, f.kind, 1, (c) => {
      asked++;
      return Promise.resolve({ verdict: parseJudge(f.judge, c.length), raw: f.judge, ms: 1, promptChars: 1 });
    });
    expect(d.pass ? 'pass' : 'fail').toBe(f.want);
    expect(d.by).toBe(f.by);
    expect(asked).toBe(f.by === 'judge' || f.by === 'fallback' ? 1 : 0);
    if (f.pick !== undefined) expect(d.best).toBe(f.pick);
  });

  it('the regression set has both kinds of audio and every decider', () => {
    const fx = FIXTURES as Fixture[];
    expect(fx.length).toBeGreaterThan(40);
    for (const by of ['scorer', 'judge', 'none']) expect(fx.some((f) => f.by === by)).toBe(true);
    expect(fx.filter((f) => f.right).length).toBeGreaterThan(0.8 * fx.length);
  });

  it('a failed judge falls back to the lenient rule; nothing heard or a third try never asks', async () => {
    const failed = () => Promise.resolve({ verdict: null, raw: '', ms: 2500, promptChars: 1, error: 'timeout' } as JudgeResult);
    // Shares "fous" by sound: passes. English, or nothing of the target: fails.
    expect(await decideSpeech(['Ils sont fous, ces Romains !'], 'Il est fou le roi', 'line', 1, failed)).toMatchObject({ pass: true, by: 'fallback' });
    expect(await decideSpeech(['Ils sont fous, ces Romains !'], 'They are crazy, these Romans.', 'line', 1, failed)).toMatchObject({ pass: false, by: 'fallback' });
    expect(await decideSpeech(['Ils sont fous, ces Romains !'], 'Bonjour, chocolat.', 'line', 1, failed)).toMatchObject({ pass: false, by: 'fallback' });
    let asked = 0;
    const count = () => (asked++, answer('{"attempt": true, "candidate": 0}'));
    expect(await decideSpeech(['du pain'], '', 'unit', 1, count)).toMatchObject({ pass: false, by: 'none' });
    expect(await decideSpeech(['du pain'], "Sous-titrage ST' 501", 'unit', 1, count)).toMatchObject({ pass: false, by: 'none' });
    expect(await decideSpeech(['Ils sont fous, ces Romains !'], 'La la la.', 'line', 3, count)).toMatchObject({ pass: false, by: 'none' });
    expect(asked).toBe(0);
  });

  it('the judge picks the candidate for choice', async () => {
    const d = await decideSpeech(['Il a faim.', 'Toute la Gaule est libre.'], 'Tous les goals', 'line', 2, () => answer('{"attempt": true, "candidate": 1}'));
    expect(d).toMatchObject({ pass: true, by: 'judge', best: 1 });
  });
});

describe('POST /api/speech with the judge', () => {
  it('x-test-judge decides what the scorer did not pass; debug shows the judge', async () => {
    const { b, id } = await kid();
    await b.fetch('POST', '/dev/login', { password: ADMIN_PASSWORD });
    const say = (query: string, heard: string, judgeAnswer?: string) =>
      b.json('POST', `/api/speech?scene=${id}&${query}`, wav(2), {
        'content-type': 'audio/wav',
        'x-test-transcript': encodeURIComponent(heard),
        ...(judgeAnswer === undefined ? {} : { 'x-test-judge': judgeAnswer }),
      });
    const good = await say(`line=${LINE.id}&debug=1`, LINE.fr);
    expect(good.body).toMatchObject({ pass: true, by: 'scorer' });
    expect(good.body.debug.judge).toBeUndefined();
    const yes = await say(`line=${LINE.id}&debug=1`, 'blablabla quelque chose', '{"attempt": true, "candidate": 0}');
    expect(yes.body).toMatchObject({ pass: true, by: 'judge' });
    expect(yes.body.debug).toMatchObject({ by: 'judge', judge: { model: JUDGE, verdict: { attempt: true, candidate: 0 } } });
    expect(typeof yes.body.debug.totalMs).toBe('number');
    const no = await say(`line=${LINE.id}`, 'blablabla quelque chose', '{"attempt": false, "candidate": -1}');
    expect(no.body).toMatchObject({ pass: false, by: 'judge' });
    const broken = await say(`line=${LINE.id}&debug=1`, 'Bonjour chocolat', 'not json');
    expect(broken.body).toMatchObject({ pass: false, by: 'fallback' });
    expect(broken.body.debug.judge.verdict).toBeNull();
    const pick = await say(`choice=${LINE.id}`, 'blablabla', '{"attempt": true, "candidate": 2}');
    expect(pick.body).toMatchObject({ pass: true, by: 'judge', choice: { index: 2 } });
    // A fake transcript without x-test-judge never calls the model: the judge counts as failed.
    expect((await say(`line=${LINE.id}`, 'blablabla')).body.by).toBe('fallback');
  });
});
