// The fixture client: the same interface as httpClient, backed by FIXTURE_PLAYER in memory.
// Selected by VITE_FIXTURES=1 (see ./index.ts). Mutations patch the state in the simplest plausible
// way; it is for building screens without a server, not a model of the real game rules.
import {
  applyPatch,
  type KaraokeRecording,
  type KaraokeTake,
  type Chest,
  type ChestKind,
  type Quest,
  type DailyState,
  type Friend,
  type LevelChange,
  type LeagueRow,
  type PlayerState,
  type PublicProfile,
  type ScenePractice,
  type StatePatch,
} from '../../../shared/api';
import { DEFAULT_AVATAR, ITEMS, ITEMS_BY_ID } from '../../../shared/catalog';
import { FIXTURE_INDEX } from '../../../shared/fixtures';
import { FIXTURE_PLAYER } from '../../../shared/fixtures/player';
import { FIXTURE_SCENE } from '../../../shared/fixtures/scene';
import type { PracticePlan } from '../../../shared/practice/types';
import { addDays, applyPass, DAILY_CANDIDATES, DAILY_UNLOCKS, isDue, MAX_LEVEL, MAX_STREAK_FREEZES, questChest, xpRank, type Level } from '../../../shared/rules';
import { checkTake, KARAOKE_TAKES_PER_DAY } from '../../../shared/karaoke';
import { scoreSpeech } from '../../../shared/speech';
import { RequestAbandoned, type ApiClient } from './client';
import { ApiRequestError } from './errors';
import { loadScene, loadSong } from './content';

/** The player scenarios of ?flow=<name> ("Daily quests" below); declared first, as the state below reads it. */
export const FIXTURE_FLOWS = ['due', 'continue', 'fresh', 'calm', 'one', 'mid', 'done', 'more', 'all'] as const;
export type FixtureFlow = (typeof FIXTURE_FLOWS)[number];

let state: PlayerState = /*#__PURE__*/ withFlow(structuredClone(FIXTURE_PLAYER), flowFromUrl());
let counter = 1;
const plans = new Map<string, PracticePlan>();
/** Karaoke takes checked and not kept, by song, with the uploaded WAV (served once kept, as an object URL). */
const takes = new Map<string, { take: KaraokeTake; wav: Blob }>();
let takesChecked = 0;

const delay = <T>(value: T, ms = 120): Promise<T> => new Promise((r) => setTimeout(() => r(structuredClone(value)), ms));
const fail = (status: number, code: ConstructorParameters<typeof ApiRequestError>[1]) => Promise.reject(new ApiRequestError(status, code));

function commit(patch: StatePatch): StatePatch {
  state = applyPatch(state, patch);
  return patch;
}

/** Commit, then show the started practices' progress on their quests (as the server does). */
function commitFlow(patch: StatePatch): StatePatch {
  state = applyPatch(state, patch);
  const daily = withQuestProgress(state.daily, state.practices);
  state = applyPatch(state, { daily });
  return { ...patch, daily };
}

function withQuestProgress(d: DailyState, practices: Record<string, ScenePractice>): DailyState {
  const quests = d.quests.map((q) => {
    const p = q.kind === 'practice' && q.sceneId && !q.done ? practices[q.sceneId] : undefined;
    return { ...q, practice: p && !p.replay && p.level === q.level ? p : null };
  });
  const waitingFor = (i: number) => quests.filter((q, j) => j < i && q.kind === 'practice' && q.round === quests[i]!.round && !q.done).map((q) => q.index);
  return {
    ...d,
    quests: quests.map((q, i) => (q.kind === 'choose' && !q.done ? { ...q, waitingFor: waitingFor(i), locked: waitingFor(i).length > 0 } : q)),
    questsDone: quests.filter((q) => q.round === 0).every((q) => q.done),
    doMore: d.choose !== null && quests.every((q) => q.done),
  };
}

