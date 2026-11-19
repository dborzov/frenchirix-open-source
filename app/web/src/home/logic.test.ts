import { describe, expect, it } from 'vitest';
import type { SceneProgress } from '../../../shared/api';
import { FIXTURE_PLAYER } from '../../../shared/fixtures/player';
import {
  collapseLocked,
  reviewOrder,
  unlockDays,
  comeBackLists,
  episodeProgress,
  formatClock,
  layoutTimeline,
  levelsAtLeast,
  nextLevel,
  allUnlocked,
  currentChoose,
  dayQuestCount,
  listNumbers,
  practiceQueue,
  pickForDay,
  questCards,
  timeMarks,
} from './logic';

const prog = (level: SceneProgress['level'], dueDay: string | null): SceneProgress => ({ level, dueDay, passes: 1, unlockedDay: '2026-11-01', views: 0, lastPassDay: null });

describe('nextLevel', () => {
  it('is now for a new scene and on or after the due day', () => {
    expect(nextLevel(prog(0, null), '2026-11-13')).toEqual({ state: 'now' });
    expect(nextLevel(prog(2, '2026-11-13'), '2026-11-13')).toEqual({ state: 'now' });
    expect(nextLevel(prog(2, '2026-11-10'), '2026-11-13')).toEqual({ state: 'now' });
  });
  it('counts the days to wait', () => {
    expect(nextLevel(prog(1, '2026-11-14'), '2026-11-13')).toEqual({ state: 'wait', days: 1 });
    expect(nextLevel(prog(4, '2026-11-21'), '2026-11-13')).toEqual({ state: 'wait', days: 8 });
  });
  it('is max at plutonium', () => {
    expect(nextLevel(prog(6, null), '2026-11-13')).toEqual({ state: 'max' });
  });
});

describe('questCards', () => {
  const d = FIXTURE_PLAYER.daily;
  it('makes the first quest that can be done the next one; the locked choose quest names what it waits for', () => {
    const cards = questCards({ ...FIXTURE_PLAYER, chests: [] });
    expect(cards.map((x) => x.state)).toEqual(['next', 'open', 'open', 'locked', 'waiting']);
    expect(cards[3]!.waitingNumbers).toEqual([1, 2, 3]);
    expect(cards.map((x) => x.number)).toEqual([1, 2, 3, 4, 5]);
  });
  it('makes the choose quest next once the quests before it are done, and flags unopened chests', () => {
    const quests = d.quests.map((q) => (q.kind === 'practice' && q.sceneId ? { ...q, done: true, chestId: `c${q.index}` } : q.kind === 'choose' ? { ...q, locked: false, waitingFor: [] } : q));
    const cards = questCards({ daily: { ...d, quests }, chests: [{ id: 'c1', kind: 'wood', source: 'quest', earnedDay: d.day }] });
    expect(cards.map((x) => x.state)).toEqual(['done', 'done', 'done', 'next', 'waiting']);
    expect(cards.map((x) => x.chestWaiting)).toEqual([false, true, false, false, false]);
    expect(dayQuestCount({ quests })).toEqual({ done: 3, total: 5 });
  });
  it('numbers quests in order when one was left out (indexes skip)', () => {
    const quests = d.quests.filter((q) => q.index !== 1);
    const cards = questCards({ daily: { ...d, quests }, chests: [] });
    expect(cards.map((x) => x.number)).toEqual([1, 2, 3, 4]);
    expect(cards[2]!.waitingNumbers).toEqual([1, 2]); // waits for indexes 0 and 2 (index 1 is gone)
  });
  it('finds the current choose quest', () => {
    expect(currentChoose(d)?.index).toBe(3);
    expect(currentChoose({ ...d, choose: null })).toBeNull();
  });
  it('lists numbers', () => {
    expect(listNumbers([1], 'and')).toBe('1');
    expect(listNumbers([1, 2, 3], 'et')).toBe('1, 2 et 3');
  });
});

describe('practiceQueue', () => {
  it('puts unfinished practices first (furthest along first), then due scenes, then the rest', () => {
    const q = practiceQueue({
      ...FIXTURE_PLAYER,
      practices: {
        's01e01-0004-0008': { practiceId: 'l1', level: 3, replay: false, done: 5, total: 40 },
        's01e05-0017-0022': { practiceId: 'l2', level: 1, replay: false, done: 30, total: 40 },
      },
    });
    expect(q.slice(0, 2).map((x) => x.sceneId)).toEqual(['s01e05-0017-0022', 's01e01-0004-0008']);
    expect(q[2]!.practice).toBeNull();
    expect(q[2]!.next.state).toBe('now');
    expect(new Set(q.map((x) => x.sceneId)).size).toBe(q.length);
  });
});

describe('unlocking', () => {
  it('knows when everything is unlocked', () => {
    expect(allUnlocked(FIXTURE_PLAYER, 203)).toBe(false);
    expect(allUnlocked(FIXTURE_PLAYER, 6)).toBe(true);
    expect(allUnlocked({ ...FIXTURE_PLAYER, daily: { ...FIXTURE_PLAYER.daily, choose: null } }, 50)).toBe(true);
    expect(allUnlocked({ progress: {}, daily: { ...FIXTURE_PLAYER.daily, choose: null } }, 50)).toBe(false);
  });
});

describe('comeBackLists', () => {
  it('lists due scenes in server order and waiting ones soonest first', () => {
    const { due, waiting } = comeBackLists(FIXTURE_PLAYER);
    expect(due.map((d) => d.sceneId)).toEqual(FIXTURE_PLAYER.daily.dueSceneIds);
    expect(waiting.map((w) => w.sceneId)).toEqual(['s01e01-0004-0008']);
    expect(waiting[0]!.next).toEqual({ state: 'wait', days: 1 });
  });
  it('leaves out plutonium scenes', () => {
    const st = { ...FIXTURE_PLAYER, progress: { a: prog(6, null) }, daily: { ...FIXTURE_PLAYER.daily, dueSceneIds: [] } };
    expect(comeBackLists(st)).toEqual({ due: [], waiting: [] });
  });
});

