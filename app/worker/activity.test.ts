// The activity log and the kids' problem reports (worker/activity.ts): POST /api/log, POST /api/reports,
// what the Worker logs itself (speech, 5xx, practices), and the daily purge.
import { createExecutionContext, createScheduledController, env, waitOnExecutionContext } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { ACTIVITY_KEEP_DAYS, LOG_MAX_DATA_CHARS, LOG_MAX_EVENTS, REPORT_MAX_CONTEXT_CHARS, REPORT_MAX_TEXT, REPORTS_PER_HOUR } from '../shared/activity';
import { FIXTURE_SCENE } from '../shared/fixtures';
import worker from './index';
import { Browser, db, freshWorld, unlockSome } from './testing';

beforeEach(freshWorld);

interface Row {
  id: number;
  user_id: string | null;
  at: number;
  day: string;
  build: string | null;
  session_id: string | null;
  kind: string;
  route: string | null;
  data: string;
}

async function rows(kind?: string): Promise<(Row & { d: any })[]> {
  const r = kind ? await db().prepare('SELECT * FROM activity WHERE kind = ? ORDER BY id').bind(kind).all<Row>() : await db().prepare('SELECT * FROM activity ORDER BY id').all<Row>();
  return r.results.map((x) => ({ ...x, d: JSON.parse(x.data) }));
}

const ev = (kind: string, at: number, data: Record<string, unknown> = {}) => ({ kind, at, route: '/practice/p_x', data });

describe('POST /api/log', () => {
  it('stores a batch of known kinds for the kid, in their day, and ignores unknown kinds', async () => {
    const b = new Browser();
    const st = await b.start();
    await db().prepare('DELETE FROM activity').run(); // the day's quests were built (quests-built)
    const at = Date.parse(b.now);
    const r = await b.fetch('POST', '/api/log', {
      tab: 'tab123',
      build: '20261201T120000Z-abc1234',
      sentAt: at,
      events: [ev('route', at - 2000), ev('made-up-kind', at - 1000), ev('puzzle-done', at - 500, { type: 'match', mistakes: 1 })],
    });
    expect(r.status).toBe(204);
    const got = await rows();
    expect(got.map((x) => x.kind)).toEqual(['route', 'puzzle-done']);
    expect(got[0]).toMatchObject({ user_id: st.profile.id, session_id: 'tab123', build: '20261201T120000Z-abc1234', route: '/practice/p_x', at: at - 2000, day: '2026-11-13' });
    expect(got[1]!.d).toEqual({ type: 'match', mistakes: 1 });
  });

  it('moves times by the client clock’s difference, and keeps them within the last week', async () => {
    const b = new Browser();
    await b.start();
    await db().prepare('DELETE FROM activity').run(); // the day's quests were built (quests-built)
    const now = Date.parse(b.now);
    const off = now - 3 * 3_600_000; // the device is three hours behind
    await b.fetch('POST', '/api/log', { sentAt: off, events: [ev('route', off - 1000), ev('route', off - 30 * 86_400_000), ev('route', now + 86_400_000)] });
    const ats = (await rows()).map((x) => x.at);
    expect(ats[0]).toBe(now - 1000);
    expect(ats[1]).toBe(now); // a month old: now
    expect(ats[2]).toBe(now); // in the future even after the move: now
  });

  it('works without a session (user null), caps the count and each event’s data, refuses what is too big', async () => {
    const b = await new Browser().enter();
    const at = Date.parse(b.now);
    const many = Array.from({ length: LOG_MAX_EVENTS + 10 }, (_, i) => ev('route', at - i));
    many[0] = ev('crash', at, { message: 'x'.repeat(LOG_MAX_DATA_CHARS + 10) });
    expect((await b.fetch('POST', '/api/log', { events: many })).status).toBe(204);
    const got = await rows();
    expect(got).toHaveLength(LOG_MAX_EVENTS);
    expect(got.every((x) => x.user_id === null)).toBe(true);
    expect(got[0]!.d).toMatchObject({ truncated: true });
    expect((await b.fetch('POST', '/api/log', 'x'.repeat(70_000), { 'content-type': 'application/json' })).status).toBe(413);
    expect((await b.fetch('POST', '/api/log', 'not json', { 'content-type': 'application/json' })).status).toBe(400);
    // Behind the gate like everything else.
    expect((await new Browser().fetch('POST', '/api/log', { events: [] })).status).toBe(401);
  });
});