// --- Daily quests -------------------------------------------------------------------------------
// A scenario can be picked with ?flow=<name> in fixture mode (screenshots, docs/app-dev.md):
// due (the default, after a long absence): three due practices, the choose quest locked behind them,
// one bronze place; continue: the same with the first due practice started (12 / 40); fresh: a
// brand-new kid (choose and three bronze places); calm: nothing due (choose and three bronze places);
// one: one due practice, the choose quest locked behind it, three bronze places; mid: mid-day, two of
// three scenes chosen, the first one's bronze practice half done; done: every quest done ("Do more");
// more: after "Do more" (its extra choose quest and places, its fresh candidates); all: every scene
// unlocked (no choose quest).

function flowFromUrl(): FixtureFlow {
  try {
    const f = new URLSearchParams(globalThis.location?.search ?? '').get('flow');
    if ((FIXTURE_FLOWS as readonly string[]).includes(f ?? '')) return f as FixtureFlow;
  } catch {
    // no location (tests)
  }
  return 'due';
}

/** DAILY_CANDIDATES locked scenes of the fixture index not offered yet today, for a "Do more" draw. */
function freshCandidates(st: PlayerState, n = DAILY_CANDIDATES): string[] {
  const offered = new Set(st.daily.candidates.map((c) => c.sceneId));
  return FIXTURE_INDEX.scenes.map((x) => x.id).filter((id) => !st.progress[id] && !offered.has(id)).filter((_, i) => i % 7 === 3).slice(0, n);
}

/** The choose quest and bronze places of a round, from `from` on (chests by position, extra ones wood). */
function chooseRound(from: number, round: number, total: number, over: Partial<Quest> = {}): Quest[] {
  const base = { round, extra: round > 0, done: false, chestId: null, practice: null, chosen: 0, target: 0, locked: false, waitingFor: [] as number[] };
  const chest = (i: number): ChestKind => (round > 0 ? 'wood' : questChest(i, total));
  return [
    { ...base, index: from, kind: 'choose', chest: chest(from), sceneId: null, level: 0, reason: null, target: DAILY_UNLOCKS, ...over },
    ...[1, 2, 3].map((k) => ({ ...base, index: from + k, kind: 'practice' as const, chest: chest(from + k), sceneId: null, level: 1, reason: 'new' as const })).filter((q) => q.index < total),
  ];
}

