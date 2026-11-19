// Practices: one per scene and level, saved after every puzzle and continued anywhere; replays.
import { beforeEach, describe, expect, it } from 'vitest';
import type { ContentIndex } from '../shared/content';
import { FIXTURE_INDEX, fixtureSceneFor } from '../shared/fixtures';
import { COMPOSER_VERSION } from '../shared/practice/practice';
import { LEVEL_WAIT_DAYS, SESTERCES, XP, addDays } from '../shared/rules';
import { setContentForTests } from './content';
import { Browser, db, freshWorld, unlockSome } from './testing';

beforeEach(freshWorld);

const DAY = '2026-11-13';
const out = (sceneId: string, n: number, extra: Record<string, unknown> = {}) => ({
  puzzleId: `t${n}`, type: 'match', sceneId, unitIds: [], missedUnitIds: [], mistakes: 0, hints: 0, skipped: false, ms: 1000, ...extra,
});

async function kid(n = 1) {
  const b = new Browser();
  const s = await b.start();
  const ids = await unlockSome(b, n);
  return { b, ids, me: s.profile, id: ids[0]! };
}

/** Saves puzzles from+1..to of a practice of `total` puzzles, one call each. */
async function play(b: Browser, plan: any, from: number, to: number, total = 30) {
  let res: any;
  for (let n = from + 1; n <= to; n++) res = await b.ok('POST', `/api/practices/${plan.id}/progress`, { done: n, total, outcomes: [out(plan.sceneId, n)] });
  return res;
}

describe('starting a scene: its practice when due, else a replay', () => {
  it('a new scene starts bronze; the same practice comes back until it is finished; then a replay', async () => {
    const { b, id } = await kid();
    const p1 = (await b.ok('POST', '/api/practices/start', { kind: 'scene', sceneId: id, composerVersion: COMPOSER_VERSION })).plan;
    expect(p1).toMatchObject({ sceneId: id, level: 1, replay: false, done: 0, total: null, composerVersion: COMPOSER_VERSION, contentVersion: 'fixture' });
    expect(p1.entries).toEqual([{ sceneId: id, level: 1, due: true }]);
    await play(b, p1, 0, 3);
    const again = (await b.ok('POST', '/api/practices/start', { kind: 'scene', sceneId: id })).plan;
    expect([again.id, again.done, again.total, again.outcomes.length]).toEqual([p1.id, 3, 30, 3]);
    const st = (await b.ok('GET', '/api/me')).state;
    expect(st.practices[id]).toEqual({ practiceId: p1.id, level: 1, replay: false, done: 3, total: 30 });
    await b.ok('POST', `/api/practices/${p1.id}/complete`, { outcomes: [], ms: 1 });
    // The next level waits for its due day: a replay at bronze, XP only.
    const r = (await b.ok('POST', '/api/practices/start', { kind: 'scene', sceneId: id })).plan;
    expect([r.replay, r.level, r.entries[0].due]).toEqual([true, 1, false]);
    await play(b, r, 0, 2, 20);
    expect((await b.ok('GET', '/api/me')).state.practices[id]).toEqual({ practiceId: r.id, level: 1, replay: true, done: 2, total: 20 });
    const done = await b.ok('POST', `/api/practices/${r.id}/complete`, { outcomes: [out(id, 2), out(id, 3)], ms: 1 });
    expect(done).toMatchObject({ replay: true, level: 1, levels: [], replayed: [id], quest: null, chest: null });
    expect(done.rewards).toEqual({ xp: XP.puzzle + XP.replay + XP.perfectPractice, sesterces: 0 });
    expect(done.patch.practices[id]).toBeNull();
    // Tomorrow silver is due: the level practice, not a replay.
    b.at(addDays(DAY, 1));
    expect((await b.ok('POST', '/api/practices/start', { kind: 'scene', sceneId: id })).plan).toMatchObject({ level: 2, replay: false });
    expect((await b.json('POST', '/api/practices/start', { kind: 'scene', sceneId: 's01e05-9999-9999' })).body.error).toBe('scene-locked');
    expect((await b.json('POST', '/api/practices/start', { kind: 'daily', slot: 0 })).body.error).toBe('bad-request');
  });

  it('a replay left open is continued, and dropped when the next level comes due and a new replay starts', async () => {
    const { b, id } = await kid();
    const p = (await b.ok('POST', '/api/practices/start', { kind: 'scene', sceneId: id })).plan;
    await b.ok('POST', `/api/practices/${p.id}/complete`, { outcomes: [], ms: 1 });
    const r1 = (await b.ok('POST', '/api/practices/start', { kind: 'scene', sceneId: id })).plan;
    await play(b, r1, 0, 1);
    expect((await b.ok('POST', '/api/practices/start', { kind: 'scene', sceneId: id })).plan.id).toBe(r1.id);
    // Silver passed the next day; the old bronze replay is not continued.
    b.at(addDays(DAY, 1));
    const silver = (await b.ok('POST', '/api/practices/start', { kind: 'scene', sceneId: id })).plan;
    await b.ok('POST', `/api/practices/${silver.id}/complete`, { outcomes: [], ms: 1 });
    const r2 = (await b.ok('POST', '/api/practices/start', { kind: 'scene', sceneId: id })).plan;
    expect([r2.replay, r2.level, r2.id === r1.id]).toEqual([true, 2, false]);
    const open = await db().prepare("SELECT id FROM practices WHERE replay = 1 AND status = 'open'").all<{ id: string }>();
    expect(open.results.map((x) => x.id)).toEqual([r2.id]);
  });
});