describe('POST /api/reports', () => {
  it('stores the text, the context, the route, the build and the user agent, and answers the id', async () => {
    const b = new Browser();
    const st = await b.start();
    const context = { practiceId: 'p_1', puzzle: { index: 3, type: 'say-chain', id: 'z3' }, events: [{ kind: 'route' }] };
    const r1 = await b.json('POST', '/api/reports', { text: '  ça bloque  ', route: '/practice/p_1', context }, { 'x-frx-build': '20261201T120000Z-abc1234', 'user-agent': 'Kid iPad' });
    expect(r1.status).toBe(200);
    const r2 = await b.json('POST', '/api/reports', { text: '', route: '/', context: {} });
    expect(r2.body.id).toBe(r1.body.id + 1);
    const row = await db().prepare('SELECT * FROM reports WHERE id = ?').bind(r1.body.id).first<any>();
    expect(row).toMatchObject({ user_id: st.profile.id, text: 'ça bloque', route: '/practice/p_1', build: '20261201T120000Z-abc1234', user_agent: 'Kid iPad', at: Date.parse(b.now) });
    expect(JSON.parse(row.context)).toEqual(context);
  });

  it('caps the text and the context, works without a session, and limits a kid to a few an hour', async () => {
    const anon = await new Browser().enter();
    const big = { blob: 'y'.repeat(REPORT_MAX_CONTEXT_CHARS + 100) };
    const r = await anon.json('POST', '/api/reports', { text: 'z'.repeat(REPORT_MAX_TEXT + 50), route: '/', context: big });
    expect(r.status).toBe(200);
    const row = await db().prepare('SELECT * FROM reports WHERE id = ?').bind(r.body.id).first<any>();
    expect(row.user_id).toBeNull();
    expect(row.text).toHaveLength(REPORT_MAX_TEXT);
    const ctx = JSON.parse(row.context);
    expect(ctx.truncated).toBe(true);
    expect(row.context.length).toBeLessThanOrEqual(REPORT_MAX_CONTEXT_CHARS);

    const b = new Browser();
    await b.start();
    for (let i = 0; i < REPORTS_PER_HOUR; i++) expect((await b.json('POST', '/api/reports', { text: `n${i}`, route: '/', context: {} })).status).toBe(200);
    const over = await b.json('POST', '/api/reports', { text: 'again', route: '/', context: {} });
    expect(over.status).toBe(429);
    expect(over.body.error).toBe('rate-limited');
    b.now = '2026-11-13T16:30:00Z'; // an hour and a half later
    expect((await b.json('POST', '/api/reports', { text: 'later', route: '/', context: {} })).status).toBe(200);
  });
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

describe('what the Worker logs itself', () => {
  it('every speech attempt: the puzzle type, what was expected, what was heard, the verdict and who decided', async () => {
    const b = new Browser();
    await b.start();
    const id = (await unlockSome(b, 1))[0]!;
    const line = FIXTURE_SCENE.lines[0]!;
    const r = await b.json('POST', `/api/speech?scene=${id}&line=${line.id}&attempt=2&type=say-line`, wav(2), { 'content-type': 'audio/wav', 'x-test-transcript': encodeURIComponent(line.fr), 'x-frx-tab': 'tabA' });
    expect(r.status).toBe(200);
    const [row, ...more] = await rows('speech');
    expect(more).toHaveLength(0);
    expect(row!.session_id).toBe('tabA');
    expect(row!.route).toBe('/api/speech');
    expect(row!.d).toMatchObject({ type: 'say-line', scene: id, target: 'line', ref: line.id, attempt: 2, expected: [line.fr], transcript: line.fr, pass: true, by: 'scorer' });
    expect(typeof row!.d.score).toBe('number');
    expect(typeof row!.d.totalMs).toBe('number');
  });

  it('every 5xx it answers: here Whisper failing answers 503 speech-unavailable', async () => {
    const b = new Browser();
    const st = await b.start();
    const id = (await unlockSome(b, 1))[0]!;
    const ai = env.AI;
    (env as { AI: unknown }).AI = { run: async () => Promise.reject(new Error('test: whisper down')) };
    const r = await b.json('POST', `/api/speech?scene=${id}&line=${FIXTURE_SCENE.lines[0]!.id}`, wav(1), { 'content-type': 'audio/wav' }).finally(() => {
      (env as { AI: unknown }).AI = ai;
    });
    expect(r.status).toBe(503);
    const got = await rows('server-error');
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ user_id: st.profile.id, route: '/api/speech' });
    expect(got[0]!.d).toMatchObject({ status: 503, code: 'speech-unavailable', method: 'POST', path: '/api/speech' });
    expect(await rows('speech')).toHaveLength(0);
    // A 4xx is not an error of the server's: not logged.
    await b.json('POST', '/api/practices/nope/progress', { done: 1, outcomes: [] });
    expect(await rows('server-error')).toHaveLength(1);
  });

  it('practice start, progress and completion', async () => {
    const b = new Browser();
    await b.start();
    const [sceneId] = await unlockSome(b, 1);
    const { plan } = await b.ok('POST', '/api/practices/start', { kind: 'scene', sceneId });
    const o = (n: number) => ({ puzzleId: `t${n}`, type: 'match', sceneId: plan.sceneId, unitIds: [], missedUnitIds: [], mistakes: 0, hints: 0, skipped: false, ms: 1000 });
    await b.ok('POST', `/api/practices/${plan.id}/progress`, { done: 1, total: 2, outcomes: [o(1)] });
    await b.ok('POST', `/api/practices/${plan.id}/complete`, { outcomes: [o(1), o(2)], ms: 42_000 });
    // The day's quests were built at the first visit; the bronze practice did its quest and made a light streak day.
    expect((await rows()).map((x) => x.kind)).toEqual(['quests-built', 'practice-start', 'practice-progress', 'streak', 'quest-done', 'practice-complete']);
    const [built, start, progress, streak, quest, complete] = await rows();
    expect(built!.d.quests.map((q: any) => q.kind)).toEqual(['choose', 'practice', 'practice', 'practice']);
    expect(start!.d).toMatchObject({ practiceId: plan.id, kind: 'scene', sceneId, level: 1, replay: false });
    expect(progress!.d).toMatchObject({ practiceId: plan.id, done: 1, total: 2, fresh: 1 });
    expect(streak!.d).toMatchObject({ kind: 'light', count: 1 });
    expect(quest!.d).toMatchObject({ index: 1, kind: 'practice', sceneId, level: 1, round: 0, chest: 'wood' });
    expect(complete!.d).toMatchObject({ practiceId: plan.id, sceneId, level: 1, replay: false, done: 2, ms: 42_000, quest: 1 });
    // A refused call writes nothing (the event is in the request's batch).
    await b.json('POST', `/api/practices/${plan.id}/complete`, { outcomes: [], ms: 1 });
    expect(await rows('practice-complete')).toHaveLength(1);
  });
});

describe('the daily purge', () => {
  it('deletes activity older than 180 days and keeps reports', async () => {
    const now = Date.parse('2026-11-13T04:17:00Z');
    const day = 86_400_000;
    for (const age of [ACTIVITY_KEEP_DAYS + 1, ACTIVITY_KEEP_DAYS - 1, 0]) {
      await db().prepare("INSERT INTO activity (user_id, at, day, kind, data) VALUES ('u_x', ?, '2026-01-01', 'route', '{}')").bind(now - age * day).run();
    }
    await db().prepare("INSERT INTO reports (user_id, at, text) VALUES ('u_x', ?, 'old')").bind(now - 400 * day).run();
    const ctx = createExecutionContext();
    await worker.scheduled(createScheduledController({ scheduledTime: now, cron: '17 4 * * *' }), env, ctx);
    await waitOnExecutionContext(ctx);
    const left = (await rows()).map((x) => Math.round((now - x.at) / day));
    expect(left).toEqual([ACTIVITY_KEEP_DAYS - 1, 0]);
    expect((await db().prepare('SELECT COUNT(*) AS n FROM reports').first<{ n: number }>())!.n).toBe(1);
  });
});
