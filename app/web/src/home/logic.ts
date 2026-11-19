// Pure helpers for the screens around the practices: the daily quests, "come back" lists, episode
// progress numbers, the timeline layout and time texts. No DOM, no React: unit-tested in logic.test.ts.
import type { DailyState, PlayerState, Quest, ScenePractice, SceneProgress } from '../../../shared/api';
import type { ContentIndex, SceneSummary } from '../../../shared/content';
import { daysUntilNextLevel, isDue, MAX_LEVEL, type Day, type Level } from '../../../shared/rules';

// ---------------------------------------------------------------------------------------------
// Levels and waits

export type NextLevel = { state: 'now' } | { state: 'wait'; days: number } | { state: 'max' };

/** When the scene's next level can be earned. */
export function nextLevel(p: SceneProgress, today: Day): NextLevel {
  const d = daysUntilNextLevel(p, today);
  if (d === null) return { state: 'max' };
  if (d <= 0) return { state: 'now' };
  return { state: 'wait', days: d };
}

// ---------------------------------------------------------------------------------------------
// The daily quests (docs/app-rules.md, "Daily quests")

/**
 * A quest card's state on Home: `done`; `next`, the one obvious thing to do (the first quest that can
 * be done now, in order); `open`, another quest that can be done now; `locked`, the choose quest
 * waiting for the practice quests before it; `waiting`, a place for a scene not chosen yet.
 */
export type QuestState = 'done' | 'next' | 'open' | 'locked' | 'waiting';

export interface QuestCard {
  quest: Quest;
  /** Its number on Home, from 1, in order (indexes may skip a quest left out by the server). */
  number: number;
  state: QuestState;
  /** Done, and its chest is still unopened. */
  chestWaiting: boolean;
  /** A locked choose quest: the numbers of the quests it waits for. */
  waitingNumbers: number[];
}

/** Today's quests as Home shows them, the day's first, then those "Do more" added. */
export function questCards(st: Pick<PlayerState, 'daily' | 'chests'>): QuestCard[] {
  const unopened = new Set(st.chests.map((c) => c.id));
  const quests = st.daily.quests;
  const numberOf = new Map(quests.map((q, i) => [q.index, i + 1]));
  let nextGiven = false;
  return quests.map((q, i) => {
    const doable = !q.done && (q.kind === 'choose' ? !q.locked : !!q.sceneId);
    const state: QuestState = q.done ? 'done' : doable ? (nextGiven ? 'open' : 'next') : q.kind === 'choose' ? 'locked' : 'waiting';
    if (state === 'next') nextGiven = true;
    return {
      quest: q,
      number: i + 1,
      state,
      chestWaiting: q.done && q.chestId !== null && unopened.has(q.chestId),
      waitingNumbers: q.kind === 'choose' && q.locked ? q.waitingFor.map((x) => numberOf.get(x)).filter((n): n is number => n !== undefined) : [],
    };
  });
}

/** The day's quests (round 0): how many are done, of how many. */
export function dayQuestCount(daily: Pick<DailyState, 'quests'>): { done: number; total: number } {
  const day = daily.quests.filter((q) => q.round === 0);
  return { done: day.filter((q) => q.done).length, total: day.length };
}

/** The current choose quest (the latest one), or null when every scene is unlocked. */
export function currentChoose(daily: Pick<DailyState, 'quests' | 'choose'>): Quest | null {
  return daily.choose === null ? null : (daily.quests.find((q) => q.index === daily.choose) ?? null);
}

/** "1, 2 and 3" / "1, 2 et 3": quest numbers for "finish these first". */
export function listNumbers(ns: readonly number[], and: string): string {
  if (ns.length <= 1) return ns.join('');
  return `${ns.slice(0, -1).join(', ')} ${and} ${ns[ns.length - 1]}`;
}

/** Every scene of the release is unlocked (or nothing is left to offer). */
export function allUnlocked(st: Pick<PlayerState, 'progress' | 'daily'>, totalScenes: number): boolean {
  const n = Object.keys(st.progress).length;
  return n > 0 && (n >= totalScenes || st.daily.choose === null);
}

// ---------------------------------------------------------------------------------------------
// "Come back to these"

export interface ComeBack {
  sceneId: string;
  progress: SceneProgress;
  next: NextLevel;
}

/**
 * Unlocked scenes split into those whose next level can be earned today (server order first,
 * then any other due scene) and those waiting (soonest first). Plutonium scenes are left out.
 */
export function comeBackLists(state: Pick<PlayerState, 'progress' | 'daily' | 'today'>): { due: ComeBack[]; waiting: ComeBack[] } {
  const { progress, daily, today } = state;
  const seen = new Set<string>();
  const due: ComeBack[] = [];
  for (const id of daily.dueSceneIds) {
    const p = progress[id];
    if (!p || seen.has(id)) continue;
    seen.add(id);
    due.push({ sceneId: id, progress: p, next: { state: 'now' } });
  }
  const waiting: ComeBack[] = [];
  for (const [id, p] of Object.entries(progress)) {
    if (seen.has(id)) continue;
    const next = nextLevel(p, today);
    if (next.state === 'max') continue;
    if (next.state === 'now') due.push({ sceneId: id, progress: p, next });
    else waiting.push({ sceneId: id, progress: p, next });
  }
  waiting.sort((a, b) => (a.next.state === 'wait' ? a.next.days : 0) - (b.next.state === 'wait' ? b.next.days : 0) || b.progress.level - a.progress.level);
  return { due, waiting };
}

