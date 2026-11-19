import { describe, expect, it } from 'vitest';
import {
  addDays,
  applyPass,
  compareDays,
  dayInZone,
  daysBetween,
  daysUntilNextLevel,
  displayedStreak,
  dueDayAfter,
  friendStreak,
  isDay,
  isDue,
  kidDay,
  minutesUntilNextDay,
  planQuests,
  questChest,
  practiceStars,
  MAX_LEVEL,
  levelName,
  LEVEL_WAIT_DAYS,
  LEVELS,
  overdueDays,
  streakOnPractice,
  weekOf,
  xpForRank,
  xpRank,
  type Level,
  type LevelProgress,
} from './rules';

describe('days', () => {
  it('validates days', () => {
    expect(isDay('2026-11-13')).toBe(true);
    expect(isDay('2026-02-29')).toBe(false);
    expect(isDay('2028-02-29')).toBe(true);
    expect(isDay('2026-13-01')).toBe(false);
    expect(isDay('2026-1-01')).toBe(false);
    expect(isDay(20261113)).toBe(false);
  });

  it('adds days across months, years and leap days', () => {
    expect(addDays('2026-11-13', 1)).toBe('2026-11-14');
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-11-13', 0)).toBe('2026-11-13');
    expect(addDays('2026-11-13', 16)).toBe('2026-11-29');
  });

  it('is unaffected by daylight saving changes', () => {
    // 2026-03-08 and 2026-11-01 are DST switches in North America.
    expect(addDays('2026-03-07', 2)).toBe('2026-03-09');
    expect(daysBetween('2026-10-31', '2026-11-02')).toBe(2);
  });

  it('counts days between', () => {
    expect(daysBetween('2026-11-13', '2026-11-13')).toBe(0);
    expect(daysBetween('2026-11-13', '2026-11-20')).toBe(7);
    expect(daysBetween('2026-11-20', '2026-11-13')).toBe(-7);
    expect(daysBetween('2026-12-25', '2027-01-05')).toBe(11);
  });

  it('compares days', () => {
    expect(compareDays('2026-11-13', '2026-11-14')).toBe(-1);
    expect(compareDays('2026-11-14', '2026-11-13')).toBe(1);
    expect(compareDays('2026-11-14', '2026-11-14')).toBe(0);
  });

  it('throws on a malformed day', () => {
    expect(() => addDays('nope', 1)).toThrow();
  });

  it('computes the day in a time zone', () => {
    const instant = Date.UTC(2026, 10, 14, 3, 30); // 03:30 UTC on Nov 14
    expect(dayInZone(instant, 'UTC')).toBe('2026-11-14');
    expect(dayInZone(instant, 'America/Toronto')).toBe('2026-11-13'); // 22:30 the day before
    expect(dayInZone(instant, 'Asia/Tokyo')).toBe('2026-11-14');
    expect(dayInZone(new Date(Date.UTC(2026, 10, 14, 23, 0)), 'Pacific/Auckland')).toBe('2026-11-15');
  });

  it('falls back to the default zone for an invalid zone', () => {
    const instant = Date.UTC(2026, 10, 14, 3, 30);
    expect(dayInZone(instant, 'Not/AZone')).toBe('2026-11-13');
  });

  it('finds the Monday of a week', () => {
    expect(weekOf('2026-11-13')).toBe('2026-11-09'); // Friday
    expect(weekOf('2026-11-09')).toBe('2026-11-09'); // Monday
    expect(weekOf('2026-11-15')).toBe('2026-11-09'); // Sunday
    expect(weekOf('2027-01-01')).toBe('2026-12-28');
  });
});

describe('the kid’s day', () => {
  it('starts at 03:00 local time', () => {
    // Toronto is UTC-5 in November.
    expect(kidDay(Date.parse('2026-11-14T04:59:00Z'), 'America/Toronto')).toBe('2026-11-13'); // 23:59
    expect(kidDay(Date.parse('2026-11-14T07:59:00Z'), 'America/Toronto')).toBe('2026-11-13'); // 02:59
    expect(kidDay(Date.parse('2026-11-14T08:00:00Z'), 'America/Toronto')).toBe('2026-11-14'); // 03:00
    expect(kidDay(Date.parse('2026-11-14T08:00:00Z'), 'Mars/Olympus')).toBe('2026-11-14'); // the default zone
  });

  it('counts the minutes until the next day starts', () => {
    expect(minutesUntilNextDay(Date.parse('2026-11-14T07:00:00Z'), 'America/Toronto')).toBe(60); // 02:00
    expect(minutesUntilNextDay(Date.parse('2026-11-14T08:00:00Z'), 'America/Toronto')).toBe(24 * 60); // 03:00
    expect(minutesUntilNextDay(Date.parse('2026-11-14T03:00:00Z'), 'America/Toronto')).toBe(5 * 60); // 22:00
  });
});

