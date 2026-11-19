// Karaoke recordings (docs/app-server.md, "Karaoke recordings"): a kid records their singing over one
// of the karaoke songs; the take is checked (Whisper, then rude words only: shared/karaoke.ts), heard,
// then saved or dropped; the saved recording plays over the song wherever this kid hears it.
//   POST   /api/karaoke/:song/take?offset=<ms>   WAV  ->  { verdict, take }
//   POST   /api/karaoke/:song/save               { takeId }  ->  { recording }
//   DELETE /api/karaoke/:song/take               204
//   DELETE /api/karaoke/:song/recording          { patch }
//   GET    /api/karaoke/audio/<id>.wav           the kid's own saved recording, nobody else's
// Storage is D1 (the table `recordings`, migration 0003): one row per chunk of the WAV, base64. Only a
// take that passed the check is ever written; refused audio is dropped with the request.
import { Hono } from 'hono';
import type { KaraokeRecording, KaraokeRemoveResponse, KaraokeSaveRequest, KaraokeSaveResponse, KaraokeTake, KaraokeTakeResponse } from '../shared/api';
import { KARAOKE_MAX_BYTES, KARAOKE_MIN_MS, KARAOKE_RATE, KARAOKE_SLACK_MS, KARAOKE_TAKES_PER_DAY, checkTake } from '../shared/karaoke';
import { SPEECH_HINT } from '../shared/speech';
import { logTx } from './activity';
import { isAdmin } from './admin';
import { getContent, getSong } from './content';
import { ensureDaily } from './daily';
import type { AppEnv, Env } from './env';
import { runTx } from './session';
import { safeDecode, transcribe } from './speech';
import type { UserTx } from './tx';
import { fail, jsonBody, randomId, testMode } from './util';

/** WAV bytes per row: 900,000 characters of base64, under D1's 2,000,000-byte row with room to spare. */
export const KARAOKE_CHUNK_BYTES = 675_000;
/** An unsaved take is deleted by the daily job once it is this old (so it lives up to about two days). */
export const TAKE_KEEP_MS = 86_400_000;
/** Whisper on a take gets this long, well under the client's KARAOKE_TAKE_TIMEOUT_MS (45 s); measured 5 to 8 s for 54 s of audio. */
export const KARAOKE_WHISPER_TIMEOUT_MS = 25_000;

/** `p`, or a rejection with 'timeout' after `ms`. */
export async function timeBox<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([p, new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error('timeout')), ms)))]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export interface WavFormat {
  format: number; // 1 = PCM
  channels: number;
  rate: number;
  bits: number;
  dataBytes: number;
}