describe('a practice across days and browsers', () => {
  it('saves every puzzle, credits XP once, resumes elsewhere, gives the level only at the end', async () => {
    const { b, id, me } = await kid();
    const plan = (await b.ok('POST', '/api/practices/start', { kind: 'scene', sceneId: id })).plan;
    const s1 = await play(b, plan, 0, 10);
    expect(s1).toMatchObject({ done: 10, xp: XP.puzzle });
    expect(s1.patch.progress?.[id]).toBeUndefined(); // no level yet
    expect(s1.patch.streak).toBeUndefined(); // the streak counts finished practices
    // Idempotent: saving the same again credits nothing and never moves back.
    const again = await b.ok('POST', `/api/practices/${plan.id}/progress`, { done: 5, outcomes: [out(id, 10)] });
    expect([again.done, again.xp]).toEqual([10, 0]);

    // The next day, another browser of the same kid.
    const other = new Browser();
    other.ip = '10.0.0.5';
    other.at(addDays(DAY, 1));
    await other.enter();
    await other.ok('POST', '/api/login', { name: me.name, pin: me.pin });
    const st = (await other.ok('GET', '/api/me')).state;
    // Yesterday's bronze practice, started and not finished, is one of today's quests, with its progress.
    expect(st.daily.quests[0]).toMatchObject({ kind: 'practice', sceneId: id, level: 1, reason: 'continue', practice: { practiceId: plan.id, done: 10, total: 30 } });
    const resumed = (await other.ok('POST', '/api/practices/start', { kind: 'scene', sceneId: id })).plan;
    expect([resumed.id, resumed.seed, resumed.done, resumed.total, resumed.outcomes.length]).toEqual([plan.id, plan.seed, 10, 30, 10]);
    await play(other, resumed, 10, 29);
    expect((await other.ok('GET', '/api/me')).state.progress[id].level).toBe(0);

    // Completion: bronze, the practice XP, today's quest.
    const xpBefore = (await other.ok('GET', '/api/me')).state.currencies.xp;
    expect(xpBefore).toBe(29 * XP.puzzle);
    const res = await other.ok('POST', `/api/practices/${plan.id}/complete`, { outcomes: [out(id, 29), out(id, 30)], ms: 1 });
    expect(res.levels).toEqual([{ sceneId: id, from: 0, to: 1, dueDay: addDays(DAY, 1 + LEVEL_WAIT_DAYS[0]) }]);
    expect(res.creditedXp).toBe(29 * XP.puzzle);
    expect(res.rewards).toEqual({ xp: XP.puzzle + XP.newLevel + XP.perfectPractice, sesterces: SESTERCES.newLevel + SESTERCES.perfectPractice });
    expect(res.quest).toMatchObject({ index: 0, chest: { kind: 'wood', source: 'quest' } });
    expect(res.streak).toMatchObject({ count: 1, extended: true });
    expect(res.patch.practices[id]).toBeNull();
    expect(res.patch.stats.practicesFinished).toBe(1);
    expect(res.patch.stats.perfectPractices).toBe(1);
    expect((await other.json('POST', `/api/practices/${plan.id}/progress`, { done: 30, outcomes: [] })).body.error).toBe('practice-closed');
    expect((await other.json('POST', '/api/practices/start', { kind: 'resume', practiceId: plan.id })).body.error).toBe('practice-closed');
  });

  it('shows progress no further than the total (a practice composed again shorter)', async () => {
    const { b, id } = await kid();
    const plan = (await b.ok('POST', '/api/practices/start', { kind: 'scene', sceneId: id, composerVersion: 1 })).plan;
    await play(b, plan, 0, 25, 30);
    // A newer composer made it 20 long: the client continues by count and reports the new total.
    const r = await b.ok('POST', `/api/practices/${plan.id}/progress`, { done: 20, total: 20, outcomes: [out(id, 99)] });
    expect(r.done).toBe(25);
    expect(r.patch.practices[id]).toMatchObject({ done: 20, total: 20 });
    expect((await b.ok('POST', '/api/practices/start', { kind: 'resume', practiceId: plan.id })).plan).toMatchObject({ done: 25, total: 20, composerVersion: 1 });
  });

  it('one kid never touches another kid’s practice', async () => {
    const a = await kid();
    const plan = (await a.b.ok('POST', '/api/practices/start', { kind: 'scene', sceneId: a.id })).plan;
    const o = await kid();
    expect((await o.b.json('POST', `/api/practices/${plan.id}/progress`, { done: 5, outcomes: [] })).body.error).toBe('practice-closed');
    expect((await o.b.json('POST', `/api/practices/${plan.id}/complete`, { outcomes: [] })).body.error).toBe('practice-closed');
    expect((await o.b.json('POST', '/api/practices/start', { kind: 'resume', practiceId: plan.id })).body.error).toBe('practice-closed');
    expect((await db().prepare('SELECT done FROM practices WHERE id = ?').bind(plan.id).first<{ done: number }>())!.done).toBe(0);
  });
});

