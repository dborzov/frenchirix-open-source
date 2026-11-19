import { beforeEach, describe, expect, it } from 'vitest';
import { FIXTURE_INDEX, FIXTURE_SCENE } from '../shared/fixtures';
import { addDays } from '../shared/rules';
import { Browser, db, freshWorld, unlockSome } from './testing';

beforeEach(freshWorld);

const DAY = '2026-11-13';
const Q = FIXTURE_SCENE.questions[0]!;

describe('question spacing', () => {
  it('a question is shown at most 3 times, 5 then 14 days apart, never twice a day', async () => {
    const b = new Browser();
    await b.start();
    const id = (await unlockSome(b, 1))[0]!;
    const run = async (day: string, show: boolean) => {
      b.at(day);
      const { plan } = await b.ok('POST', '/api/practices/start', { kind: 'scene', sceneId: id });
      const allowed = plan.allowedQuestionIds.includes(Q.id);
      const outcomes = show && allowed
        ? [{ puzzleId: 'q', type: 'question', sceneId: id, unitIds: [], missedUnitIds: [], mistakes: 0, hints: 0, skipped: false, ms: 1, questionId: Q.id }]
        : [];
      await b.ok('POST', `/api/practices/${plan.id}/complete`, { outcomes, ms: 1 });
      return allowed;
    };
    const seen = async () => (await db().prepare('SELECT shows, last_day FROM question_seen').first<{ shows: number; last_day: string }>()) ?? null;
    expect(await run(DAY, true)).toBe(true);
    expect(await seen()).toEqual({ shows: 1, last_day: DAY });
    expect(await run(DAY, true)).toBe(false); // never twice a day
    expect(await run(addDays(DAY, 4), true)).toBe(false);
    expect(await run(addDays(DAY, 5), true)).toBe(true);
    expect(await seen()).toEqual({ shows: 2, last_day: addDays(DAY, 5) });
    expect(await run(addDays(DAY, 18), true)).toBe(false);
    expect(await run(addDays(DAY, 19), true)).toBe(true);
    expect(await run(addDays(DAY, 400), true)).toBe(false);
    expect((await seen())!.shows).toBe(3);
  });

  it('ignores question ids outside the plan’s scenes and counts once per day', async () => {
    const b = new Browser();
    await b.start();
    const id = (await unlockSome(b, 1))[0]!;
    const { plan } = await b.ok('POST', '/api/practices/start', { kind: 'scene', sceneId: id });
    const o = (questionId: string) => ({ puzzleId: questionId, type: 'question', sceneId: id, unitIds: [], missedUnitIds: [], mistakes: 0, hints: 0, skipped: false, ms: 1, questionId });
    await b.ok('POST', `/api/practices/${plan.id}/complete`, { outcomes: [o(Q.id), o(Q.id), o('s09e09-0001-0002:q1')], ms: 1 });
    const rows = await db().prepare('SELECT question_id, shows FROM question_seen').all();
    expect(rows.results).toEqual([{ question_id: Q.id, shows: 1 }]);
  });
});

describe('episodesComplete', () => {
  it('counts episodes whose every scene is unlocked, on unlock', async () => {
    const ep = FIXTURE_INDEX.episodes[0]!;
    const b = new Browser();
    const s = await b.start();
    const rest = ep.sceneIds.slice(1);
    for (const id of rest) {
      await db()
        .prepare("INSERT INTO scene_progress (user_id, scene_id, level, unlocked_day) VALUES (?, ?, 0, '2026-11-01')")
        .bind(s.profile.id, id)
        .run();
    }
    // Make the episode's first scene today's offer.
    b.at(DAY);
    await db().prepare('DELETE FROM daily').run();
    await db()
      .prepare("INSERT INTO daily (user_id, day, candidates) VALUES (?, ?, ?)")
      .bind(s.profile.id, DAY, JSON.stringify([ep.sceneIds[0]]))
      .run();
    const r = await b.ok('POST', '/api/daily/unlock', { sceneId: ep.sceneIds[0] });
    expect(r.patch.stats.episodesComplete).toBe(1);
  });
});
