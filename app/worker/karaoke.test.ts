// Karaoke recordings (worker/karaoke.ts): a take checked (Whisper stands in as x-test-transcript, or a
// mocked AI binding), kept unsaved, saved, replaced, dropped, removed; the audio only for its kid; the
// refusals (no session, another kid's recording, too big, over the daily cap, rude words, Whisper down,
// saving without a checked take); the activity log; the daily purge of unsaved takes; accounts.
import { createExecutionContext, createScheduledController, env, waitOnExecutionContext } from 'cloudflare:test';
import { exports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import type { KaraokeRecording, KaraokeTake } from '../shared/api';
import type { Song } from '../shared/content';
import { FIXTURE_INDEX, FIXTURE_SONG, fixtureSceneFor } from '../shared/fixtures';
import { KARAOKE_MAX_BYTES, KARAOKE_TAKES_PER_DAY } from '../shared/karaoke';
import { setContentForTests } from './content';
import worker from './index';
import { KARAOKE_CHUNK_BYTES, KARAOKE_WHISPER_TIMEOUT_MS, TAKE_KEEP_MS, timeBox, wavFormat } from './karaoke';
import { Browser, db, freshWorld } from './testing';

const SONG = FIXTURE_SONG.id; // 12 s
const LONG: Song = { ...FIXTURE_SONG, id: 'long-song', audio: { ...FIXTURE_SONG.audio, durationMs: 60_000 } };

beforeEach(async () => {
  await freshWorld();
  setContentForTests({ index: FIXTURE_INDEX, scene: fixtureSceneFor, song: (id) => (id === SONG ? FIXTURE_SONG : id === LONG.id ? LONG : null) });
});

/** A 16 kHz mono 16-bit WAV of `seconds`, its samples a ramp (so a round trip can be compared byte for byte). */
function wav(seconds: number, opts: { rate?: number; channels?: number; seed?: number } = {}): Uint8Array {
  const rate = opts.rate ?? 16000;
  const channels = opts.channels ?? 1;
  const n = Math.round(rate * seconds) * 2 * channels;
  const v = new DataView(new ArrayBuffer(44 + n));
  const w = (o: number, s: string) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  w(0, 'RIFF');
  v.setUint32(4, 36 + n, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, channels, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2 * channels, true);
  v.setUint16(32, 2 * channels, true);
  v.setUint16(34, 16, true);
  w(36, 'data');
  v.setUint32(40, n, true);
  for (let i = 44; i < 44 + n; i++) v.setUint8(i, (i * 7 + (opts.seed ?? 0)) & 0xff);
  return new Uint8Array(v.buffer);
}

const heard = (text: string) => ({ 'content-type': 'audio/wav', 'x-test-transcript': encodeURIComponent(text) });

async function kid(): Promise<Browser> {
  const b = new Browser();
  await b.start();
  return b;
}

function take(b: Browser, body: Uint8Array, opts: { song?: string; offset?: number; transcript?: string | null; headers?: Record<string, string> } = {}) {
  const headers = opts.transcript === null ? { 'content-type': 'audio/wav' } : heard(opts.transcript ?? "C'est un monde romain");
  return b.json('POST', `/api/karaoke/${opts.song ?? SONG}/take?offset=${opts.offset ?? 0}`, body, { ...headers, ...opts.headers });
}

async function audioOf(b: Browser, rec: { id: string }): Promise<Response> {
  return b.fetch('GET', `/api/karaoke/audio/${rec.id}.wav`);
}

async function rows(sql: string, ...binds: unknown[]): Promise<any[]> {
  return (await db().prepare(sql).bind(...binds).all()).results;
}

describe('a take: checked, heard, saved', () => {
  it('a clean take is kept unsaved; saving makes it the recording, in the state and its audio for this kid only', async () => {
    const b = await kid();
    const body = wav(4);
    const r = await take(b, body, { offset: 350 });
    expect(r.status).toBe(200);
    expect(r.body.verdict).toBe('ok');
    const t = { ...r.body.take, url: `/api/karaoke/audio/${r.body.take.id}.wav` } as KaraokeRecording;
    expect(r.body.take).toEqual({ id: t.id, songId: SONG, offsetMs: 350, durationMs: 4000 }); // no URL until kept
    // Not saved yet: not in the state, its audio not served.
    expect((await b.ok('GET', '/api/me')).state.recordings).toEqual({});
    expect((await audioOf(b, t)).status).toBe(404);

    const s = await b.json('POST', `/api/karaoke/${SONG}/save`, { takeId: t.id });
    expect(s.status).toBe(200);
    expect(s.body.recording).toEqual(t);
    expect(s.body.patch.recordings).toEqual({ [SONG]: t });
    expect((await b.ok('GET', '/api/me')).state.recordings).toEqual({ [SONG]: t });
    // The same tap again (its answer lost on the way): the same recording, no error.
    const retried = await b.json('POST', `/api/karaoke/${SONG}/save`, { takeId: t.id });
    expect(retried.status).toBe(200);
    expect(retried.body.recording).toEqual(t);
    expect(retried.body.patch.recordings).toEqual({ [SONG]: t });

    const a = await audioOf(b, t);
    expect(a.status).toBe(200);
    expect(a.headers.get('content-type')).toBe('audio/wav');
    expect(a.headers.get('cache-control')).toBe('private, no-cache');
    expect(a.headers.get('etag')).toBe(`"${t.id}"`);
    expect(new Uint8Array(await a.arrayBuffer())).toEqual(body);
    // The browser's copy is revalidated: unchanged, a 304 without the audio.
    const again = await b.fetch('GET', t.url, undefined, { 'if-none-match': `"${t.id}"` });
    expect(again.status).toBe(304);
    expect((await again.arrayBuffer()).byteLength).toBe(0);
  });

  it('a long take is split into chunks and comes back byte for byte', async () => {
    const b = await kid();
    const body = wav(54, { seed: 3 }); // the longest song: 1.73 MB
    expect(body.length).toBeGreaterThan(2 * KARAOKE_CHUNK_BYTES);
    const t = (await take(b, body, { song: LONG.id })).body.take as KaraokeTake;
    const parts = await rows('SELECT part, parts, length(data) AS chars FROM recordings WHERE id = ? ORDER BY part', t.id);
    expect(parts.map((p) => p.part)).toEqual([0, 1, 2]);
    expect(parts.every((p) => p.parts === 3 && p.chars <= 900_000)).toBe(true);
    await b.ok('POST', `/api/karaoke/${LONG.id}/save`, { takeId: t.id });
    const a = await audioOf(b, t);
    expect(new Uint8Array(await a.arrayBuffer())).toEqual(body);
  });

  it('a new take replaces the unsaved one; saving it replaces the older recording, whose audio is gone', async () => {
    const b = await kid();
    const first = (await take(b, wav(2, { seed: 1 }))).body.take as KaraokeTake;
    await b.ok('POST', `/api/karaoke/${SONG}/save`, { takeId: first.id });
    const second = (await take(b, wav(3, { seed: 2 }))).body.take as KaraokeTake;
    const third = (await take(b, wav(3, { seed: 3 }))).body.take as KaraokeTake;
    // The second take was replaced by the third: saving it is refused, the older recording untouched.
    expect((await b.json('POST', `/api/karaoke/${SONG}/save`, { takeId: second.id })).body.error).toBe('no-take');
    expect((await b.ok('GET', '/api/me')).state.recordings[SONG].id).toBe(first.id);
    expect((await audioOf(b, first)).status).toBe(200);
    await b.ok('POST', `/api/karaoke/${SONG}/save`, { takeId: third.id });
    expect((await b.ok('GET', '/api/me')).state.recordings[SONG].id).toBe(third.id);
    expect((await audioOf(b, first)).status).toBe(404);
    expect((await audioOf(b, third)).status).toBe(200);
    expect(await rows('SELECT DISTINCT id, saved FROM recordings')).toEqual([{ id: third.id, saved: 1 }]);
  });

  it('drop deletes the unsaved take only; remove deletes the recording; both are harmless twice', async () => {
    const b = await kid();
    const kept = (await take(b, wav(2))).body.take as KaraokeTake;
    await b.ok('POST', `/api/karaoke/${SONG}/save`, { takeId: kept.id });
    const t = (await take(b, wav(2, { seed: 9 }))).body.take as KaraokeTake;
    expect((await b.fetch('DELETE', `/api/karaoke/${SONG}/take`)).status).toBe(204);
    expect((await b.fetch('DELETE', `/api/karaoke/${SONG}/take`)).status).toBe(204);
    expect((await b.json('POST', `/api/karaoke/${SONG}/save`, { takeId: t.id })).status).toBe(409);
    expect((await b.ok('GET', '/api/me')).state.recordings[SONG].id).toBe(kept.id);

    const r = await b.json('DELETE', `/api/karaoke/${SONG}/recording`);
    expect(r.status).toBe(200);
    expect(r.body.patch.recordings).toEqual({ [SONG]: null });
    expect((await b.ok('GET', '/api/me')).state.recordings).toEqual({});
    expect((await audioOf(b, kept)).status).toBe(404);
    // The browser's cached copy is not confirmed either.
    expect((await b.fetch('GET', `/api/karaoke/audio/${kept.id}.wav`, undefined, { 'if-none-match': `"${kept.id}"` })).status).toBe(404);
    expect((await b.json('DELETE', `/api/karaoke/${SONG}/recording`)).status).toBe(200);
    expect(await rows('SELECT id FROM recordings')).toEqual([]);
  });
});

describe('refusals', () => {
  it('no session: 401 on every route', async () => {
    const b = new Browser();
    await b.enter();
    expect((await take(b, wav(2))).status).toBe(401);
    expect((await b.json('POST', `/api/karaoke/${SONG}/save`, { takeId: 'k_x' })).status).toBe(401);
    expect((await b.fetch('DELETE', `/api/karaoke/${SONG}/recording`)).status).toBe(401);
    expect((await b.fetch('GET', '/api/karaoke/audio/k_abcdefgh.wav')).status).toBe(401);
  });

  it('another kid can neither fetch, save, drop nor remove a kid’s recording or take', async () => {
    const a = await kid();
    const rec = (await take(a, wav(2))).body.take as KaraokeTake;
    await a.ok('POST', `/api/karaoke/${SONG}/save`, { takeId: rec.id });
    const pending = (await take(a, wav(2, { seed: 4 }))).body.take as KaraokeTake;
    const other = await kid();
    expect((await audioOf(other, rec)).status).toBe(404);
    expect((await other.fetch('GET', `/api/karaoke/audio/${rec.id}.wav`, undefined, { 'if-none-match': `"${rec.id}"` })).status).toBe(404); // a shared device's cache
    expect((await other.json('POST', `/api/karaoke/${SONG}/save`, { takeId: pending.id })).body.error).toBe('no-take');
    await other.fetch('DELETE', `/api/karaoke/${SONG}/take`);
    await other.json('DELETE', `/api/karaoke/${SONG}/recording`);
    expect((await other.ok('GET', '/api/me')).state.recordings).toEqual({});
    // The first kid still has both.
    expect((await audioOf(a, rec)).status).toBe(200);
    expect((await a.ok('POST', `/api/karaoke/${SONG}/save`, { takeId: pending.id })).recording.id).toBe(pending.id);
  });

  it('too big, longer than the song, not such a WAV, too short, a bad offset, an unknown song', async () => {
    const b = await kid();
    // Over the size cap (the header says so before the body is read; and a body over it).
    expect((await take(b, wav(2), { headers: { 'content-length': String(KARAOKE_MAX_BYTES + 1) } })).body.error).toBe('too-big');
    expect((await take(b, new Uint8Array(KARAOKE_MAX_BYTES + 10), { song: LONG.id })).body.error).toBe('too-big');
    // The fixture song lasts 12 s; 2 s of slack.
    expect((await take(b, wav(15))).body.error).toBe('too-big');
    expect((await take(b, wav(12), { offset: 3000 })).body.error).toBe('too-big');
    expect((await take(b, wav(13.5))).status).toBe(200);
    expect((await take(b, new TextEncoder().encode('not a wav at all, not at all, not at all, not at all'))).body.error).toBe('bad-request');
    expect((await take(b, wav(2, { rate: 44100 }))).body.error).toBe('bad-request');
    expect((await take(b, wav(2, { channels: 2 }))).body.error).toBe('bad-request');
    expect((await take(b, wav(0.5))).body.error).toBe('bad-request');
    expect((await take(b, wav(2), { offset: -5 })).body.error).toBe('bad-request');
    expect((await take(b, wav(2), { offset: 999_999 })).body.error).toBe('bad-request');
    const unknown = await take(b, wav(2), { song: 'no-such-song' });
    expect([unknown.status, unknown.body.error]).toEqual([404, 'not-found']);
    // Only the one good take was checked.
    expect((await rows("SELECT karaoke_n FROM daily"))[0].karaoke_n).toBe(1);
  });

  it(`over ${KARAOKE_TAKES_PER_DAY} checked takes a day: 429, and Whisper is not asked; the next day works again`, async () => {
    const b = await kid();
    for (let i = 0; i < KARAOKE_TAKES_PER_DAY; i++) expect((await take(b, wav(1, { seed: i }), { transcript: i % 2 ? 'merde' : 'la la la' })).status).toBe(200);
    let asked = 0;
    const ai = env.AI;
    (env as { AI: unknown }).AI = { run: async () => (asked++, { text: 'la la' }) };
    const r = await take(b, wav(1), { transcript: null }).finally(() => ((env as { AI: unknown }).AI = ai));
    expect([r.status, r.body.error]).toEqual([429, 'rate-limited']);
    expect(asked).toBe(0);
    b.at('2026-11-14');
    expect((await take(b, wav(1))).status).toBe(200);
  });

  it('rude words: refused, nothing kept, the word logged but never sent back', async () => {
    const b = await kid();
    const r = await take(b, wav(3), { transcript: "C'est un monde romain, putain de Romains" });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ verdict: 'refused', take: null });
    expect(JSON.stringify(r.body)).not.toContain('putain');
    expect(await rows('SELECT id FROM recordings')).toEqual([]);
    const log = await rows("SELECT data FROM activity WHERE kind = 'karaoke-take'");
    expect(JSON.parse(log[0].data)).toMatchObject({ songId: SONG, verdict: 'refused', words: ['putain'], takeId: null, durationMs: 3000 });
    // The song's own words never count, Whisper's stock hallucinations neither.
    expect((await take(b, wav(3), { transcript: 'Sous-titrage ST’ 501' })).body.verdict).toBe('ok');
  });

  it('Whisper down: 503 speech-unavailable, not counted, nothing kept; the same take sent again works', async () => {
    const b = await kid();
    const body = wav(3);
    const ai = env.AI;
    (env as { AI: unknown }).AI = { run: async () => Promise.reject(new Error('test: whisper down')) };
    const down = await take(b, body, { transcript: null }).finally(() => ((env as { AI: unknown }).AI = ai));
    expect([down.status, down.body.error]).toEqual([503, 'speech-unavailable']);
    expect(await rows('SELECT id FROM recordings')).toEqual([]);
    expect(await rows("SELECT id FROM activity WHERE kind = 'karaoke-take'")).toEqual([]);
    // Whisper back (the real call: base64 WAV, French, the names as the hint).
    let input: any = null;
    (env as { AI: unknown }).AI = { run: async (_m: string, i: unknown) => ((input = i), { text: 'un monde romain' }) };
    const ok = await take(b, body, { transcript: null }).finally(() => ((env as { AI: unknown }).AI = ai));
    expect(ok.body.verdict).toBe('ok');
    expect(input).toMatchObject({ language: 'fr', task: 'transcribe', vad_filter: true });
    expect(atob(input.audio).length).toBe(body.length);
    expect((await rows("SELECT karaoke_n FROM daily"))[0].karaoke_n).toBe(1);
    const log = JSON.parse((await rows("SELECT data FROM activity WHERE kind = 'karaoke-take'"))[0].data);
    expect(log).toMatchObject({ verdict: 'ok', transcript: 'un monde romain', words: [], offsetMs: 0, durationMs: 3000, bytes: body.length });
    expect(typeof log.whisperMs).toBe('number');
  });

  it('a body over the size cap without a content-length (sent in pieces) is refused when read', async () => {
    const b = await kid();
    const big = new Uint8Array(KARAOKE_MAX_BYTES + 1000);
    big.set(wav(1).subarray(0, 44));
    const stream = new ReadableStream<Uint8Array>({
      start(ctrl) {
        for (let i = 0; i < big.length; i += 100_000) ctrl.enqueue(big.subarray(i, i + 100_000));
        ctrl.close();
      },
    });
    const headers: Record<string, string> = { 'x-test-now': b.now, 'cf-connecting-ip': b.ip, cookie: [...b.cookies].map(([k, v]) => `${k}=${v}`).join('; '), 'content-type': 'audio/wav', 'x-test-transcript': 'la' };
    const req = new Request(`${b.origin}/api/karaoke/${LONG.id}/take?offset=0`, { method: 'POST', headers, body: stream, duplex: 'half' } as RequestInit);
    expect(req.headers.get('content-length')).toBeNull();
    const res = await exports.default.fetch(req);
    expect(res.status).toBe(413);
    expect(((await res.json()) as { error: string }).error).toBe('too-big');
    expect(await rows('SELECT id FROM recordings')).toEqual([]);
  });

  it('debug=1 shows what Whisper heard only locally or to the admin', async () => {
    const b = await kid();
    const plain = await b.json('POST', `/api/karaoke/${SONG}/take?offset=0&debug=1`, wav(2), heard('la la merde'));
    expect(plain.body.verdict).toBe('refused');
    expect(plain.body.debug).toBeUndefined();
    expect(JSON.stringify(plain.body)).not.toContain('merde');
    // Locally (LOCAL_DEV on a localhost address) it does.
    (env as { LOCAL_DEV?: string }).LOCAL_DEV = '1';
    try {
      const local = new Browser();
      local.origin = 'http://localhost';
      await local.start();
      const dbg = await local.json('POST', `/api/karaoke/${SONG}/take?offset=0&debug=1`, wav(2), heard('la la merde'));
      expect(dbg.body.debug).toMatchObject({ transcript: 'la la merde', words: ['merde'] });
    } finally {
      delete (env as { LOCAL_DEV?: string }).LOCAL_DEV;
    }
  });

  it('Whisper is time-boxed (KARAOKE_WHISPER_TIMEOUT_MS, under the client’s 45 s)', async () => {
    expect(KARAOKE_WHISPER_TIMEOUT_MS).toBeLessThan(45_000);
    await expect(timeBox(new Promise(() => {}), 30)).rejects.toThrow('timeout');
    await expect(timeBox(Promise.resolve('heard'), 30)).resolves.toBe('heard');
    // A time-out is Whisper failing: 503, as the route answers when transcribe() rejects.
    const b = await kid();
    const ai = env.AI;
    (env as { AI: unknown }).AI = { run: async () => Promise.reject(new Error('timeout')) };
    const r = await take(b, wav(2), { transcript: null }).finally(() => ((env as { AI: unknown }).AI = ai));
    expect([r.status, r.body.error]).toEqual([503, 'speech-unavailable']);
  });

  it('keeping a take the daily job removed meanwhile leaves the older recording as it was', async () => {
    const b = await kid();
    const old = (await take(b, wav(2, { seed: 1 }))).body.take as KaraokeTake;
    await b.ok('POST', `/api/karaoke/${SONG}/save`, { takeId: old.id });
    const t = (await take(b, wav(2, { seed: 2 }))).body.take as KaraokeTake;
    // The batch the save writes, run as if the purge had removed the take after the save read it.
    await db().prepare('DELETE FROM recordings WHERE id = ?').bind(t.id).run();
    const u = (await db().prepare('SELECT id FROM users').first<{ id: string }>())!.id;
    const batch = [
      db().prepare(`UPDATE users SET rev = rev WHERE id = ? AND (CASE WHEN EXISTS (SELECT 1 FROM recordings WHERE user_id = ? AND song_id = ? AND saved = 0 AND id = ? AND part = 0) THEN 1 ELSE json('stale') END)`).bind(u, u, SONG, t.id),
      db().prepare('DELETE FROM recordings WHERE user_id = ? AND song_id = ? AND saved = 1').bind(u, SONG),
      db().prepare('UPDATE recordings SET saved = 1 WHERE user_id = ? AND song_id = ? AND saved = 0 AND id = ?').bind(u, SONG, t.id),
    ];
    await expect(db().batch(batch)).rejects.toThrow(/malformed JSON/);
    expect(await rows('SELECT DISTINCT id, saved FROM recordings')).toEqual([{ id: old.id, saved: 1 }]);
    // Through the route: no take, so 409, and the older recording plays on.
    expect((await b.json('POST', `/api/karaoke/${SONG}/save`, { takeId: t.id })).body.error).toBe('no-take');
    expect((await b.ok('GET', '/api/me')).state.recordings[SONG].id).toBe(old.id);
  });

  it('save without a checked take, or with another id: 409 no-take', async () => {
    const b = await kid();
    expect((await b.json('POST', `/api/karaoke/${SONG}/save`, { takeId: 'k_nothing' })).body.error).toBe('no-take');
    await take(b, wav(2));
    expect((await b.json('POST', `/api/karaoke/${SONG}/save`, { takeId: 'k_another' })).body.error).toBe('no-take');
    expect((await b.json('POST', `/api/karaoke/${SONG}/save`, {})).body.error).toBe('no-take');
  });
});

