// Daily quests: how the day's quests are built, the lock on choosing, "Do more", credit under retries,
// light and full streaks, the 03:00 day boundary and the time zone set once.
import { beforeEach, describe, expect, it } from 'vitest';
import { FIXTURE_INDEX } from '../shared/fixtures';
import { DAILY_CANDIDATES, DAILY_UNLOCKS, SESTERCES, XP, addDays } from '../shared/rules';
import { Browser, db, freshWorld, playPractice, unlockSome } from './testing';

beforeEach(freshWorld);

const DAY = '2026-11-13';
const ALL = FIXTURE_INDEX.scenes.map((s) => s.id);

async function kid() {
  const b = new Browser();
  const s = await b.start();
  return { b, s, id: s.profile.id as string };
}

/** Unlocked scenes written straight into D1 (the next day's quests see them). */
async function seed(userId: string, rows: { sceneId: string; level: number; dueDay: string | null; unlockedDay?: string }[]) {
  for (const r of rows)
    await db()
      .prepare('INSERT INTO scene_progress (user_id, scene_id, level, due_day, passes, unlocked_day, last_pass_day) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(userId, r.sceneId, r.level, r.dueDay, r.level, r.unlockedDay ?? '2026-10-01', r.level ? '2026-10-01' : null)
      .run();
}

const me = async (b: Browser) => (await b.ok('GET', '/api/me')).state;
const shape = (st: any) => st.daily.quests.map((q: any) => (q.kind === 'choose' ? 'choose' : `${q.reason}:${q.level}:${q.sceneId ?? '-'}`));
const pass = (b: Browser, sceneId: string) => playPractice(b, { kind: 'scene', sceneId });
/** Not among the given ids (scenes to seed that are not today's candidates). */
const others = (st: any, n: number) => ALL.filter((id) => !st.daily.candidates.some((c: any) => c.sceneId === id)).slice(0, n);

describe('building the day’s quests', () => {
  it('a new kid: choose 3 of the candidates, then three bronze places; chests by order', async () => {
    const { s } = await kid();
    expect(shape(s)).toEqual(['choose', 'new:1:-', 'new:1:-', 'new:1:-']);
    expect(s.daily.quests.map((q: any) => q.chest)).toEqual(['wood', 'wood', 'silver', 'gold']);
    expect(s.daily.quests[0]).toMatchObject({ index: 0, round: 0, extra: false, done: false, chosen: 0, target: DAILY_UNLOCKS, locked: false, waitingFor: [] });
    expect(s.daily).toMatchObject({ round: 0, choose: 0, unlocksLeft: 3, questsDone: false, doMore: false });
    expect(s.daily.candidates).toHaveLength(DAILY_CANDIDATES);
  });

  it('one due: the due practice first, then choose and three places', async () => {
    const { b, s, id } = await kid();
    const [a] = others(s, 1);
    await seed(id, [{ sceneId: a!, level: 1, dueDay: addDays(DAY, 1) }]);
    b.at(addDays(DAY, 1));
    const st = await me(b);
    expect(shape(st)).toEqual([`due:2:${a}`, 'choose', 'new:1:-', 'new:1:-', 'new:1:-']);
    expect(st.daily.quests.map((q: any) => q.chest)).toEqual(['wood', 'wood', 'wood', 'silver', 'gold']);
  });

  it('six due after a long absence: never more than five, the three most overdue first, the choose quest always there', async () => {
    const { b, s, id } = await kid();
    const sc = others(s, 6);
    // Due 1, 3, 5, 7, 9, 11 days before the day the kid comes back.
    const back = addDays(DAY, 40);
    await seed(id, sc.map((sceneId, i) => ({ sceneId, level: 1 + (i % 3), dueDay: addDays(back, -(1 + 2 * i)) })));
    b.at(back);
    const st = await me(b);
    expect(st.daily.quests).toHaveLength(5);
    expect(shape(st)).toEqual([`due:4:${sc[5]}`, `due:3:${sc[4]}`, `due:2:${sc[3]}`, 'choose', 'new:1:-']);
    expect(st.daily.dueSceneIds).toHaveLength(6); // the others wait in the Episodes tab
    // The quests are built once: a later visit the same day finds the same ones.
    b.now = `${back}T22:00:00Z`;
    expect(shape(await me(b))).toEqual(shape(st));
  });

  it('a bronze practice started on an earlier day waits like a due one; a scene unlocked and never started does not', async () => {
    const { b } = await kid();
    const [x, y] = await unlockSome(b, 2);
    const { plan } = await b.ok('POST', '/api/practices/start', { kind: 'scene', sceneId: x });
    await b.ok('POST', `/api/practices/${plan.id}/progress`, { done: 4, total: 20, outcomes: [] });
    b.at(addDays(DAY, 1));
    const st = await me(b);
    expect(shape(st)).toEqual([`continue:1:${x}`, 'choose', 'new:1:-', 'new:1:-', 'new:1:-']);
    expect(st.daily.quests[0].practice).toEqual({ practiceId: plan.id, level: 1, replay: false, done: 4, total: 20 });
    expect(shape(st).join()).not.toContain(y);
  });

  it('every scene unlocked: no choose quest, the practices that wait take up to five places', async () => {
    const { b, id } = await kid();
    await seed(id, ALL.map((sceneId, i) => ({ sceneId, level: 2, dueDay: i < 7 ? addDays(DAY, 1) : '2027-01-01' })));
    b.at(addDays(DAY, 1));
    const st = await me(b);
    expect(st.daily.quests.map((q: any) => q.kind)).toEqual(['practice', 'practice', 'practice', 'practice', 'practice']);
    expect(st.daily).toMatchObject({ choose: null, candidates: [], unlocksLeft: 0, doMore: false });
  });
});

describe('choosing new scenes', () => {
  it('choose one, come back later the same day and choose two more: the third does the choose quest', async () => {
    const { b, s } = await kid();
    const c = s.daily.candidates.map((x: any) => x.sceneId);
    const r1 = await b.ok('POST', '/api/daily/unlock', { sceneId: c[0] });
    expect(r1.quest).toBeNull();
    expect(r1.patch.daily.quests[1].sceneId).toBe(c[0]); // the first place gets the scene
    // Later, from Home: the choose quest is still open, with the same candidates.
    b.now = `${DAY}T23:00:00Z`;
    const st = await me(b);
    expect(st.daily.quests[0]).toMatchObject({ kind: 'choose', done: false, chosen: 1, target: 3, locked: false });
    expect(st.daily.unlocksLeft).toBe(2);
    expect(st.daily.candidates.map((x: any) => [x.sceneId, x.unlocked])).toEqual(c.map((id: string, i: number) => [id, i === 0]));
    await b.ok('POST', '/api/daily/unlock', { sceneId: c[3] });
    const r3 = await b.ok('POST', '/api/daily/unlock', { sceneId: c[4] });
    expect(r3.quest).toMatchObject({ index: 0, chest: { kind: 'wood', source: 'quest' } });
    expect(r3.patch.chests.add).toEqual([r3.quest.chest]);
    expect(r3.patch.daily.quests[0]).toMatchObject({ done: true, chestId: r3.quest.chest.id, chosen: 3 });
    expect(r3.patch.daily.quests.slice(1).map((q: any) => q.sceneId)).toEqual([c[0], c[3], c[4]]);
    expect(r3.patch.daily.unlocksLeft).toBe(0);
    expect(r3.patch.currencies.xp).toBe(XP.quest);
    expect(r3.patch.currencies.sesterces).toBeGreaterThanOrEqual(SESTERCES.quest); // and what achievements gave
    expect(r3.patch.stats.questsDone).toBe(1);
    // The rest go back to the pool: no fourth.
    expect((await b.json('POST', '/api/daily/unlock', { sceneId: c[1] })).body.error).toBe('no-unlocks-left');
    expect((await b.json('POST', '/api/daily/unlock', { sceneId: c[0] })).body.error).toBe('already-unlocked');
  });

  it('unchosen candidates are gone the next day; the next day draws afresh', async () => {
    const { b, s } = await kid();
    const c = s.daily.candidates.map((x: any) => x.sceneId);
    await b.ok('POST', '/api/daily/unlock', { sceneId: c[0] });
    b.at(addDays(DAY, 1));
    const st = await me(b);
    const today = st.daily.candidates.map((x: any) => x.sceneId);
    expect(today).not.toContain(c[0]);
    expect(st.daily.quests.find((q: any) => q.kind === 'choose')).toMatchObject({ chosen: 0, done: false });
    const gone = c.slice(1).find((id: string) => !today.includes(id));
    if (gone) expect((await b.json('POST', '/api/daily/unlock', { sceneId: gone })).body.error).toBe('not-offered');
  });

  it('is locked while the practice quests before it are not passed, and opens after', async () => {
    const { b, s, id } = await kid();
    const [a, z] = others(s, 2);
    await seed(id, [
      { sceneId: a!, level: 1, dueDay: addDays(DAY, 1) },
      { sceneId: z!, level: 2, dueDay: addDays(DAY, 1) },
    ]);
    b.at(addDays(DAY, 1));
    const st = await me(b);
    const choose = st.daily.quests[st.daily.choose];
    expect(st.daily.choose).toBe(2);
    expect(choose).toMatchObject({ kind: 'choose', locked: true, waitingFor: [0, 1] });
    const cand = st.daily.candidates[0].sceneId;
    const refused = await b.json('POST', '/api/daily/unlock', { sceneId: cand });
    expect([refused.status, refused.body.error]).toEqual([409, 'choose-locked']);
    // Passing one is not enough; passing both opens it.
    const first = await pass(b, st.daily.quests[0].sceneId);
    expect(first.quest).toMatchObject({ index: 0 });
    expect(first.patch.daily.quests[2]).toMatchObject({ locked: true, waitingFor: [1] });
    const second = await pass(b, st.daily.quests[1].sceneId);
    expect(second.patch.daily.quests[2]).toMatchObject({ locked: false, waitingFor: [] });
    await b.ok('POST', '/api/daily/unlock', { sceneId: cand });
  });
});

describe('credit', () => {
  it('a quest is credited once, whatever is retried', async () => {
    const { b } = await kid();
    const [x] = await unlockSome(b, 1);
    const { plan } = await b.ok('POST', '/api/practices/start', { kind: 'scene', sceneId: x });
    const o = { puzzleId: 't1', type: 'match', sceneId: x, unitIds: [], missedUnitIds: [], mistakes: 0, hints: 0, skipped: false, ms: 1 };
    const p1 = await b.ok('POST', `/api/practices/${plan.id}/progress`, { done: 1, total: 2, outcomes: [o] });
    const p2 = await b.ok('POST', `/api/practices/${plan.id}/progress`, { done: 1, total: 2, outcomes: [o] });
    expect([p1.xp, p2.xp]).toEqual([XP.puzzle, 0]);
    expect(p1.patch.daily.quests[1].practice).toMatchObject({ practiceId: plan.id, done: 1, total: 2 });
    const rs = await Promise.all([1, 2, 3].map(() => b.json('POST', `/api/practices/${plan.id}/complete`, { outcomes: [o], ms: 1 })));
    expect(rs.map((r) => r.status).sort()).toEqual([200, 409, 409]);
    const ok = rs.find((r) => r.status === 200)!.body;
    expect(ok.quest).toMatchObject({ index: 1, chest: { kind: 'wood' } });
    expect(ok.chest).toEqual(ok.quest.chest);
    const st = await me(b);
    expect(st.daily.quests[1]).toMatchObject({ done: true, chestId: ok.quest.chest.id, practice: null });
    expect(st.chests).toHaveLength(1);
    expect(st.stats.questsDone).toBe(1);
    expect(st.practices).toEqual({});
  });
});

describe('streaks', () => {
  it('a practice makes a light day; every one of the day’s quests a full day', async () => {
    const { b, s } = await kid();
    const c = s.daily.candidates.map((x: any) => x.sceneId).slice(0, 3);
    for (const id of c) await b.ok('POST', '/api/daily/unlock', { sceneId: id });
    const r1 = await pass(b, c[0]);
    expect(r1.streak).toEqual({ count: 1, extended: true, freezesUsed: 0, reset: false, full: false });
    expect(r1.patch.streak).toMatchObject({ doneToday: true, fullToday: false });
    expect(r1.patch.streak.week.at(-1)).toEqual({ day: DAY, kind: 'light' });
    await pass(b, c[1]);
    const r3 = await pass(b, c[2]);
    expect(r3.streak).toMatchObject({ count: 1, extended: false, full: true });
    expect(r3.quest).toMatchObject({ index: 3, chest: { kind: 'gold' } });
    expect(r3.patch.streak).toMatchObject({ fullToday: true });
    expect(r3.patch.streak.week.at(-1)).toEqual({ day: DAY, kind: 'full' });
    expect(r3.patch.daily).toMatchObject({ questsDone: true, doMore: true });
    // A replay afterwards keeps the day full.
    const replay = await pass(b, c[0]);
    expect([replay.replay, replay.quest, replay.streak.full]).toEqual([true, null, false]);
    expect((await me(b)).streak.fullToday).toBe(true);
    // The next day starts with nothing; a missed day is saved by a potion as a light day.
    await db().prepare('UPDATE users SET potions = 1 WHERE id = ?').bind(s.profile.id).run();
    b.at(addDays(DAY, 2));
    const st = await me(b);
    expect(st.streak).toMatchObject({ count: 1, doneToday: false, fullToday: false });
    const r = await pass(b, c[0]); // its silver is due
    expect(r.streak).toMatchObject({ count: 2, freezesUsed: 1 });
    expect(r.patch.streak.week.slice(-3).map((x: any) => x.kind)).toEqual(['full', 'saved', 'light']);
  });
});

describe('Do more', () => {
  it('only once every quest is done; fresh candidates, extra quests, as often as the kid likes; tomorrow untouched', async () => {
    const { b, s } = await kid();
    expect((await b.json('POST', '/api/daily/more')).body.error).toBe('more-unavailable');
    const day0 = s.daily.candidates.map((x: any) => x.sceneId);
    for (const id of day0.slice(0, 3)) await b.ok('POST', '/api/daily/unlock', { sceneId: id });
    for (const id of day0.slice(0, 3)) await pass(b, id);
    const more = await b.ok('POST', '/api/daily/more');
    const d = more.daily;
    expect(d).toMatchObject({ round: 1, choose: 4, unlocksLeft: 3, questsDone: true, doMore: false });
    expect(d.quests.slice(4).map((q: any) => [q.kind, q.round, q.extra, q.chest, q.sceneId])).toEqual([
      ['choose', 1, true, 'wood', null],
      ['practice', 1, true, 'wood', null],
      ['practice', 1, true, 'wood', null],
      ['practice', 1, true, 'wood', null],
    ]);
    const fresh = d.candidates.map((x: any) => x.sceneId);
    expect(fresh).toHaveLength(DAILY_CANDIDATES);
    for (const id of fresh) expect(day0).not.toContain(id);
    expect(more.patch.daily).toEqual(d);
    // Not twice in a row: the extra quests are not done yet.
    expect((await b.json('POST', '/api/daily/more')).body.error).toBe('more-unavailable');
    for (const id of fresh.slice(0, 2)) await b.ok('POST', '/api/daily/unlock', { sceneId: id });
    const r = await pass(b, fresh[0]);
    expect(r.quest).toMatchObject({ index: 5, chest: { kind: 'wood' } });
    expect(r.streak.full).toBe(false); // already full
    await b.ok('POST', '/api/daily/unlock', { sceneId: fresh[2] });
    for (const id of [fresh[1], fresh[2]]) await pass(b, id);
    const st = await me(b);
    expect(st.daily.quests.every((q: any) => q.done)).toBe(true);
    expect(st.daily.doMore).toBe(true);
    expect((await b.ok('POST', '/api/daily/more')).daily.round).toBe(2);
    // Tomorrow: the day's quests only, built from the practices due then.
    b.at(addDays(DAY, 1));
    const next = await me(b);
    expect(next.daily.round).toBe(0);
    expect(next.daily.quests.every((q: any) => !q.extra && !q.done)).toBe(true);
    expect(shape(next).filter((x: string) => x.startsWith('due:'))).toHaveLength(3);
  });
});

describe('the day boundary and the time zone', () => {
  it('a practice finished after midnight but before 03:00 counts for the evening it was played', async () => {
    const { b } = await kid(); // 2026-11-13, Toronto
    const [x] = await unlockSome(b, 1);
    b.now = '2026-11-14T06:30:00Z'; // 01:30 on the 14th in Toronto: still the kid's 13th
    const r = await pass(b, x!);
    expect(r.quest).toMatchObject({ index: 1 }); // the 13th's bronze quest
    expect(r.levels[0]).toMatchObject({ to: 1, dueDay: '2026-11-14' });
    expect(r.patch.streak.week.at(-1)).toEqual({ day: DAY, kind: 'light' });
    expect(r.patch.today).toBe(DAY);
    b.now = '2026-11-14T08:30:00Z'; // 03:30: the 14th has started
    const st = await me(b);
    expect(st.today).toBe('2026-11-14');
    expect(shape(st)[0]).toBe(`due:2:${x}`);
  });

  it('the zone is set when the account is made; session and login never change it; PATCH /api/me does', async () => {
    const b = new Browser();
    b.timeZone = 'Europe/Paris';
    const s = await b.start();
    expect(s.profile.timeZone).toBe('Europe/Paris');
    expect((await b.ok('POST', '/api/session', { timeZone: 'UTC' })).state.profile.timeZone).toBe('Europe/Paris');
    const other = new Browser();
    other.ip = '10.0.0.9';
    await other.enter();
    const l = await other.ok('POST', '/api/login', { name: s.profile.name, pin: s.profile.pin, timeZone: 'America/Vancouver' });
    expect(l.state.profile.timeZone).toBe('Europe/Paris');
    const p = await b.ok('PATCH', '/api/me', { timeZone: 'America/Toronto' });
    expect(p.patch.profile.timeZone).toBe('America/Toronto');
  });
});

describe('migration 0002 on a release 2.2 account', () => {
  it('keeps the account playable: counters, today’s candidates and choices, practices, chests', async () => {
    const { applyD1Migrations, env, reset } = await import('cloudflare:test');
    const { migrations } = await import('./testing');
    const { sha256Hex } = await import('./util');
    await reset();
    await applyD1Migrations(env.DB, migrations.slice(0, 1));
    const [s1, , s3, c1, c2, c3, c4] = ALL as [string, string, string, string, string, string, string];
    const now = Date.parse(`${DAY}T15:00:00Z`);
    const run = (sql: string, ...binds: unknown[]) => env.DB.prepare(sql).bind(...binds).run();
    await run(
      `INSERT INTO users (id, name, name_key, pin, avatar, time_zone, created_day, created_at, xp, stats) VALUES ('u1', 'zoe', 'zoe', '123', '{}', 'America/Toronto', '2026-11-10', 0, 50, ?)`,
      JSON.stringify({ sittingsFinished: 7, perfectSittings: 2, dailyQuizzesFinished: 6, puzzlesFinished: 60 }),
    );
    await run('INSERT INTO sessions (token_hash, user_id, created_at, seen_at) VALUES (?, ?, ?, ?)', await sha256Hex('tok'), 'u1', now, now);
    await run(`INSERT INTO scene_progress (user_id, scene_id, level, due_day, passes, unlocked_day) VALUES ('u1', ?, 1, '2026-11-20', 1, '2026-11-10')`, s1);
    await run(`INSERT INTO scene_progress (user_id, scene_id, level, due_day, passes, unlocked_day) VALUES ('u1', ?, 0, NULL, 0, ?)`, c1, DAY);
    await run(
      `INSERT INTO practices (id, user_id, kind, day, seed, plan, status, created_at, scene_id, level, bonus, done, total, sittings) VALUES
         ('l_done', 'u1', 'daily', '2026-11-10', 1, '{}', 'done', 0, ?, 1, 0, 30, 30, NULL),
         ('l_bonus', 'u1', 'scene', '2026-11-12', 2, '{}', 'open', 0, ?, 2, 1, 3, 9, NULL),
         ('l_open', 'u1', 'daily', ?, 3, '{"entries":[],"focusUnitIds":[],"speak":true}', 'open', 0, ?, 1, 0, 4, 30, '[{"index":0,"from":0,"to":10}]')`,
      s1, s1, DAY, c1,
    );
    await run(`INSERT INTO daily (user_id, day, candidates, unlocked, quizzes) VALUES ('u1', ?, ?, ?, '[{},{},{}]')`, DAY, JSON.stringify([c1, c2, c3, c4, s3]), JSON.stringify([c1]));
    await run(`INSERT INTO chests (id, user_id, kind, source, earned_day) VALUES ('c_old', 'u1', 'wood', 'daily', '2026-11-12')`);
    await applyD1Migrations(env.DB, migrations.slice(1));

    const b = new Browser();
    await b.enter();
    b.cookies.set('fx_sid', 'tok');
    const st = await me(b);
    expect(st.stats).toMatchObject({ practicesFinished: 1, questsDone: 6, perfectPractices: 0, puzzlesFinished: 60 });
    expect(st.stats.sittingsFinished).toBeUndefined();
    expect(st.chests).toEqual([{ id: 'c_old', kind: 'wood', source: 'quest', earnedDay: '2026-11-12' }]);
    // Today's candidates drawn by 2.2 are the day's draw; the scene chosen then fills the first place.
    expect(st.daily.candidates.map((x: any) => x.sceneId)).toEqual([c1, c2, c3, c4, s3]);
    expect(st.daily.quests[0]).toMatchObject({ kind: 'choose', chosen: 1, target: 3, done: false });
    expect(st.daily.quests[1]).toMatchObject({ sceneId: c1, level: 1, practice: { practiceId: 'l_open', done: 4, total: 30 } });
    expect(st.practices).toEqual({ [c1]: { practiceId: 'l_open', level: 1, replay: false, done: 4, total: 30 } });
    // The open bonus sitting is gone; a new replay starts on the bronze scene; the open practice continues.
    expect((await db().prepare("SELECT id FROM practices WHERE id = 'l_bonus'").first())).toBeNull();
    expect((await b.ok('POST', '/api/practices/start', { kind: 'scene', sceneId: s1 })).plan).toMatchObject({ replay: true, level: 1 });
    const done = await b.ok('POST', '/api/practices/l_open/complete', { outcomes: [], ms: 1 });
    expect(done.quest).toMatchObject({ index: 1 });
    await b.ok('POST', '/api/daily/unlock', { sceneId: c2 });
  });
});