describe('episodeProgress', () => {
  it('counts unlocked scenes, level steps and due scenes', () => {
    const p = { a: prog(2, '2026-11-13'), b: prog(1, '2026-11-20'), c: prog(0, null) };
    const e = episodeProgress(['a', 'b', 'c', 'd'], p, '2026-11-13');
    expect(e.total).toBe(4);
    expect(e.unlocked).toBe(3);
    expect(e.levelSteps).toBe(3);
    expect(e.maxLevelSteps).toBe(24);
    expect(e.byLevel.slice(0, 3)).toEqual([1, 1, 1]);
    expect(e.due).toBe(2); // a (due today) and c (new)
    expect(e.fraction).toBeCloseTo(3 / 24);
  });
  it('is zero for an empty episode', () => {
    expect(episodeProgress([], {}, '2026-11-13').fraction).toBe(0);
  });
  it('levelsAtLeast counts scenes at each level or better', () => {
    expect(levelsAtLeast({ a: prog(2, null), b: prog(1, null) }).slice(0, 4)).toEqual([2, 2, 1, 0]);
  });
});

describe('layoutTimeline', () => {
  const opt = { pxPerMinute: 30, minGap: 80, pad: 50, amplitude: 60, wavelength: 400 };
  it('keeps time order and a minimum gap', () => {
    const scenes = [
      { id: 'b', startMs: 60_000 },
      { id: 'a', startMs: 0 },
      { id: 'c', startMs: 61_000 },
      { id: 'd', startMs: 20 * 60_000 },
    ];
    const l = layoutTimeline(scenes, 25 * 60_000, opt);
    expect(l.points.map((p) => p.id)).toEqual(['a', 'b', 'c', 'd']);
    for (let i = 1; i < l.points.length; i++) expect(l.points[i]!.along - l.points[i - 1]!.along).toBeGreaterThanOrEqual(80 - 1e-9);
    expect(l.points[3]!.along).toBeCloseTo(50 + 20 * 30);
    expect(l.length).toBeGreaterThanOrEqual(l.points[3]!.along + 50);
    for (const p of l.points) expect(Math.abs(p.across)).toBeLessThanOrEqual(60);
  });
  it('maps episode time monotonically through the placed scenes', () => {
    const l = layoutTimeline([{ id: 'a', startMs: 0 }, { id: 'b', startMs: 1000 }, { id: 'c', startMs: 600_000 }], 1_200_000, opt);
    const ms = [0, 500, 1000, 300_000, 600_000, 900_000, 1_200_000];
    const along = ms.map(l.alongForMs);
    for (let i = 1; i < along.length; i++) expect(along[i]!).toBeGreaterThanOrEqual(along[i - 1]!);
    expect(l.alongForMs(1000)).toBeCloseTo(l.points[1]!.along);
    expect(l.pathD(100).startsWith('M')).toBe(true);
  });
  it('handles an empty list', () => {
    const l = layoutTimeline([], 60_000, opt);
    expect(l.points).toEqual([]);
    expect(l.length).toBeGreaterThan(0);
  });
});

describe('small helpers', () => {
  it('formats clock times', () => {
    expect(formatClock(17_708)).toBe('0:18');
    expect(formatClock(65_000)).toBe('1:05');
  });
  it('lists time marks', () => {
    expect(timeMarks(16 * 60_000)).toEqual([300_000, 600_000, 900_000]);
  });
  it('picks the same item for the same day', () => {
    expect(pickForDay(['a', 'b', 'c'], '2026-11-13')).toBe(pickForDay(['a', 'b', 'c'], '2026-11-13'));
    expect(pickForDay([], '2026-11-13')).toBeUndefined();
  });
});

describe('the Episodes tab', () => {
  const p = (level: SceneProgress['level'], dueDay: string | null, unlockedDay: string): SceneProgress => ({ level, dueDay, passes: 1, unlockedDay, views: 0, lastPassDay: null });
  it('collapses runs of locked scenes into one counted item', () => {
    const items = collapseLocked(['a', 'b', 'c', 'd', 'e', 'f'], { c: p(1, null, '2026-11-01'), f: p(0, null, '2026-11-02') });
    expect(items).toEqual([
      { kind: 'locked', count: 2, firstId: 'a' },
      { kind: 'scene', id: 'c' },
      { kind: 'locked', count: 2, firstId: 'd' },
      { kind: 'scene', id: 'f' },
    ]);
    expect(collapseLocked(['a', 'b'], {})).toEqual([{ kind: 'locked', count: 2, firstId: 'a' }]);
  });
  it('groups unlocked scenes by day, newest first', () => {
    const groups = unlockDays({ x: p(0, null, '2026-11-12'), y: p(0, null, '2026-11-13'), z: p(0, null, '2026-11-12') }, ['z', 'x']);
    expect(groups).toEqual([
      { day: '2026-11-13', ids: ['y'] },
      { day: '2026-11-12', ids: ['z', 'x'] },
    ]);
    expect(unlockDays({})).toEqual([]);
  });
  it('orders reviews: earnable now first, then soonest, plutonium last', () => {
    const r = reviewOrder({ a: p(6, null, 'x'), b: p(2, '2026-11-15', 'x'), c: p(1, '2026-11-13', 'x'), d: p(0, null, 'x') }, '2026-11-13');
    expect(r.map((x) => x.sceneId)).toEqual(['d', 'c', 'b', 'a']);
  });
});