describe('around', () => {
  it('the daily job deletes unsaved takes after a day and keeps recordings', async () => {
    const b = await kid();
    const rec = (await take(b, wav(2))).body.take as KaraokeTake;
    await b.ok('POST', `/api/karaoke/${SONG}/save`, { takeId: rec.id });
    const t = (await take(b, wav(2, { seed: 5 }))).body.take as KaraokeTake;
    const now = Date.parse(b.now) + TAKE_KEEP_MS + 60_000;
    const ctx = createExecutionContext();
    await worker.scheduled(createScheduledController({ scheduledTime: now, cron: '17 4 * * *' }), env, ctx);
    await waitOnExecutionContext(ctx);
    expect(await rows('SELECT DISTINCT id FROM recordings')).toEqual([{ id: rec.id }]);
    expect((await b.json('POST', `/api/karaoke/${SONG}/save`, { takeId: t.id })).status).toBe(409);
  });

  it('an account with a recording is kept when its kid switches player; its rows go with a deleted account', async () => {
    const b = await kid();
    const rec = (await take(b, wav(2))).body.take as KaraokeTake;
    await b.ok('POST', `/api/karaoke/${SONG}/save`, { takeId: rec.id });
    expect((await b.ok('POST', '/api/logout')).deleted).toBe(false);
    // An empty account with only an unsaved take is deleted, its take with it.
    const c = await kid();
    await take(c, wav(2, { seed: 8 }));
    expect((await c.ok('POST', '/api/logout')).deleted).toBe(true);
    expect(await rows('SELECT DISTINCT id FROM recordings')).toEqual([{ id: rec.id }]);
  });

  it('wavFormat reads the format of the WAV the recorder makes', () => {
    expect(wavFormat(wav(1).buffer as ArrayBuffer)).toEqual({ format: 1, channels: 1, rate: 16000, bits: 16, dataBytes: 32000 });
    expect(wavFormat(new ArrayBuffer(10))).toBeNull();
  });
});