/** FIXTURE_PLAYER in one of a few scenarios. */
export function withFlow(st: PlayerState, flow: FixtureFlow = 'due'): PlayerState {
  const next: PlayerState = { ...st, practices: {} };
  const q = st.daily.quests;
  const later = Object.fromEntries(Object.entries(st.progress).map(([id, p]) => [id, { ...p, dueDay: p.level > 0 ? addDays(st.today, 2) : null }]));
  if (flow === 'continue') {
    next.practices = { [q[0]!.sceneId!]: { practiceId: 'l_fixture_cont', level: q[0]!.level, replay: false, done: 12, total: 40 } };
  } else if (flow === 'fresh') {
    next.progress = {};
    next.chests = [];
    next.currencies = { ...st.currencies, xp: 0 };
    next.streak = { ...st.streak, count: 0, best: 0, lastDay: null, week: st.streak.week.map((x) => ({ ...x, kind: 'none' as const })) };
    next.stats = { ...st.stats, practicesFinished: 0 };
    next.daily = { ...st.daily, dueSceneIds: [], choose: 0, quests: chooseRound(0, 0, 4) };
  } else if (flow === 'calm') {
    next.progress = later;
    next.daily = { ...st.daily, dueSceneIds: [], choose: 0, quests: chooseRound(0, 0, 4) };
  } else if (flow === 'one') {
    const due = q[0]!;
    next.progress = { ...later, [due.sceneId!]: st.progress[due.sceneId!]! };
    next.daily = { ...st.daily, dueSceneIds: [due.sceneId!], choose: 1, quests: [{ ...due, chest: questChest(0, 5) }, ...chooseRound(1, 0, 5, { locked: true, waitingFor: [0] })] };
  } else if (flow === 'mid') {
    const chosen = st.daily.candidates.slice(0, 2).map((c) => c.sceneId);
    next.progress = { ...later, ...Object.fromEntries(chosen.map((id) => [id, { level: 0 as Level, dueDay: null, passes: 0, unlockedDay: st.today, views: 0, lastPassDay: null }])) };
    next.practices = { [chosen[0]!]: { practiceId: 'l_fixture_mid', level: 1, replay: false, done: 14, total: 30 } };
    next.daily = {
      ...st.daily,
      dueSceneIds: [],
      choose: 0,
      unlocksLeft: 1,
      candidates: st.daily.candidates.map((c, i) => ({ ...c, unlocked: i < 2 })),
      quests: chooseRound(0, 0, 4, { chosen: 2 }).map((x) => (x.index === 1 || x.index === 2 ? { ...x, sceneId: chosen[x.index - 1]! } : x)),
    };
  } else if (flow === 'done' || flow === 'more') {
    const chosen = st.daily.candidates.slice(0, 3).map((c) => c.sceneId);
    next.progress = { ...st.progress, ...Object.fromEntries(chosen.map((id) => [id, { level: 1 as Level, dueDay: addDays(st.today, 1), passes: 1, unlockedDay: st.today, views: 0, lastPassDay: st.today }])) };
    next.streak = { ...st.streak, count: st.streak.count + 1, lastDay: st.today, doneToday: true, fullToday: true, week: st.streak.week.map((x, i, all) => (i === all.length - 1 ? { ...x, kind: 'full' as const } : x)) };
    next.daily = {
      ...st.daily,
      candidates: st.daily.candidates.map((c, i) => ({ ...c, unlocked: i < 3 })),
      unlocksLeft: 0,
      dueSceneIds: [],
      quests: q.map((x, i) => ({
        ...x,
        done: true,
        chestId: `c_flow${i}`,
        locked: false,
        waitingFor: [],
        ...(x.kind === 'choose' ? { chosen: 3 } : x.sceneId ? {} : { sceneId: chosen[0]! }),
      })),
      questsDone: true,
      doMore: true,
    };
    if (flow === 'more') {
      const candidates = freshCandidates(next).map((sceneId) => ({ sceneId, unlocked: false }));
      next.daily = { ...next.daily, round: 1, choose: 5, candidates, unlocksLeft: DAILY_UNLOCKS, doMore: false, quests: [...next.daily.quests, ...chooseRound(5, 1, 9)] };
    }
  } else if (flow === 'all') {
    next.daily = { ...st.daily, candidates: [], unlocksLeft: 0, choose: null, quests: q.filter((x) => x.kind === 'practice' && x.sceneId) };
  }
  next.daily = withQuestProgress(next.daily, next.practices);
  return next;
}

/** Reset the in-memory state (tests and the dev gallery). */
export function resetFixtureState(next: PlayerState = FIXTURE_PLAYER): void {
  state = structuredClone(next);
  plans.clear();
}

const friendsList: Friend[] = [
  { id: 'u_f1', name: 'sanglier-rieur', avatar: DEFAULT_AVATAR, xpRank: 4, streak: 6, following: true, followsMe: true, friendStreak: 3, practisedToday: true, weekXp: 240 },
  { id: 'u_f2', name: 'menhir-dansant', avatar: DEFAULT_AVATAR, xpRank: 2, streak: 0, following: true, followsMe: false, friendStreak: 0, practisedToday: false, weekXp: 60 },
];

const others: PublicProfile[] = [
  { id: 'u_o1', name: 'druide-distrait', avatar: DEFAULT_AVATAR, xpRank: 3, streak: 2, following: false, followsMe: false },
  { id: 'u_o2', name: 'barde-bavard', avatar: DEFAULT_AVATAR, xpRank: 5, streak: 11, following: false, followsMe: true },
];

