// Constants and pure functions of the game rules (docs/app-rules.md).
// The server is the authority and uses these to change state; the client uses them only to display
// (for example "next level in 2 days"). All numbers of the rules live here.

// ---------------------------------------------------------------------------------------------
// Days. A day is 'YYYY-MM-DD'. The kid's day (kidDay) starts at DAY_START_HOUR in the account's time
// zone, so a practice finished just after midnight counts for the evening it was played. One boundary
// for everything: quests, candidates, streaks, due days, leagues, the shop, the activity log.

export type Day = string;

export const DEFAULT_TIME_ZONE = 'America/Toronto';
/** The kid's day starts at this hour, local time. */
export const DAY_START_HOUR = 3;

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

export function isDay(s: unknown): s is Day {
  if (typeof s !== 'string') return false;
  const m = DAY_RE.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!));
  return d.toISOString().slice(0, 10) === s;
}

function dayToUtcMs(day: Day): number {
  if (!isDay(day)) throw new RangeError(`not a day: ${day}`);
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
}

function utcMsToDay(ms: number): Day {
  return new Date(ms).toISOString().slice(0, 10);
}

/** day + n days (n may be negative). */
export function addDays(day: Day, n: number): Day {
  return utcMsToDay(dayToUtcMs(day) + Math.trunc(n) * MS_PER_DAY);
}

/** Whole days from a to b: positive when b is later. */
export function daysBetween(a: Day, b: Day): number {
  return Math.round((dayToUtcMs(b) - dayToUtcMs(a)) / MS_PER_DAY);
}