describe('the edges of the release', () => {
  it('a kid who unlocked and finished everything replays; scenes outside the release are ignored', async () => {
    const ids = FIXTURE_INDEX.scenes.slice(0, 3).map((s) => s.id);
    const small: ContentIndex = {
      ...FIXTURE_INDEX,
      scenes: FIXTURE_INDEX.scenes.filter((s) => ids.includes(s.id)),
      episodes: FIXTURE_INDEX.episodes.map((e) => ({ ...e, sceneIds: e.sceneIds.filter((x) => ids.includes(x)) })),
    };
    setContentForTests({ index: small, scene: fixtureSceneFor });
    const b = new Browser();
    const s = await b.start();
    expect(s.daily.candidates).toHaveLength(3); // fewer than a draw left
    for (const o of s.daily.candidates) await b.ok('POST', '/api/daily/unlock', { sceneId: o.sceneId });
    // Plutonium everywhere, and progress on a scene that is not in the release.
    await db().prepare('UPDATE scene_progress SET level = 6, due_day = NULL WHERE user_id = ?').bind(s.profile.id).run();
    await db()
      .prepare("INSERT INTO scene_progress (user_id, scene_id, level, due_day, unlocked_day) VALUES (?, 's01e05-0500-0505', 1, '2026-11-01', '2026-11-01')")
      .bind(s.profile.id)
      .run();
    b.at(addDays(DAY, 1));
    const st = (await b.ok('GET', '/api/me')).state;
    expect(Object.keys(st.progress).sort()).toEqual([...ids].sort());
    expect(st.daily).toMatchObject({ candidates: [], quests: [], choose: null, doMore: false, questsDone: false });
    expect(st.stats.episodesComplete).toBeGreaterThanOrEqual(1);
    const plan = (await b.ok('POST', '/api/practices/start', { kind: 'scene', sceneId: ids[0] })).plan;
    expect([plan.replay, plan.level]).toEqual([true, 6]);
    const r = await b.ok('POST', `/api/practices/${plan.id}/complete`, { outcomes: [out(plan.sceneId, 1)], ms: 1 });
    expect([r.levels, r.quest, r.streak.count]).toEqual([[], null, 1]);
  });
});