/** The format of a RIFF WAV, or null when it is not one. */
export function wavFormat(buf: ArrayBuffer): WavFormat | null {
  if (buf.byteLength < 44) return null;
  const v = new DataView(buf);
  const tag = (o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;
  let fmt: Omit<WavFormat, 'dataBytes'> | null = null;
  for (let o = 12; o + 8 <= buf.byteLength; ) {
    const id = tag(o);
    const size = v.getUint32(o + 4, true);
    if (id === 'fmt ' && o + 24 <= buf.byteLength) fmt = { format: v.getUint16(o + 8, true), channels: v.getUint16(o + 10, true), rate: v.getUint32(o + 12, true), bits: v.getUint16(o + 22, true) };
    if (id === 'data') return fmt ? { ...fmt, dataBytes: Math.min(size, buf.byteLength - o - 8) } : null;
    o += 8 + size + (size % 2);
  }
  return null;
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const audioUrl = (id: string) => `/api/karaoke/audio/${id}.wav`;

interface RecordingRow {
  id: string;
  song_id: string;
  offset_ms: number;
  duration_ms: number;
}

const toRecording = (r: RecordingRow): KaraokeRecording => ({ id: r.id, songId: r.song_id, offsetMs: r.offset_ms, durationMs: r.duration_ms, url: audioUrl(r.id) });

/** The kid's saved recordings, by song (PlayerState.recordings). */
export async function recordingsOf(db: D1Database, userId: string): Promise<Record<string, KaraokeRecording>> {
  const r = await db.prepare('SELECT id, song_id, offset_ms, duration_ms FROM recordings WHERE user_id = ? AND saved = 1 AND part = 0').bind(userId).all<RecordingRow>();
  return Object.fromEntries((r.results ?? []).map((row) => [row.song_id, toRecording(row)]));
}

/** The daily job: unsaved takes older than TAKE_KEEP_MS go. Returns how many rows went. */
export async function purgeTakes(env: Env, now: number): Promise<number> {
  const r = await env.DB.prepare('DELETE FROM recordings WHERE saved = 0 AND created_at < ?').bind(now - TAKE_KEEP_MS).run();
  return r.meta.changes ?? 0;
}

/** Queue the take's chunks in the request's batch, replacing the song's earlier unsaved take. */
function storeTake(tx: UserTx, songId: string, wav: ArrayBuffer, offsetMs: number, durationMs: number): KaraokeTake {
  const id = randomId('k', 16);
  const bytes = new Uint8Array(wav);
  const parts = Math.max(1, Math.ceil(bytes.length / KARAOKE_CHUNK_BYTES));
  tx.stmt('DELETE FROM recordings WHERE user_id = ? AND song_id = ? AND saved = 0', tx.id, songId);
  for (let i = 0; i < parts; i++) {
    tx.stmt(
      'INSERT INTO recordings (id, user_id, song_id, saved, part, parts, offset_ms, duration_ms, bytes, created_at, data) VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)',
      id, tx.id, songId, i, parts, offsetMs, durationMs, bytes.length, tx.nowMs, toBase64(bytes.subarray(i * KARAOKE_CHUNK_BYTES, (i + 1) * KARAOKE_CHUNK_BYTES)),
    );
  }
  return { id, songId, offsetMs, durationMs }; // no URL: the audio is served once kept
}

export const karaokeRoutes = new Hono<AppEnv>();

karaokeRoutes.post('/karaoke/:song/take', async (c) => {
  const t0 = Date.now();
  const song = await getSong(c.env, c.req.param('song'));
  if (!song) return fail(404, 'not-found', 'song');
  if (Number(c.req.header('content-length') ?? 0) > KARAOKE_MAX_BYTES) return fail(413, 'too-big', 'too big');
  const offsetMs = Math.round(Number(c.req.query('offset') ?? 0));
  if (!Number.isFinite(offsetMs) || offsetMs < 0 || offsetMs > song.audio.durationMs) return fail(400, 'bad-request', 'offset');
  const debug = c.req.query('debug') === '1' && (await isAdmin(c));
  // The day's cap comes before Whisper is asked (a read; the take is counted when its check is written).
  await runTx(c, async (tx) => {
    if ((await tx.daily()).karaoke_n >= KARAOKE_TAKES_PER_DAY) fail(429, 'rate-limited', 'karaoke takes per day');
  });

  const wav = await c.req.arrayBuffer();
  if (wav.byteLength > KARAOKE_MAX_BYTES) return fail(413, 'too-big', 'too big');
  const f = wavFormat(wav);
  if (!f || f.format !== 1 || f.channels !== 1 || f.rate !== KARAOKE_RATE || f.bits !== 16) return fail(400, 'bad-request', 'expected a WAV, 16 kHz mono 16-bit');
  const durationMs = Math.round((f.dataBytes / (KARAOKE_RATE * 2)) * 1000);
  if (durationMs < KARAOKE_MIN_MS) return fail(400, 'bad-request', 'too short');
  if (offsetMs + durationMs > song.audio.durationMs + KARAOKE_SLACK_MS) return fail(413, 'too-big', 'longer than the song');

  // Whisper (the model and settings of POST /api/speech, hinted with the show's names only: the check
  // is about rude words, and a hint of the lyrics would pull what was heard towards them).
  let raw: string;
  const w0 = Date.now();
  const fake = testMode(c.env) ? c.req.header('x-test-transcript') : undefined;
  if (fake !== undefined) raw = safeDecode(fake);
  else {
    try {
      raw = await timeBox(transcribe(c.env, wav, SPEECH_HINT), KARAOKE_WHISPER_TIMEOUT_MS);
    } catch (e) {
      console.error('whisper failed (karaoke)', e);
      return fail(503, 'speech-unavailable', String((e as Error)?.message ?? e).slice(0, 100));
    }
  }
  const whisperMs = Date.now() - w0;
  const transcript = raw.trim();
  const check = checkTake(transcript, song.lines.map((l) => l.fr));
  const content = await getContent(c.env);

  return runTx(c, async (tx) => {
    const d = await ensureDaily(tx, content);
    if (d.karaoke_n >= KARAOKE_TAKES_PER_DAY) return fail(429, 'rate-limited', 'karaoke takes per day');
    d.karaoke_n++;
    tx.saveDaily();
    const take = check.ok ? storeTake(tx, song.id, wav, offsetMs, durationMs) : null;
    const verdict = check.ok ? 'ok' : 'refused';
    const totalMs = Date.now() - t0;
    logTx(tx, c, 'karaoke-take', { songId: song.id, verdict, words: check.words, transcript: transcript.slice(0, 1000), offsetMs, durationMs, bytes: wav.byteLength, takeId: take?.id ?? null, whisperMs, totalMs });
    await tx.commit();
    console.log(JSON.stringify({ karaoke: { song: song.id, verdict, words: check.words.length, offsetMs, durationMs, bytes: wav.byteLength, whisperMs, totalMs } }));
    const res: KaraokeTakeResponse = { verdict, take, patch: tx.patch };
    if (debug) res.debug = { transcript, ms: whisperMs, words: check.words };
    return c.json(res);
  });
});

karaokeRoutes.post('/karaoke/:song/save', async (c) => {
  const songId = c.req.param('song');
  const body = await jsonBody<Partial<KaraokeSaveRequest>>(c);
  const takeId = typeof body.takeId === 'string' ? body.takeId : '';
  return runTx(c, async (tx) => {
    const rows = await tx.db
      .prepare('SELECT id, song_id, offset_ms, duration_ms, saved FROM recordings WHERE user_id = ? AND song_id = ? AND part = 0')
      .bind(tx.id, songId)
      .all<RecordingRow & { saved: number }>();
    const row = (rows.results ?? []).find((r) => r.id === takeId);
    if (!row) return fail(409, 'no-take');
    // Kept already: the answer to an earlier tap was lost on the way. Kept it stays.
    if (row.saved === 1) {
      const recording = toRecording(row);
      return c.json<KaraokeSaveResponse>({ recording, patch: { recordings: { [songId]: recording }, today: tx.today } });
    }
    // One batch: the take is still there (the daily purge may have removed it since it was read: then
    // the batch fails, and the request is read again), the older recording goes, the take becomes the recording.
    tx.stmt(
      `UPDATE users SET rev = rev WHERE id = ? AND (CASE WHEN EXISTS (SELECT 1 FROM recordings WHERE user_id = ? AND song_id = ? AND saved = 0 AND id = ? AND part = 0) THEN 1 ELSE json('stale') END)`,
      tx.id, tx.id, songId, takeId,
    );
    tx.stmt('DELETE FROM recordings WHERE user_id = ? AND song_id = ? AND saved = 1', tx.id, songId);
    tx.stmt('UPDATE recordings SET saved = 1 WHERE user_id = ? AND song_id = ? AND saved = 0 AND id = ?', tx.id, songId, takeId);
    await tx.commit();
    const recording = toRecording(row);
    tx.patch.recordings = { [songId]: recording };
    return c.json<KaraokeSaveResponse>({ recording, patch: tx.patch });
  });
});

karaokeRoutes.delete('/karaoke/:song/take', async (c) =>
  runTx(c, async (tx) => {
    tx.stmt('DELETE FROM recordings WHERE user_id = ? AND song_id = ? AND saved = 0', tx.id, c.req.param('song'));
    await tx.commit();
    return c.body(null, 204);
  }),
);

karaokeRoutes.delete('/karaoke/:song/recording', async (c) => {
  const songId = c.req.param('song');
  return runTx(c, async (tx) => {
    tx.stmt('DELETE FROM recordings WHERE user_id = ? AND song_id = ? AND saved = 1', tx.id, songId);
    await tx.commit();
    tx.patch.recordings = { [songId]: null };
    return c.json<KaraokeRemoveResponse>({ patch: tx.patch });
  });
});

karaokeRoutes.get('/karaoke/audio/:file', async (c) => {
  const m = /^(k_[a-z0-9]{6,40})\.wav$/.exec(c.req.param('file'));
  if (!m) return fail(404, 'not-found', 'recording');
  const id = m[1]!;
  const userId = c.get('userId');
  const db = c.env.DB;
  const own = await db.prepare('SELECT parts, bytes FROM recordings WHERE id = ? AND part = 0 AND user_id = ? AND saved = 1').bind(id, userId).first<{ parts: number; bytes: number }>();
  if (!own) return fail(404, 'not-found', 'recording');
  // The browser keeps the file, but asks every time: the owner is checked on every load (a removed
  // recording, another kid on a shared device: 404), and an unchanged one costs a 304 and no audio read.
  // The id is the ETag: a recording never changes under its id.
  const headers = { etag: `"${id}"`, 'cache-control': 'private, no-cache' };
  if ((c.req.header('if-none-match') ?? '').includes(`"${id}"`)) return new Response(null, { status: 304, headers });
  const out = new Uint8Array(own.bytes);
  let o = 0;
  // Chunk by chunk: each answer from D1 stays under a megabyte.
  for (let i = 0; i < own.parts; i++) {
    const row = await db.prepare('SELECT data FROM recordings WHERE id = ? AND part = ? AND user_id = ? AND saved = 1').bind(id, i, userId).first<{ data: string }>();
    if (!row) return fail(404, 'not-found', 'recording');
    const b = fromBase64(row.data);
    if (o + b.length > out.length) return fail(500, 'internal', 'recording size');
    out.set(b, o);
    o += b.length;
  }
  if (o !== out.length) return fail(500, 'internal', 'recording size');
  return new Response(out, { headers: { ...headers, 'content-type': 'audio/wav', 'content-length': String(out.length) } });
});