export interface QueueItem extends ComeBack {
  practice: ScenePractice | null;
}

/**
 * The practice queue: scenes with an unfinished practice first (furthest along first), then scenes
 * whose next practice can be started today, then the others by when they come back.
 */
export function practiceQueue(st: Pick<PlayerState, 'progress' | 'daily' | 'today' | 'practices'>): QueueItem[] {
  const practices = st.practices ?? {};
  const started: QueueItem[] = Object.entries(practices)
    .filter(([id]) => st.progress[id])
    .map(([sceneId, practice]) => ({ sceneId, progress: st.progress[sceneId]!, next: nextLevel(st.progress[sceneId]!, st.today), practice }))
    .sort((a, b) => frac(b.practice) - frac(a.practice));
  const { due, waiting } = comeBackLists(st);
  const rest = [...due, ...waiting].filter((c) => !practices[c.sceneId]).map((c) => ({ ...c, practice: null }));
  return [...started, ...rest];
}

function frac(p: ScenePractice | null): number {
  return p && p.total ? p.done / p.total : 0;
}

// ---------------------------------------------------------------------------------------------
// Episode progress

export interface EpisodeProgress {
  total: number;
  unlocked: number;
  /** Sum of level steps earned over the episode's scenes. */
  levelSteps: number;
  /** Most level steps possible: total x 6. */
  maxLevelSteps: number;
  /** Scenes at each level (index = level), unlocked scenes only. */
  byLevel: number[];
  due: number;
  /** 0..1, the share of level steps earned: the bar. */
  fraction: number;
}

export function episodeProgress(sceneIds: readonly string[], progress: Record<string, SceneProgress>, today: Day): EpisodeProgress {
  const byLevel = Array.from({ length: MAX_LEVEL + 1 }, () => 0);
  let unlocked = 0;
  let levelSteps = 0;
  let due = 0;
  for (const id of sceneIds) {
    const p = progress[id];
    if (!p) continue;
    unlocked++;
    levelSteps += p.level;
    byLevel[p.level]!++;
    if (isDue(p, today)) due++;
  }
  const maxLevelSteps = sceneIds.length * MAX_LEVEL;
  return { total: sceneIds.length, unlocked, levelSteps, maxLevelSteps, byLevel, due, fraction: maxLevelSteps ? levelSteps / maxLevelSteps : 0 };
}

/** Scenes at each level or better over all unlocked scenes (index = level). */
export function levelsAtLeast(progress: Record<string, SceneProgress>): number[] {
  const out = Array.from({ length: MAX_LEVEL + 1 }, () => 0);
  for (const p of Object.values(progress)) for (let m = 0; m <= p.level; m++) out[m]!++;
  return out;
}

// ---------------------------------------------------------------------------------------------
// The timeline layout

export interface TimelinePoint {
  id: string;
  /** Distance along the main axis, px from the start. */
  along: number;
  /** Offset across the axis, px from the centre line (the winding). */
  across: number;
}

export interface TimelineLayout {
  points: TimelinePoint[];
  /** Total length along the main axis, px. */
  length: number;
  /** The path through every point, for an SVG <path d>, in (across + centre, along) coordinates. */
  pathD: (centre: number) => string;
  /** Where a time in the episode falls along the main axis, px. */
  alongForMs: (ms: number) => number;
}

export interface TimelineOptions {
  /** Px per minute of episode, before spacing out clumps. */
  pxPerMinute: number;
  /** No two scenes closer than this along the axis. */
  minGap: number;
  /** Px before the first and after the last scene. */
  pad: number;
  /** Half-width of the winding, px. */
  amplitude: number;
  /** Px along the axis for one full left-right-left swing. */
  wavelength: number;
}

/**
 * Places scenes along a winding path by their time in the episode. Time decides the order and the
 * rough spacing; a forward pass then pushes scenes apart so none overlap. The winding is a sine of
 * the distance along, so the path and the scenes on it agree.
 */