/** Negative, zero or positive, like a sort comparator. 'YYYY-MM-DD' also compares as a string. */
export function compareDays(a: Day, b: Day): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function isValidTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** The calendar day of an instant in an IANA zone. An invalid zone falls back to DEFAULT_TIME_ZONE. */
export function dayInZone(date: Date | number, zone: string): Day {
  const tz = isValidTimeZone(zone) ? zone : DEFAULT_TIME_ZONE;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(typeof date === 'number' ? new Date(date) : date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** The kid's day of an instant: the calendar day in the zone DAY_START_HOUR hours earlier. */
export function kidDay(date: Date | number, zone: string): Day {
  const ms = typeof date === 'number' ? date : date.getTime();
  return dayInZone(ms - DAY_START_HOUR * 3_600_000, zone);
}

/** Minutes until the kid's next day starts (DAY_START_HOUR local), at least 1: "new scenes in 5 h". */
export function minutesUntilNextDay(date: Date | number, zone: string): number {
  const tz = isValidTimeZone(zone) ? zone : DEFAULT_TIME_ZONE;
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(
    typeof date === 'number' ? new Date(date) : date,
  );
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  const left = (DAY_START_HOUR * 60 - (h * 60 + m) + 24 * 60) % (24 * 60);
  return left === 0 ? 24 * 60 : left;
}

/** The Monday of the day's week (leagues run Monday to Sunday). */
export function weekOf(day: Day): Day {
  const dow = new Date(dayToUtcMs(day)).getUTCDay(); // 0 = Sunday
  return addDays(day, -((dow + 6) % 7));
}

// ---------------------------------------------------------------------------------------------
// Levels: the spaced-repetition tracker.

export const LEVELS = ['none', 'bronze', 'silver', 'gold', 'titanium', 'diamond', 'plutonium'] as const;
export type LevelName = (typeof LEVELS)[number];
/** 0 none, 1 bronze, 2 silver, 3 gold, 4 titanium, 5 diamond, 6 plutonium. */
export type Level = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export const MAX_LEVEL: Level = 6;
/** Number of levels a scene can earn (bronze to plutonium). */
export const LEVEL_COUNT = 6;
/** On earning level m, the next can be earned WAIT_DAYS[m - 1] days later. Plutonium is the last. */
export const LEVEL_WAIT_DAYS = [1, 2, 4, 8, 16] as const;

export function levelName(m: number): LevelName {
  return LEVELS[Math.max(0, Math.min(MAX_LEVEL, Math.trunc(m)))]!;
}

export interface LevelProgress {
  level: Level;
  dueDay: Day | null; // when the next level can be earned; null with no level or at plutonium
}

export interface PassResult extends LevelProgress {
  rose: boolean; // the level went up one step
  replay: boolean; // a pass that changed nothing (a replay: before dueDay, or at plutonium)
}

/** The day the next level becomes available after earning level m on `today`, or null at the top. */
export function dueDayAfter(m: Level, today: Day): Day | null {
  if (m <= 0 || m >= MAX_LEVEL) return null;
  return addDays(today, LEVEL_WAIT_DAYS[m - 1]!);
}

/**
 * A scene was passed (a practice containing it was finished) on `today`.
 * No level: bronze. Otherwise one step up if today is on or after dueDay. Because dueDay is always
 * at least a day after a rise, a scene rises at most one step a day.
 */
export function applyPass(progress: LevelProgress, today: Day): PassResult {
  const { level, dueDay } = progress;
  const canRise = level === 0 || (level < MAX_LEVEL && (dueDay === null || compareDays(today, dueDay) >= 0));
  if (!canRise) return { level, dueDay, rose: false, replay: true };
  const next = (level + 1) as Level;
  return { level: next, dueDay: dueDayAfter(next, today), rose: true, replay: false };
}

/** True when a pass today would raise the level. */
export function isDue(progress: LevelProgress, today: Day): boolean {
  return applyPass(progress, today).rose;
}

/** Days until the next level can be earned: 0 = today, null = no more levels. */
export function daysUntilNextLevel(progress: LevelProgress, today: Day): number | null {
  if (progress.level >= MAX_LEVEL) return null;
  if (progress.level === 0 || progress.dueDay === null) return 0;
  return Math.max(0, daysBetween(today, progress.dueDay));
}

/** How many days overdue (0 when due today, negative when not yet due). For sorting reviews. */
export function overdueDays(progress: LevelProgress, today: Day): number {
  if (progress.dueDay === null) return progress.level === 0 ? 0 : -Infinity;
  return daysBetween(progress.dueDay, today);
}

// ---------------------------------------------------------------------------------------------
// Daily quests (docs/app-rules.md, "Daily quests"). Built once, at the day's first visit: up to
// MAX_WAITING_QUESTS practices that wait (levels due, most overdue first; then bronze practices
// started on an earlier day, most recently played first); then, while locked scenes are left, one
// quest to choose new scenes (DAILY_UNLOCKS of DAILY_CANDIDATES); then places for the bronze practices
// of the scenes chosen, never more than MAX_QUESTS in all. Each quest gives a chest.

export const DAILY_CANDIDATES = 10; // candidates in a draw (the day's, or one "Do more")
export const DAILY_UNLOCKS = 3; // of which the kid unlocks this many
export const CHEST_KINDS = ['wood', 'silver', 'gold'] as const;
export type ChestKind = (typeof CHEST_KINDS)[number];

export const MAX_QUESTS = 5;
/** Practices that wait take at most this many places, so there is always room for something new. */
export const MAX_WAITING_QUESTS = 3;
/** The chest of every quest "Do more" adds. */
export const EXTRA_QUEST_CHEST: ChestKind = 'wood';

/** Why a practice is a quest: its level is due, a bronze practice started on an earlier day, a scene chosen today. */
export type QuestReason = 'due' | 'continue' | 'new';

export interface WaitingPractice {
  sceneId: string;
  level: number; // the level to pass (1 bronze ... 6 plutonium)
  reason: Exclude<QuestReason, 'new'>;
}

export interface QuestPlan {
  kind: 'choose' | 'practice';
  sceneId: string | null; // practice: null for a place waiting for a scene chosen in its round
  level: number; // practice: the level to pass; 0 for choose
  reason: QuestReason | null; // practice only
  target: number; // choose: how many scenes to choose; 0 for a practice
  chest: ChestKind;
}

/** The chest of the quest at `index` among `count` of the day: the last gold, the one before silver, the others wood. */
export function questChest(index: number, count: number): ChestKind {
  if (index === count - 1) return 'gold';
  if (index === count - 2) return 'silver';
  return 'wood';
}

/**
 * The day's quests, in order. `waiting`: the practices that wait, already sorted; `candidates`: how
 * many scenes the day's draw offers (0 when every scene is unlocked: then the practices that wait may
 * take every place, and there is nothing to choose).
 */
export function planQuests(waiting: readonly WaitingPractice[], candidates: number): QuestPlan[] {
  const out: Omit<QuestPlan, 'chest'>[] = [];
  const practice = (w: WaitingPractice) => ({ kind: 'practice' as const, sceneId: w.sceneId, level: w.level, reason: w.reason, target: 0 });
  if (candidates <= 0) {
    for (const w of waiting.slice(0, MAX_QUESTS)) out.push(practice(w));
  } else {
    for (const w of waiting.slice(0, MAX_WAITING_QUESTS)) out.push(practice(w));
    const target = Math.min(DAILY_UNLOCKS, candidates);
    out.push({ kind: 'choose', sceneId: null, level: 0, reason: null, target });
    const places = Math.min(target, MAX_QUESTS - out.length);
    for (let i = 0; i < places; i++) out.push({ kind: 'practice', sceneId: null, level: 1, reason: 'new', target: 0 });
  }
  return out.map((q, i) => ({ ...q, chest: questChest(i, out.length) }));
}

/** After this many failed tries a speaking puzzle lets the kid through. */
export const SPEECH_MAX_TRIES = 3;
/** After this many wrong moves on one item a puzzle type gives the answer away. */
export const WRONG_BEFORE_REVEAL = 2;

/** Skill: the app's estimate of a kid's French, 1-5, matched against scene difficulty. */
export const SKILL_MIN = 1;
export const SKILL_MAX = 5;
export const SKILL_START = 1.5;

// ---------------------------------------------------------------------------------------------
// Questions: a joke must not get old.

/** A kid sees a given question at most this many times in all. */
export const QUESTION_MAX_SHOWS = 3;
/** Days to wait after the 1st and the 2nd showing. Never twice on one day. */
export const QUESTION_GAP_DAYS = [5, 14] as const;

export interface QuestionSeen {
  shows: number; // times shown so far
  lastDay: Day | null; // the day it was last shown
}

/** May this question be shown to the kid today? `seen` null or undefined = never shown. */
export function questionEligible(seen: QuestionSeen | null | undefined, today: Day): boolean {
  if (!seen || seen.shows <= 0 || seen.lastDay === null) return true;
  if (seen.shows >= QUESTION_MAX_SHOWS) return false;
  const gap = QUESTION_GAP_DAYS[Math.min(seen.shows, QUESTION_GAP_DAYS.length) - 1]!;
  return daysBetween(seen.lastDay, today) >= gap;
}

// ---------------------------------------------------------------------------------------------
// Streaks.

/** A kid holds at most this many streak freezes (potions). */
export const MAX_STREAK_FREEZES = 2;

export interface StreakState {
  count: number; // consecutive days with at least a light streak, counting today if done
  best: number;
  lastDay: Day | null; // last light streak day (a practice finished that day)
}

export interface StreakResult {
  streak: StreakState;
  freezes: number; // freezes left after this
  freezesUsed: number;
  extended: boolean; // the count went up today
  reset: boolean; // the streak was broken and starts again at 1
}

/**
 * A practice was finished on `today` (a light streak day). Each missed day since lastDay uses one
 * freeze, which saves that day as a light one; if there are not enough freezes the streak starts again
 * at 1 and the freezes are kept.
 */
export function streakOnPractice(streak: StreakState, freezes: number, today: Day): StreakResult {
  if (streak.lastDay === null) {
    const s = { count: 1, best: Math.max(streak.best, 1), lastDay: today };
    return { streak: s, freezes, freezesUsed: 0, extended: true, reset: false };
  }
  const gap = daysBetween(streak.lastDay, today);
  if (gap <= 0) return { streak, freezes, freezesUsed: 0, extended: false, reset: false };
  const missed = gap - 1;
  if (missed <= freezes) {
    const count = streak.count + 1;
    return {
      streak: { count, best: Math.max(streak.best, count), lastDay: today },
      freezes: freezes - missed,
      freezesUsed: missed,
      extended: true,
      reset: false,
    };
  }
  return {
    streak: { count: 1, best: Math.max(streak.best, 1), lastDay: today },
    freezes,
    freezesUsed: 0,
    extended: true,
    reset: true,
  };
}

/** The streak to show on `today`, before any practice today: 0 when it can no longer be saved. */
export function displayedStreak(streak: StreakState, freezes: number, today: Day): number {
  if (streak.lastDay === null) return 0;
  const gap = daysBetween(streak.lastDay, today);
  if (gap <= 1) return streak.count;
  return gap - 1 <= freezes ? streak.count : 0;
}

/** How a day shows in the streak: a full streak, a light streak, a missed day saved by a potion (counts as light), or nothing. */
export type StreakDayKind = 'full' | 'light' | 'saved' | 'none';
/** The streak shows this many days: today and the days before. */
export const STREAK_WEEK = 7;

/** Days on which both friends practised in a row: computed by the server from both kids' days. */
export function friendStreak(daysA: ReadonlySet<Day>, daysB: ReadonlySet<Day>, today: Day): number {
  let n = 0;
  let d = daysA.has(today) && daysB.has(today) ? today : addDays(today, -1);
  while (daysA.has(d) && daysB.has(d)) {
    n++;
    d = addDays(d, -1);
  }
  return n;
}

// ---------------------------------------------------------------------------------------------
// Rewards and XP.

export const XP = {
  puzzle: 2, // per finished puzzle
  newLevel: 10, // a practice passed at a new level
  replay: 3, // a replay finished (or a practice that passed without a new level)
  perfectPractice: 10, // no mistakes, no hints
  quest: 10, // per quest done
  view: 1, // a full watch in view mode
} as const;

export const SESTERCES = {
  quest: 5, // per quest done
  newLevel: 3,
  perfectPractice: 5, // not for a replay (XP only)
} as const;

/** Stars of a finished practice from its mistakes and hints per puzzle. Finishing is passing; stars only grade. */
export function practiceStars(puzzles: number, mistakes: number, hints: number): 1 | 2 | 3 {
  if (puzzles <= 0) return 3;
  const perPuzzle = (mistakes + hints * 0.5) / puzzles;
  if (perPuzzle <= 0.15) return 3;
  if (perPuzzle <= 0.6) return 2;
  return 1;
}

/** The kid's rank from total XP (rank 1 at 0 XP, 2 at 50, 3 at 150, 4 at 300, ...). */
export function xpRank(xp: number): number {
  let rank = 1;
  while (xp >= xpForRank(rank + 1)) rank++;
  return rank;
}

/** Total XP needed to reach a rank (rank 1 = 0). */
export function xpForRank(rank: number): number {
  const n = Math.max(1, Math.trunc(rank)) - 1;
  return 25 * n * (n + 1);
}

// ---------------------------------------------------------------------------------------------
// Leagues.

export const LEAGUE_TIERS = ['bois', 'bronze', 'argent', 'or', 'menhir'] as const; // i18n keys under social.league.tier.*
export type LeagueTier = 0 | 1 | 2 | 3 | 4;
export const LEAGUE_GROUP_SIZE = 20;
export const LEAGUE_PROMOTE = 5; // top this many go up a tier (not from the top tier)
export const LEAGUE_DEMOTE = 3; // bottom this many go down (not from the bottom tier; groups of 10 or more)

// ---------------------------------------------------------------------------------------------
// Accounts.

export const NAME_MIN = 3;
export const NAME_MAX = 20;
export const NAME_RE = /^[\p{L}\p{N}_-]{3,20}$/u;
export const PIN_RE = /^\d{3}$/;