describe('daily quests', () => {
  const w = (n: number) => Array.from({ length: n }, (_, i) => ({ sceneId: `s${i}`, level: 2, reason: 'due' as const }));
  const kinds = (qs: ReturnType<typeof planQuests>) => qs.map((q) => (q.kind === 'choose' ? `choose${q.target}` : q.sceneId ?? 'place'));

  it('nothing waits: choose and three places', () => {
    expect(kinds(planQuests([], 5))).toEqual(['choose3', 'place', 'place', 'place']);
  });

  it('one waits: five', () => {
    expect(kinds(planQuests(w(1), 5))).toEqual(['s0', 'choose3', 'place', 'place', 'place']);
  });

  it('many wait: three of them, choose, one place', () => {
    expect(kinds(planQuests(w(6), 5))).toEqual(['s0', 's1', 's2', 'choose3', 'place']);
  });

  it('few candidates left: choose fewer; none: the practices that wait take every place', () => {
    expect(kinds(planQuests([], 2))).toEqual(['choose2', 'place', 'place']);
    expect(kinds(planQuests(w(7), 0))).toEqual(['s0', 's1', 's2', 's3', 's4']);
    expect(planQuests([], 0)).toEqual([]);
  });

  it('gives the last quest gold, the one before silver, the others wood', () => {
    expect(planQuests(w(1), 5).map((q) => q.chest)).toEqual(['wood', 'wood', 'wood', 'silver', 'gold']);
    expect([questChest(0, 1), questChest(0, 2)]).toEqual(['gold', 'silver']);
  });
});

describe('levels', () => {
  it('has six levels after none and five waits', () => {
    expect(LEVELS).toEqual(['none', 'bronze', 'silver', 'gold', 'titanium', 'diamond', 'plutonium']);
    expect(MAX_LEVEL).toBe(6);
    expect(LEVEL_WAIT_DAYS).toEqual([1, 2, 4, 8, 16]);
    expect(levelName(3)).toBe('gold');
    expect(levelName(99)).toBe('plutonium');
  });

  it('gives bronze on the first pass, due the next day', () => {
    const r = applyPass({ level: 0, dueDay: null }, '2026-11-13');
    expect(r).toEqual({ level: 1, dueDay: '2026-11-14', rose: true, replay: false });
  });

  it('a second pass on the same day is practice', () => {
    const r = applyPass({ level: 1, dueDay: '2026-11-14' }, '2026-11-13');
    expect(r).toEqual({ level: 1, dueDay: '2026-11-14', rose: false, replay: true });
  });

  it('rises one step on or after the due day', () => {
    expect(applyPass({ level: 1, dueDay: '2026-11-14' }, '2026-11-14')).toEqual({
      level: 2, dueDay: '2026-11-16', rose: true, replay: false,
    });
    // Late is fine, and still only one step.
    expect(applyPass({ level: 1, dueDay: '2026-11-14' }, '2026-12-25')).toEqual({
      level: 2, dueDay: '2026-12-27', rose: true, replay: false,
    });
  });

  it('follows the waits 1, 2, 4, 8, 16 when passed exactly on time', () => {
    let p: LevelProgress = { level: 0, dueDay: null };
    let day = '2026-11-01';
    const days: string[] = [];
    for (;;) {
      const r = applyPass(p, day);
      if (!r.rose) break;
      days.push(day);
      p = r;
      if (p.dueDay === null) break;
      day = p.dueDay;
    }
    expect(p.level).toBe(6);
    expect(p.dueDay).toBeNull();
    expect(days).toEqual(['2026-11-01', '2026-11-02', '2026-11-04', '2026-11-08', '2026-11-16', '2026-12-02']);
  });

  it('cannot rise twice in a day, whatever the number of passes', () => {
    let p: LevelProgress = { level: 0, dueDay: null };
    for (let i = 0; i < 10; i++) p = applyPass(p, '2026-11-13');
    expect(p.level).toBe(1);
  });

  it('stays at plutonium', () => {
    const r = applyPass({ level: 6, dueDay: null }, '2026-11-13');
    expect(r).toEqual({ level: 6, dueDay: null, rose: false, replay: true });
  });

  it('dueDayAfter', () => {
    expect(dueDayAfter(1, '2026-11-13')).toBe('2026-11-14');
    expect(dueDayAfter(5, '2026-11-13')).toBe('2026-11-29');
    expect(dueDayAfter(6, '2026-11-13')).toBeNull();
    expect(dueDayAfter(0 as Level, '2026-11-13')).toBeNull();
  });

  it('says how long until the next level', () => {
    expect(daysUntilNextLevel({ level: 0, dueDay: null }, '2026-11-13')).toBe(0);
    expect(daysUntilNextLevel({ level: 2, dueDay: '2026-11-15' }, '2026-11-13')).toBe(2);
    expect(daysUntilNextLevel({ level: 2, dueDay: '2026-11-10' }, '2026-11-13')).toBe(0);
    expect(daysUntilNextLevel({ level: 6, dueDay: null }, '2026-11-13')).toBeNull();
    expect(isDue({ level: 2, dueDay: '2026-11-13' }, '2026-11-13')).toBe(true);
    expect(isDue({ level: 2, dueDay: '2026-11-14' }, '2026-11-13')).toBe(false);
  });

  it('sorts by how overdue', () => {
    expect(overdueDays({ level: 2, dueDay: '2026-11-10' }, '2026-11-13')).toBe(3);
    expect(overdueDays({ level: 2, dueDay: '2026-11-15' }, '2026-11-13')).toBe(-2);
    expect(overdueDays({ level: 6, dueDay: null }, '2026-11-13')).toBe(-Infinity);
  });
});