export function layoutTimeline(scenes: readonly Pick<SceneSummary, 'id' | 'startMs'>[], durationMs: number, opt: TimelineOptions): TimelineLayout {
  const sorted = [...scenes].sort((a, b) => a.startMs - b.startMs);
  const raw = sorted.map((s) => opt.pad + (s.startMs / 60_000) * opt.pxPerMinute);
  const along: number[] = [];
  for (let i = 0; i < raw.length; i++) along.push(i === 0 ? Math.max(opt.pad, raw[i]!) : Math.max(raw[i]!, along[i - 1]! + opt.minGap));
  const endRaw = opt.pad + (durationMs / 60_000) * opt.pxPerMinute;
  const length = Math.max(endRaw, (along[along.length - 1] ?? 0) + opt.pad);
  const wave = (a: number) => opt.amplitude * Math.sin((a / opt.wavelength) * 2 * Math.PI);
  const points = sorted.map((s, i) => ({ id: s.id, along: along[i]!, across: wave(along[i]!) }));

  // Piecewise-linear map from episode time to distance along, through the placed scenes.
  const knotsMs = [0, ...sorted.map((s) => s.startMs), Math.max(durationMs, sorted[sorted.length - 1]?.startMs ?? 0)];
  const knotsAlong = [opt.pad, ...along, length - opt.pad];
  // Keep the map monotone (pad may exceed the first scene's raw position).
  for (let i = 1; i < knotsAlong.length; i++) knotsAlong[i] = Math.max(knotsAlong[i]!, knotsAlong[i - 1]!);
  const alongForMs = (ms: number): number => {
    if (ms <= knotsMs[0]!) return knotsAlong[0]!;
    for (let i = 1; i < knotsMs.length; i++) {
      if (ms <= knotsMs[i]!) {
        const span = knotsMs[i]! - knotsMs[i - 1]!;
        const f = span > 0 ? (ms - knotsMs[i - 1]!) / span : 1;
        return knotsAlong[i - 1]! + f * (knotsAlong[i]! - knotsAlong[i - 1]!);
      }
    }
    return knotsAlong[knotsAlong.length - 1]!;
  };

  const pathD = (centre: number) => {
    const step = 12;
    const parts: string[] = [];
    for (let a = 0; a <= length; a += step) parts.push(`${parts.length ? 'L' : 'M'}${(centre + wave(a)).toFixed(1)} ${a.toFixed(1)}`);
    return parts.join(' ');
  };
  return { points, length, pathD, alongForMs };
}

/** Time marks every `everyMin` minutes up to the episode's length. */
export function timeMarks(durationMs: number, everyMin = 5): number[] {
  const out: number[] = [];
  for (let m = everyMin; m * 60_000 < durationMs; m += everyMin) out.push(m * 60_000);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Times and numbers

/** '0:18', '1:05', '12:00'. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Scene summaries by id. */
export function scenesById(index: ContentIndex): Map<string, SceneSummary> {
  return new Map(index.scenes.map((s) => [s.id, s]));
}

/** A stable pick from a list for a day (the karaoke song of the day). */
export function pickForDay<T>(items: readonly T[], day: Day): T | undefined {
  if (!items.length) return undefined;
  let h = 0;
  for (const ch of day) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return items[h % items.length];
}

/** The level a scene shows: undefined when locked. */
export function levelOf(progress: Record<string, SceneProgress>, id: string): Level | undefined {
  return progress[id]?.level;
}

// ---------------------------------------------------------------------------------------------
// The Episodes tab: browsing what is unlocked

export type EpisodeItem = { kind: 'scene'; id: string } | { kind: 'locked'; count: number; firstId: string };

/** Scenes in episode order, every run of consecutive locked scenes collapsed into one item. */
export function collapseLocked(sceneIds: readonly string[], progress: Record<string, SceneProgress>): EpisodeItem[] {
  const out: EpisodeItem[] = [];
  for (const id of sceneIds) {
    if (progress[id]) {
      out.push({ kind: 'scene', id });
      continue;
    }
    const last = out[out.length - 1];
    if (last && last.kind === 'locked') last.count++;
    else out.push({ kind: 'locked', count: 1, firstId: id });
  }
  return out;
}

export interface DayGroup {
  day: Day;
  ids: string[];
}

/**
 * Unlocked scenes by the day they were unlocked, newest day first. Within a day the order of
 * `order` (scene ids in the order they were offered or listed) when given, else episode order.
 */
export function unlockDays(progress: Record<string, SceneProgress>, sceneOrder: readonly string[] = []): DayGroup[] {
  const rank = new Map(sceneOrder.map((id, i) => [id, i]));
  const byDay = new Map<Day, string[]>();
  for (const [id, p] of Object.entries(progress)) {
    const list = byDay.get(p.unlockedDay) ?? [];
    list.push(id);
    byDay.set(p.unlockedDay, list);
  }
  return [...byDay.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
    .map(([day, ids]) => ({ day, ids: ids.sort((a, b) => (rank.get(a) ?? Infinity) - (rank.get(b) ?? Infinity) || a.localeCompare(b)) }));
}

/** Unlocked scenes to review: next level earnable now first (lowest level first), then soonest, plutonium last. */
export function reviewOrder(progress: Record<string, SceneProgress>, today: Day): ComeBack[] {
  const rankOf = (n: NextLevel) => (n.state === 'now' ? 0 : n.state === 'wait' ? n.days : 10_000);
  return Object.entries(progress)
    .map(([sceneId, p]) => ({ sceneId, progress: p, next: nextLevel(p, today) }))
    .sort((a, b) => rankOf(a.next) - rankOf(b.next) || a.progress.level - b.progress.level || a.sceneId.localeCompare(b.sceneId));
}