export const fixtureClient: ApiClient = {
  gate: () => delay(undefined),
  session: () => delay({ state, created: false }),
  login: (req) => (req.pin === state.profile.pin ? delay({ state }) : fail(401, 'bad-credentials')),
  // The fixture kid is the only one: logging out starts it again from the fixtures.
  logout: () => {
    state = withFlow(structuredClone(FIXTURE_PLAYER), flowFromUrl());
    plans.clear();
    return delay({ deleted: false });
  },
  me: () => delay({ state }),

  patchMe: (req) => {
    const { seenAchievements, ...profile } = req;
    const patch: StatePatch = {};
    if (Object.keys(profile).length) patch.profile = { ...profile, ...(profile.name ? { nameChosen: true } : {}) };
    if (seenAchievements?.length) {
      patch.achievements = Object.fromEntries(
        seenAchievements.filter((id) => state.achievements[id]).map((id) => [id, { ...state.achievements[id]!, seen: true }]),
      );
    }
    return delay({ patch: commit(patch) });
  },

  daily: () => delay({ daily: state.daily, patch: { daily: state.daily } }),

  unlock: (sceneId) => {
    const d = state.daily;
    const choose = d.choose !== null ? d.quests.find((q) => q.index === d.choose) : undefined;
    const candidate = d.candidates.find((o) => o.sceneId === sceneId);
    if (!choose || !candidate) return fail(400, 'not-offered');
    if (candidate.unlocked || state.progress[sceneId]) return fail(400, 'already-unlocked');
    if (choose.done || d.unlocksLeft <= 0) return fail(400, 'no-unlocks-left');
    if (choose.locked) return fail(409, 'choose-locked');
    const chosen = choose.chosen + 1;
    const chest: Chest | null = chosen >= choose.target ? { id: `c_fixture${counter++}`, kind: choose.chest, source: 'quest', earnedDay: state.today } : null;
    let placed = false;
    const quests = d.quests.map((q) => {
      if (q.index === choose.index) return { ...q, chosen, done: !!chest, chestId: chest?.id ?? null };
      if (!placed && q.kind === 'practice' && q.round === choose.round && !q.sceneId) {
        placed = true;
        return { ...q, sceneId };
      }
      return q;
    });
    const daily: DailyState = { ...d, quests, candidates: d.candidates.map((o) => (o.sceneId === sceneId ? { ...o, unlocked: true } : o)), unlocksLeft: d.unlocksLeft - 1 };
    const patch = commitFlow({
      progress: { [sceneId]: { level: 0, dueDay: null, passes: 0, unlockedDay: state.today, views: 0, lastPassDay: null } },
      daily,
      stats: { scenesUnlocked: (state.stats.scenesUnlocked ?? 0) + 1 },
      ...(chest ? { chests: { add: [chest] } } : {}),
    });
    return delay({ quest: chest ? { index: choose.index, chest } : null, patch });
  },

  more: () => {
    const d = state.daily;
    if (!d.doMore) return fail(409, 'more-unavailable');
    const ids = freshCandidates(state);
    if (!ids.length) return fail(409, 'more-unavailable');
    const from = Math.max(...d.quests.map((q) => q.index)) + 1;
    const round = d.round + 1;
    const quests = [...d.quests, ...chooseRound(from, round, from + 1 + Math.min(DAILY_UNLOCKS, ids.length), { target: Math.min(DAILY_UNLOCKS, ids.length) })];
    const daily: DailyState = { ...d, round, choose: from, quests, candidates: ids.map((sceneId) => ({ sceneId, unlocked: false })), unlocksLeft: Math.min(DAILY_UNLOCKS, ids.length), doMore: false };
    const patch = commitFlow({ daily });
    return delay({ daily: state.daily, patch });
  },

  startPractice: (req) => {
    if (req.kind === 'resume') {
      const known = plans.get(req.practiceId);
      return known ? delay({ plan: known, patch: {} }) : fail(409, 'practice-closed');
    }
    const p = state.progress[req.sceneId];
    if (!p) return fail(403, 'scene-locked');
    const started = state.practices[req.sceneId];
    const known = started && plans.get(started.practiceId);
    if (known) return delay({ plan: known, patch: {} });
    const replay = !isDue(p, state.today);
    const level = replay ? p.level : Math.min(MAX_LEVEL, p.level + 1);
    const done = started?.done ?? 0;
    const plan: PracticePlan = {
      id: started?.practiceId ?? `l_fixture${counter++}`,
      seed: Math.floor(Math.random() * 1e9),
      entries: [{ sceneId: req.sceneId, level, due: !replay }],
      focusUnitIds: [],
      speak: state.profile.speak,
      // Every question of the plan's scene: the fixture scene's, and the export's '<scene id>:q<n>' ids.
      allowedQuestionIds: [...FIXTURE_SCENE.questions.map((q) => q.id), ...Array.from({ length: 12 }, (_, i) => `${req.sceneId}:q${i + 1}`)],
      sceneId: req.sceneId,
      level,
      replay,
      done,
      total: started?.total ?? null,
      outcomes: [],
      composerVersion: req.composerVersion ?? null,
    };
    plans.set(plan.id, plan);
    return delay({ plan, patch: commitFlow({ practices: { [plan.sceneId]: { practiceId: plan.id, level, replay, done, total: plan.total } } }) });
  },

  // Progress of a long practice: kept per practice in memory; credits only puzzle XP (the fixture is for UI work).
  practiceProgress: (practiceId, req) => {
    const plan = plans.get(practiceId);
    if (!plan) return fail(409, 'practice-closed');
    const done = Math.max(plan.done ?? 0, req.done);
    const total = req.total ?? plan.total ?? null;
    plans.set(practiceId, { ...plan, done, total, outcomes: req.outcomes });
    const patch: StatePatch = { practices: { [plan.sceneId]: { practiceId, level: plan.level, replay: plan.replay, done, total } } };
    const xp = Math.max(0, done - (plan.done ?? 0)) * 2;
    if (xp) patch.currencies = { xp: state.currencies.xp + xp };
    return delay({ done, xp, patch: commitFlow(patch) });
  },
  completePractice: (practiceId, req) => {
    const plan = plans.get(practiceId);
    if (!plan) return fail(409, 'practice-closed');
    plans.delete(practiceId);
    const mistakes = req.outcomes.reduce((n, o) => n + o.mistakes, 0);
    const hints = req.outcomes.reduce((n, o) => n + o.hints, 0);
    const levels: LevelChange[] = [];
    const replayed: string[] = [];
    const p = state.progress[plan.sceneId] ?? { level: 0 as Level, dueDay: null, passes: 0, unlockedDay: state.today, views: 0, lastPassDay: null };
    const r = plan.replay ? { level: p.level, dueDay: p.dueDay, rose: false } : applyPass(p, state.today);
    if (r.rose) levels.push({ sceneId: plan.sceneId, from: p.level, to: r.level, dueDay: r.dueDay });
    else replayed.push(plan.sceneId);
    const xp = req.outcomes.length * 2 + levels.length * 10;
    const sesterces = plan.replay ? 0 : 5;
    const before = xpRank(state.currencies.xp);
    const quest = plan.replay ? undefined : state.daily.quests.find((q) => q.kind === 'practice' && !q.done && q.sceneId === plan.sceneId && q.level === plan.level);
    const chest: Chest | null = quest ? { id: `c_fixture${counter++}`, kind: quest.chest, source: 'quest', earnedDay: state.today } : null;
    const quests = state.daily.quests.map((q) => (quest && q.index === quest.index ? { ...q, done: true, chestId: chest!.id } : q));
    const fullToday = quests.filter((q) => q.round === 0).every((q) => q.done);
    const week = state.streak.week.map((x, i, all) => (i === all.length - 1 ? { ...x, kind: fullToday ? ('full' as const) : ('light' as const) } : x));
    const streak = state.streak.doneToday
      ? { ...state.streak, fullToday, week }
      : { ...state.streak, count: state.streak.count + 1, best: Math.max(state.streak.best, state.streak.count + 1), lastDay: state.today, doneToday: true, fullToday, week };
    const patch: StatePatch = {
      progress: { [plan.sceneId]: { ...p, level: r.level, dueDay: r.dueDay, passes: p.passes + (plan.replay ? 0 : 1), lastPassDay: state.today } },
      practices: { [plan.sceneId]: null },
      currencies: { xp: state.currencies.xp + xp, sesterces: state.currencies.sesterces + sesterces },
      streak,
      stats: { practicesFinished: (state.stats.practicesFinished ?? 0) + 1 },
      daily: { ...state.daily, quests, dueSceneIds: state.daily.dueSceneIds.filter((id) => !levels.some((m) => m.sceneId === id)) },
      ...(chest ? { chests: { add: [chest] } } : {}),
    };
    const after = xpRank(state.currencies.xp + xp);
    return delay({
      patch: commitFlow(patch),
      level: plan.level,
      replay: plan.replay,
      stars: mistakes + hints === 0 ? 3 : mistakes + hints < 5 ? 2 : 1,
      rewards: { xp, sesterces },
      quest: quest && chest ? { index: quest.index, chest } : null,
      chest,
      levels,
      replayed,
      achievements: [],
      achievementRewards: {},
      streak: { count: streak.count, extended: !state.streak.doneToday, freezesUsed: 0, reset: false, full: fullToday && !state.streak.fullToday },
      rankUp: after > before ? after : null,
    });
  },

  viewScene: (sceneId) => {
    const p = state.progress[sceneId];
    if (!p) return fail(400, 'scene-locked');
    return delay({ patch: commit({ progress: { [sceneId]: { ...p, views: p.views + 1 } }, stats: { scenesViewed: (state.stats.scenesViewed ?? 0) + 1 } }) });
  },

  // "Quelque chose ne va pas ?": nothing to store without a server.
  report: () => delay({ id: counter++ }),

  // Karaoke recordings, in memory: the take is checked like the server does, against the dev test
  // transcript (?transcript=…; clean when there is none). '!unavailable' answers 503 like a server out
  // of Workers AI. The audio stays in the page (an object URL); a reload forgets it.
  karaokeTake: async (songId, wav, offsetMs, opts) => {
    if (opts?.signal?.aborted) throw new RequestAbandoned();
    if (opts?.testTranscript === '!unavailable') return fail(503, 'speech-unavailable');
    if (takesChecked >= KARAOKE_TAKES_PER_DAY) return fail(429, 'rate-limited');
    const song = await loadSong(songId).catch(() => null);
    if (!song) return fail(404, 'not-found');
    takesChecked++;
    const check = checkTake(opts?.testTranscript ?? '', song.lines.map((l) => l.fr));
    const answer = async <T,>(v: T): Promise<T> => {
      const r = await delay(v, 900);
      if (opts?.signal?.aborted) throw new RequestAbandoned();
      return r;
    };
    if (!check.ok) return answer({ verdict: 'refused' as const, take: null, patch: {} });
    const durationMs = Math.round(((wav.size - 44) / 32000) * 1000);
    const take: KaraokeTake = { id: `k_fixture${counter++}`, songId, offsetMs: Math.max(0, Math.round(offsetMs)), durationMs };
    takes.set(songId, { take, wav });
    return answer({ verdict: 'ok' as const, take, patch: {} });
  },
  karaokeSave: (songId, takeId) => {
    const kept = state.recordings?.[songId];
    if (kept?.id === takeId) return delay({ recording: kept, patch: { recordings: { [songId]: kept } } }); // a retried tap
    const t = takes.get(songId);
    if (!t || t.take.id !== takeId) return fail(409, 'no-take');
    takes.delete(songId);
    if (kept) URL.revokeObjectURL(kept.url);
    const recording: KaraokeRecording = { ...t.take, url: URL.createObjectURL(t.wav) };
    return delay({ recording, patch: commit({ recordings: { [songId]: recording } }) });
  },
  karaokeDrop: (songId) => {
    takes.delete(songId);
    return delay(undefined);
  },
  karaokeRemove: (songId) => {
    const old = state.recordings?.[songId];
    if (old) URL.revokeObjectURL(old.url);
    return delay({ patch: commit({ recordings: { [songId]: null } }) });
  },

  events: (req) => {
    const stats: StatePatch['stats'] = {};
    for (const e of req.events) stats[e.stat] = (stats[e.stat] ?? state.stats[e.stat] ?? 0) + e.n;
    return delay({ patch: commit({ stats }) });
  },

  // Scores like the server: against the real line or unit, with the dev test transcript when given
  // (the kid said it perfectly otherwise). '!unavailable' answers 503 like a server out of Workers AI.
  // Scores like the server: against the real line, unit, alternate or the choice's candidates, with
  // the dev test transcript when given (the kid said it perfectly otherwise). '!unavailable' answers
  // 503 like a server out of Workers AI.
  speech: async (q, _wav, opts) => {
    if (opts?.testTranscript === '!unavailable') return fail(503, 'speech-unavailable');
    const t0 = Date.now();
    const scene = await loadScene(q.scene).catch(() => FIXTURE_SCENE);
    type Alt = { fr: string };
    const altsOf = (id: string) => ((scene.lines.find((l) => l.id === id) as { alternates?: Alt[] } | undefined)?.alternates ?? []).map((a) => a.fr);
    let candidates: string[] = [];
    if (q.line) candidates = [scene.lines.find((l) => l.id === q.line)?.fr ?? ''];
    else if (q.unit) candidates = [scene.lines.flatMap((l) => l.units).find((u) => u.id === q.unit)?.fr ?? ''];
    else if (q.alt) {
      const [id, k] = [q.alt.slice(0, q.alt.lastIndexOf(':')), Number(q.alt.slice(q.alt.lastIndexOf(':') + 1))];
      candidates = [altsOf(id)[k] ?? ''];
    } else if (q.choice) candidates = [scene.lines.find((l) => l.id === q.choice)?.fr ?? '', ...altsOf(q.choice)];
    if (!candidates[0]) candidates = [FIXTURE_SCENE.lines[0]!.fr];
    const transcript = opts?.testTranscript ?? candidates[0]!;
    const kind = q.unit ? 'unit' : 'line';
    const scored = candidates.map((c) => scoreSpeech(c, transcript, { kind }));
    let best = 0;
    scored.forEach((sc, i) => {
      if (sc.score > scored[best]!.score) best = i;
    });
    const sc = scored[best]!;
    return delay(
      {
        transcript,
        score: sc.score,
        pass: sc.pass,
        matched: sc.expectedWords.map((word, i) => ({ word, ok: !!sc.matched[i] })),
        expectedWords: sc.expectedWords,
        heardWords: sc.heardWords,
        ...(q.choice ? { choice: { index: best, scores: scored.map((x) => x.score) } } : {}),
        ...(q.debug ? { debug: { hint: q.hint === 'names' ? 'names' : `names + ${candidates.join(' | ')}`, ms: Date.now() - t0 + 600, raw: transcript, attempt: q.attempt ?? 1 } } : {}),
        patch: {},
      },
      600,
    );
  },

  openChest: (chestId) => {
    const chest = state.chests.find((c) => c.id === chestId);
    if (!chest) return fail(404, 'not-found');
    const loot = { sesterces: chest.kind === 'gold' ? 40 : chest.kind === 'silver' ? 25 : 10, items: chest.kind === 'wood' ? [] : ['squeaky-lyre'] };
    const inventory: Record<string, number> = {};
    for (const id of loot.items) inventory[id] = (state.inventory[id] ?? 0) + 1;
    return delay({
      chest,
      loot,
      patch: commit({
        chests: { remove: [chestId] },
        currencies: { sesterces: state.currencies.sesterces + loot.sesterces },
        inventory,
        stats: { chestsOpened: (state.stats.chestsOpened ?? 0) + 1 },
      }),
    });
  },

  shop: () =>
    delay({
      offers: ITEMS.filter((i) => i.price !== null).map((i, n) => ({ itemId: i.id, price: i.price!, owned: state.inventory[i.id] ?? 0, featured: n === 0 })),
      potionPrice: state.currencies.potions >= MAX_STREAK_FREEZES ? null : 30,
      refreshesDay: state.today,
    }),

  buy: (req) => {
    if ('potion' in req) {
      if (state.currencies.potions >= MAX_STREAK_FREEZES) return fail(400, 'potions-full');
      if (state.currencies.sesterces < 30) return fail(400, 'not-enough-sesterces');
      return delay({ patch: commit({ currencies: { sesterces: state.currencies.sesterces - 30, potions: state.currencies.potions + 1 } }) });
    }
    const item = ITEMS_BY_ID.get(req.itemId);
    if (!item || item.price === null) return fail(404, 'not-found');
    if ((state.inventory[item.id] ?? 0) > 0) return fail(409, 'already-owned');
    if (state.currencies.sesterces < item.price) return fail(400, 'not-enough-sesterces');
    return delay({
      patch: commit({
        currencies: { sesterces: state.currencies.sesterces - item.price },
        inventory: { [item.id]: (state.inventory[item.id] ?? 0) + 1 },
      }),
    });
  },

  search: (q) => delay({ users: [...friendsList, ...others].filter((u) => u.name.includes(q.toLowerCase())) }),

  follow: (userId) => {
    const u = [...friendsList, ...others].find((x) => x.id === userId);
    if (!u) return fail(404, 'not-found');
    u.following = true;
    return delay({ user: u, patch: commit({ stats: { follows: (state.stats.follows ?? 0) + 1 } }) });
  },

  unfollow: (userId) => {
    const u = [...friendsList, ...others].find((x) => x.id === userId);
    if (!u) return fail(404, 'not-found');
    u.following = false;
    return delay({ user: u, patch: commit({ stats: { follows: Math.max(0, (state.stats.follows ?? 0) - 1) } }) });
  },

  friends: () =>
    delay({
      friends: friendsList.filter((f) => f.following),
      feed: [
        { id: 'fd1', user: friendsList[0]!, kind: 'level' as const, day: state.today, sceneId: FIXTURE_SCENE.id, level: 3 as Level, cheeredByMe: false },
        { id: 'fd2', user: friendsList[0]!, kind: 'streak' as const, day: state.today, count: 6, cheeredByMe: true },
      ],
    }),

  gift: (req) => {
    if (req.gift.kind === 'potion') {
      if (state.currencies.potions < 1) return fail(400, 'not-owned');
      return delay({ patch: commit({ currencies: { potions: state.currencies.potions - 1 }, stats: { giftsSent: (state.stats.giftsSent ?? 0) + 1 } }) });
    }
    if (req.gift.kind === 'item') {
      const n = state.inventory[req.gift.itemId] ?? 0;
      if (n < 1) return fail(400, 'not-owned');
      return delay({ patch: commit({ inventory: { [req.gift.itemId]: n - 1 }, stats: { giftsSent: (state.stats.giftsSent ?? 0) + 1 } }) });
    }
    return delay({ patch: commit({ stats: { cheersSent: (state.stats.cheersSent ?? 0) + 1 } }) });
  },

  inbox: () =>
    delay({
      entries: [{ id: 'in1', from: friendsList[0]!, gift: { kind: 'cheer' as const, cheerId: 'par-toutatis' }, day: state.today, seen: state.inboxUnread === 0 }],
      patch: commit({ inboxUnread: 0 }),
    }),

  league: () => {
    const names = ['sanglier-rieur', 'barde-bavard', 'druide-distrait', state.profile.name, 'menhir-dansant', 'poisson-pas-frais', 'centurion-perdu', 'chat-gaulois'];
    const xps = [240, 220, 201, state.league?.weekXp ?? 0, 60, 45, 12, 0];
    const rows: LeagueRow[] = names
      .map((name, i) => ({ userId: name === state.profile.name ? state.profile.id : `u_l${i}`, name, avatar: DEFAULT_AVATAR, weekXp: xps[i]!, rank: 0, me: name === state.profile.name }))
      .sort((a, b) => b.weekXp - a.weekXp)
      .map((r, i) => ({ ...r, rank: i + 1 }));
    return delay({ week: '2026-11-09', endsDay: '2026-11-15', tier: state.league?.tier ?? 0, rows, promote: 3, demote: 0 });
  },
};