describe('streaks', () => {
  const s = (count: number, lastDay: string | null, best = count) => ({ count, best, lastDay });

  it('starts at 1', () => {
    const r = streakOnPractice(s(0, null), 0, '2026-11-13');
    expect(r.streak).toEqual({ count: 1, best: 1, lastDay: '2026-11-13' });
    expect(r.extended).toBe(true);
  });

  it('does not change on a second practice the same day', () => {
    const r = streakOnPractice(s(4, '2026-11-13'), 1, '2026-11-13');
    expect(r.streak.count).toBe(4);
    expect(r.extended).toBe(false);
  });

  it('extends on the next day', () => {
    const r = streakOnPractice(s(4, '2026-11-12'), 0, '2026-11-13');
    expect(r.streak).toEqual({ count: 5, best: 5, lastDay: '2026-11-13' });
    expect(r.freezesUsed).toBe(0);
  });

  it('uses one freeze per missed day', () => {
    const r = streakOnPractice(s(4, '2026-11-10'), 2, '2026-11-13'); // missed 11 and 12
    expect(r.streak.count).toBe(5);
    expect(r.freezes).toBe(0);
    expect(r.freezesUsed).toBe(2);
    expect(r.reset).toBe(false);
  });

  it('resets when there are not enough freezes, keeping them and the best', () => {
    const r = streakOnPractice(s(9, '2026-11-09', 12), 1, '2026-11-13'); // missed 3 days
    expect(r.streak).toEqual({ count: 1, best: 12, lastDay: '2026-11-13' });
    expect(r.freezes).toBe(1);
    expect(r.reset).toBe(true);
  });

  it('displays the streak only while it can still be saved', () => {
    expect(displayedStreak(s(4, '2026-11-13'), 0, '2026-11-13')).toBe(4);
    expect(displayedStreak(s(4, '2026-11-12'), 0, '2026-11-13')).toBe(4);
    expect(displayedStreak(s(4, '2026-11-11'), 0, '2026-11-13')).toBe(0);
    expect(displayedStreak(s(4, '2026-11-11'), 1, '2026-11-13')).toBe(4);
    expect(displayedStreak(s(0, null), 2, '2026-11-13')).toBe(0);
  });

  it('counts friend streaks', () => {
    const a = new Set(['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13']);
    const b = new Set(['2026-11-11', '2026-11-12']);
    expect(friendStreak(a, b, '2026-11-13')).toBe(2); // yesterday and the day before
    b.add('2026-11-13');
    expect(friendStreak(a, b, '2026-11-13')).toBe(3);
    expect(friendStreak(a, new Set(), '2026-11-13')).toBe(0);
  });
});

describe('rewards', () => {
  it('grades stars without ever failing', () => {
    expect(practiceStars(12, 0, 0)).toBe(3);
    expect(practiceStars(12, 4, 2)).toBe(2);
    expect(practiceStars(12, 20, 4)).toBe(1);
    expect(practiceStars(0, 0, 0)).toBe(3);
  });

  it('ranks from XP', () => {
    expect(xpForRank(1)).toBe(0);
    expect(xpRank(0)).toBe(1);
    expect(xpRank(49)).toBe(1);
    expect(xpRank(50)).toBe(2);
    expect(xpRank(150)).toBe(3);
    for (let l = 1; l < 30; l++) expect(xpForRank(l + 1)).toBeGreaterThan(xpForRank(l));
  });
});

describe('question spacing', () => {
  it('allows a question at most QUESTION_MAX_SHOWS times, 5 then 14 days apart, never twice a day', async () => {
    const { QUESTION_MAX_SHOWS, QUESTION_GAP_DAYS, questionEligible, addDays: add } = await import('./rules');
    expect(QUESTION_MAX_SHOWS).toBe(3);
    expect(QUESTION_GAP_DAYS).toEqual([5, 14]);
    const d = '2026-11-13';
    expect(questionEligible(null, d)).toBe(true);
    expect(questionEligible({ shows: 1, lastDay: d }, d)).toBe(false);
    expect(questionEligible({ shows: 1, lastDay: d }, add(d, 4))).toBe(false);
    expect(questionEligible({ shows: 1, lastDay: d }, add(d, 5))).toBe(true);
    expect(questionEligible({ shows: 2, lastDay: d }, add(d, 13))).toBe(false);
    expect(questionEligible({ shows: 2, lastDay: d }, add(d, 14))).toBe(true);
    expect(questionEligible({ shows: 3, lastDay: d }, add(d, 400))).toBe(false);
  });
});
