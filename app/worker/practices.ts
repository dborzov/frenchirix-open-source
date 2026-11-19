// The practice routes: a practice is on one scene at one level; a replay is the practice at the scene's
// current level when its next level is not due (XP only). The server picks what to play and stores the
// seed; the client composes it (composePractice), plays it from start to end and saves progress after
// every puzzle; the server credits XP as puzzles finish and, when the practice is finished, passes the
// scene (the level), counts the day for the streak and does the quest it was. The rules: docs/app-rules.md.
import { Hono } from 'hono';
import type {
  PracticeCompleteRequest,
  PracticeCompleteResponse,
  PracticeProgressRequest,
  PracticeProgressResponse,
  PracticeStartRequest,
  PracticeStartResponse,
  LevelChange,
  StatePatch,
  StreakChange,
} from '../shared/api';
import type { Reward } from '../shared/catalog';
import { randomSeed } from '../shared/practice/rng';
import type { PracticePlan, PuzzleOutcome } from '../shared/practice/types';
import { SKILL_MAX, SKILL_MIN, MAX_LEVEL, SESTERCES, XP, addDays, applyPass, isDue, practiceStars, questionEligible, streakOnPractice, xpRank, type Level } from '../shared/rules';
import { logTx } from './activity';
import { getContent, getScene, inScene, type Content } from './content';
import { dailyState, ensureDaily, focusUnits, weakUnits } from './daily';
import type { AppEnv } from './env';
import { openPractices, releaseProgress, scenePracticeRow, scenePractices, type PracticeRow } from './practice-pick';
import { creditPractice, markFullIfDone } from './quests';
import { runTx } from './session';
import type { UserTx } from './tx';
import { clampInt, cryptoRandom, fail, jsonBody, randomId } from './util';

export const STREAK_MILESTONES = [3, 5, 7, 10, 14, 21, 30, 50, 75, 100, 150, 200, 365];
/** Skill step per practice: up for a clean one, down for a messy one. */
export const SKILL_STEP = 0.1;
const MAX_OUTCOMES = 120;
const MAX_PUZZLES = 200;

interface StoredPlan {
  entries: { sceneId: string; level: number; due: boolean }[];
  focusUnitIds: string[];
  speak: boolean;
  allowedQuestionIds?: string[];
}

const parseJson = <T>(s: string | null | undefined, fallback: T): T => {
  try {
    const v = JSON.parse(s ?? '');
    return v ?? fallback;
  } catch {
    return fallback;
  }
};

export function planOf(row: PracticeRow): PracticePlan {
  const p = parseJson<StoredPlan>(row.plan, { entries: [], focusUnitIds: [], speak: true });
  const plan: PracticePlan = {
    id: row.id,
    seed: row.seed,
    entries: p.entries,
    focusUnitIds: p.focusUnitIds,
    speak: p.speak,
    allowedQuestionIds: p.allowedQuestionIds ?? [],
    sceneId: row.scene_id,
    level: row.level,
    replay: !!row.replay,
    done: row.done,
    total: row.total,
    outcomes: parseJson<PuzzleOutcome[]>(row.outcomes, []),
    composerVersion: row.composer_version,
  };
  if (row.content_version) plan.contentVersion = row.content_version;
  return plan;
}

async function loadPractice(tx: UserTx, id: string): Promise<PracticeRow | null> {
  return tx.db.prepare('SELECT * FROM practices WHERE id = ? AND user_id = ? AND level IS NOT NULL').bind(id, tx.id).first<PracticeRow>();
}

/** Question ids of these scenes. */
async function sceneQuestionIds(tx: UserTx, sceneIds: string[]): Promise<string[]> {
  const scenes = await Promise.all(sceneIds.map((id) => getScene(tx.env, id)));
  return scenes.flatMap((s) => (s?.questions ?? []).map((q) => q.id));
}

/** The questions of these scenes this kid may see today (rules.questionEligible). */
export async function allowedQuestions(tx: UserTx, sceneIds: string[]): Promise<string[]> {
  const ids = await sceneQuestionIds(tx, sceneIds);
  if (!ids.length) return [];
  const r = await tx.db
    .prepare(`SELECT question_id, shows, last_day FROM question_seen WHERE user_id = ? AND question_id IN (${ids.map(() => '?').join(',')})`)
    .bind(tx.id, ...ids)
    .all<{ question_id: string; shows: number; last_day: string }>();
  const seen = new Map(r.results.map((x) => [x.question_id, { shows: x.shows, lastDay: x.last_day }]));
  const today = tx.today;
  return ids.filter((id) => questionEligible(seen.get(id), today));
}

/** A new practice (or replay) row; returned as a plan. A new replay drops the scene's other open replays. */
async function makePractice(tx: UserTx, o: { sceneId: string; level: number; replay: boolean; content: string; composer: number | null }): Promise<PracticePlan> {
  const weak = await weakUnits(tx);
  const plan: StoredPlan = {
    entries: [{ sceneId: o.sceneId, level: o.level, due: !o.replay }],
    focusUnitIds: focusUnits(weak, [o.sceneId]),
    speak: !!tx.u.speak,
    allowedQuestionIds: await allowedQuestions(tx, [o.sceneId]),
  };
  const row: PracticeRow = {
    id: randomId('l'),
    user_id: tx.id,
    day: tx.today,
    seed: (randomSeed() ^ Math.floor(cryptoRandom() * 0x100000000)) >>> 0,
    plan: JSON.stringify(plan),
    status: 'open',
    scene_id: o.sceneId,
    level: o.level,
    replay: o.replay ? 1 : 0,
    done: 0,
    total: null,
    outcomes: '[]',
    credited_xp: 0,
    content_version: o.content,
    composer_version: o.composer,
    played_at: tx.nowMs,
  };
  if (o.replay) tx.stmt("DELETE FROM practices WHERE user_id = ? AND scene_id = ? AND replay = 1 AND status = 'open'", tx.id, o.sceneId);
  tx.stmt(
    `INSERT INTO practices (id, user_id, day, seed, plan, status, created_at, scene_id, level, replay, content_version, composer_version, updated_at, played_at)
     VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?)`,
    row.id, tx.id, row.day, row.seed, row.plan, tx.nowMs, row.scene_id, row.level, row.replay, row.content_version, row.composer_version, tx.nowMs, tx.nowMs,
  );
  return planOf(row);
}

/** What the screens need after a practice call: per-scene practices and the day (quests with their progress). */
async function practicePatch(tx: UserTx, content: Content, changedScenes: string[]): Promise<StatePatch> {
  await openPractices(tx, true);
  const practices = await scenePractices(tx, content);
  return {
    practices: Object.fromEntries(changedScenes.map((id) => [id, practices[id] ?? null])),
    daily: await dailyState(tx, content),
  };
}

export const practiceRoutes = new Hono<AppEnv>();

practiceRoutes.post('/practices/start', async (c) => {
  const body = await jsonBody<PracticeStartRequest>(c);
  const content = await getContent(c.env);
  const composer = typeof body.composerVersion === 'number' && Number.isFinite(body.composerVersion) ? Math.trunc(body.composerVersion) : null;
  return runTx(c, async (tx) => {
    await tx.preload(['progress', 'daily']);
    await ensureDaily(tx, content);
    const progress = releaseProgress(content, await tx.progress());
    const today = tx.today;
    let plan: PracticePlan;
    if (body.kind === 'resume') {
      const row = typeof body.practiceId === 'string' ? await loadPractice(tx, body.practiceId) : null;
      if (!row || row.status !== 'open') return fail(409, 'practice-closed');
      plan = planOf(row);
    } else if (body.kind === 'scene') {
      const id = typeof body.sceneId === 'string' ? body.sceneId : '';
      const p = progress.get(id);
      if (!p) return fail(403, 'scene-locked');
      const open = scenePracticeRow(await openPractices(tx), id, p, today);
      const make = (level: number, replay: boolean) => makePractice(tx, { sceneId: id, level, replay, content: content.index.version, composer });
      if (open) plan = planOf(open);
      else if (p.level < MAX_LEVEL && isDue(p, today)) plan = await make(p.level + 1, false);
      else plan = await make(p.level, true);
    } else {
      return fail(400, 'bad-request', 'kind');
    }
    tx.stmt('UPDATE practices SET played_at = ? WHERE id = ?', tx.nowMs, plan.id);
    logTx(tx, c, 'practice-start', { practiceId: plan.id, kind: body.kind, sceneId: plan.sceneId, level: plan.level, replay: plan.replay, done: plan.done, total: plan.total });
    await tx.commit();
    Object.assign(tx.patch, await practicePatch(tx, content, [plan.sceneId]));
    return c.json<PracticeStartResponse>({ plan, patch: tx.patch });
  });
});

/** Outcomes cleaned up: only puzzles on the practice's scene, units of that scene, sane numbers. */
function cleanOutcomes(raw: unknown, sceneIds: string[]): PuzzleOutcome[] {
  if (!Array.isArray(raw)) return [];
  const out: PuzzleOutcome[] = [];
  for (const o of raw.slice(0, MAX_OUTCOMES)) {
    if (!o || typeof o !== 'object') continue;
    const sceneId = String((o as any).sceneId ?? '');
    if (!sceneIds.includes(sceneId)) continue;
    const units = (v: unknown) =>
      Array.isArray(v) ? [...new Set(v.filter((u): u is string => typeof u === 'string' && u.length < 40 && inScene(sceneId, u)))].slice(0, 30) : [];
    out.push({
      puzzleId: String((o as any).puzzleId ?? '').slice(0, 40),
      type: String((o as any).type ?? 'unknown').slice(0, 30),
      sceneId,
      unitIds: units((o as any).unitIds),
      missedUnitIds: units((o as any).missedUnitIds),
      mistakes: clampInt((o as any).mistakes, 0, 50),
      hints: clampInt((o as any).hints, 0, 50),
      skipped: !!(o as any).skipped,
      ms: clampInt((o as any).ms, 0, 3_600_000),
      ...(typeof (o as any).questionId === 'string' && (o as any).questionId.length < 60 ? { questionId: (o as any).questionId } : {}),
    });
  }
  return out;
}

/** Merge outcomes by puzzle id (later ones replace earlier ones); returns the merged list and the new ones. */
function mergeOutcomes(stored: PuzzleOutcome[], incoming: PuzzleOutcome[]): { all: PuzzleOutcome[]; fresh: PuzzleOutcome[] } {
  const byId = new Map(stored.map((o) => [o.puzzleId, o]));
  const fresh: PuzzleOutcome[] = [];
  for (const o of incoming) {
    if (!byId.has(o.puzzleId) && !fresh.some((f) => f.puzzleId === o.puzzleId)) fresh.push(o);
    byId.set(o.puzzleId, o);
  }
  return { all: [...byId.values()].slice(0, MAX_OUTCOMES), fresh };
}

/** Credits finished puzzles: XP per puzzle, unit and puzzle type statistics, puzzle counters. Returns the XP. */
function creditOutcomes(tx: UserTx, outcomes: PuzzleOutcome[]): number {
  const today = tx.today;
  const units = new Map<string, { seen: number; missed: number }>();
  const puzzleTypes = new Map<string, { seen: number; missed: number; mistakes: number }>();
  for (const o of outcomes) {
    const missed = new Set(o.missedUnitIds);
    for (const u of o.unitIds) {
      const s = units.get(u) ?? { seen: 0, missed: 0 };
      s.seen++;
      if (missed.has(u) || o.hints > 0) s.missed++;
      units.set(u, s);
    }
    const g = puzzleTypes.get(o.type) ?? { seen: 0, missed: 0, mistakes: 0 };
    g.seen++;
    if (o.mistakes > 0 || o.hints > 0) g.missed++;
    g.mistakes += o.mistakes;
    puzzleTypes.set(o.type, g);
  }
  for (const [u, s] of units) {
    tx.stmt(
      `INSERT INTO unit_stats (user_id, unit_id, seen, missed, last_day) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (user_id, unit_id) DO UPDATE SET seen = seen + excluded.seen, missed = missed + excluded.missed, last_day = excluded.last_day`,
      tx.id, u, s.seen, s.missed, today,
    );
  }
  for (const [t, g] of puzzleTypes) {
    tx.stmt(
      `INSERT INTO puzzle_type_stats (user_id, type, seen, missed, mistakes) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (user_id, type) DO UPDATE SET seen = seen + excluded.seen, missed = missed + excluded.missed, mistakes = mistakes + excluded.mistakes`,
      tx.id, t, g.seen, g.missed, g.mistakes,
    );
  }
  const done = outcomes.filter((o) => !o.skipped);
  const xp = done.length * XP.puzzle;
  tx.addXp(xp);
  tx.bumpStat('puzzlesFinished', done.length);
  tx.bumpStat('questionsAnswered', done.filter((o) => o.type === 'question').length);
  return xp;
}

/**
 * A practice was finished today: the light streak (and the potions that save missed days), the days
 * table, the counters. Every finished practice counts, a replay too.
 */
async function countDay(tx: UserTx, xp: number): Promise<Omit<StreakChange, 'full'>> {
  const today = tx.today;
  const before = tx.streakState();
  const sr = streakOnPractice(before, tx.u.potions, today);
  tx.set('streak_count', sr.streak.count);
  tx.set('streak_best', sr.streak.best);
  tx.set('streak_last_day', sr.streak.lastDay);
  tx.set('potions', sr.freezes);
  if (sr.extended && STREAK_MILESTONES.includes(sr.streak.count)) tx.feed('streak', { count: sr.streak.count });
  await tx.days();
  // Each potion used saves one missed day, shown as a light day.
  for (let i = 1; i <= sr.freezesUsed; i++) tx.markDay(addDays(today, -i), 'saved');
  tx.markDay(today, 'light', xp);
  if (before.lastDay !== today) {
    tx.bumpStat('daysPractised');
    if (tx.ctx) logTx(tx, tx.ctx, 'streak', { kind: 'light', count: sr.streak.count, freezesUsed: sr.freezesUsed, reset: sr.reset });
  }
  return { count: sr.streak.count, extended: sr.extended, freezesUsed: sr.freezesUsed, reset: sr.reset };
}

practiceRoutes.post('/practices/:id/progress', async (c) => {
  const id = c.req.param('id');
  const body = await jsonBody<Partial<PracticeProgressRequest>>(c);
  const content = await getContent(c.env);
  return runTx(c, async (tx) => {
    const row = await loadPractice(tx, id);
    if (!row || row.status !== 'open') return fail(409, 'practice-closed');
    await tx.preload(['achievements', 'daily', 'progress']);
    const incoming = cleanOutcomes(body.outcomes, [row.scene_id]);
    const { all, fresh } = mergeOutcomes(parseJson<PuzzleOutcome[]>(row.outcomes, []), incoming);
    const xp = creditOutcomes(tx, fresh);
    const done = Math.max(row.done, clampInt(body.done, 0, MAX_PUZZLES));
    const total = body.total === undefined ? row.total : clampInt(body.total, 0, MAX_PUZZLES) || row.total;
    tx.stmt(
      `UPDATE practices SET done = ?, total = ?, outcomes = ?, credited_xp = credited_xp + ?, updated_at = ?, played_at = ? WHERE id = ? AND status = 'open'`,
      done, total, JSON.stringify(all), xp, tx.nowMs, tx.nowMs, id,
    );
    logTx(tx, c, 'practice-progress', { practiceId: id, done, total, fresh: fresh.length, xp });
    await tx.commit();
    Object.assign(tx.patch, await practicePatch(tx, content, [row.scene_id]));
    return c.json<PracticeProgressResponse>({ done, xp, patch: tx.patch });
  });
});

practiceRoutes.post('/practices/:id/complete', async (c) => {
  const id = c.req.param('id');
  const body = await jsonBody<Partial<PracticeCompleteRequest>>(c);
  const content = await getContent(c.env);
  return runTx(c, async (tx) => {
    const row = await loadPractice(tx, id);
    if (!row || row.status !== 'open') return fail(409, 'practice-closed');
    await tx.preload(['progress', 'daily', 'inventory', 'achievements', 'chests', 'days']);
    await ensureDaily(tx, content);
    const incoming = cleanOutcomes(body.outcomes, [row.scene_id]);
    const { all, fresh } = mergeOutcomes(parseJson<PuzzleOutcome[]>(row.outcomes, []), incoming);
    const done = Math.max(row.done, row.total ?? 0, all.length);
    const res = await completePractice(tx, content, row, all, fresh);
    // Questions shown: only questions of the scene, once per practice and day.
    const asked = new Set(all.map((o) => o.questionId).filter((q): q is string => !!q));
    if (asked.size) {
      const valid = new Set(await sceneQuestionIds(tx, [row.scene_id]));
      for (const q of asked) {
        if (!valid.has(q)) continue;
        tx.stmt(
          `INSERT INTO question_seen (user_id, question_id, shows, last_day) VALUES (?, ?, 1, ?)
           ON CONFLICT (user_id, question_id) DO UPDATE SET shows = shows + 1, last_day = excluded.last_day WHERE last_day < excluded.last_day`,
          tx.id, q, tx.today,
        );
      }
    }
    tx.stmt(
      "UPDATE practices SET status = 'done', completed_at = ?, stars = ?, outcomes = ?, done = ?, credited_xp = credited_xp + ?, updated_at = ? WHERE id = ? AND status = 'open'",
      tx.nowMs, res.stars, JSON.stringify(all), done, res.rewards.xp ?? 0, tx.nowMs, id,
    );
    logTx(tx, c, 'practice-complete', { practiceId: id, sceneId: row.scene_id, level: row.level, replay: !!row.replay, stars: res.stars, done, ms: clampInt(body.ms, 0, 86_400_000), quest: res.quest?.index ?? null });
    await tx.commit();
    return c.json<PracticeCompleteResponse>({
      ...res,
      creditedXp: row.credited_xp,
      achievements: [...tx.newAchievements],
      achievementRewards: tx.achievementRewards,
      patch: { ...tx.patch, ...(await practicePatch(tx, content, [row.scene_id])) },
    });
  });
});

type CompleteResult = Omit<PracticeCompleteResponse, 'patch' | 'achievements' | 'achievementRewards' | 'creditedXp'>;

/**
 * Finishes a practice (in memory and queued SQL; the caller commits): the pass rule for the scene (a
 * replay never touches a level), the practice-finished XP and sesterces, the skill, the light streak,
 * the quest it does and the full streak. `fresh` are outcomes not credited before.
 */
export async function completePractice(tx: UserTx, content: Content, row: PracticeRow, all: PuzzleOutcome[], fresh: PuzzleOutcome[]): Promise<CompleteResult> {
  const today = tx.today;
  const rankBefore = xpRank(tx.u.xp);
  const puzzleXp = creditOutcomes(tx, fresh);
  const progress = await tx.progress();

  const levels: LevelChange[] = [];
  const replayed: string[] = [];
  const p = progress.get(row.scene_id);
  let rose = false;
  if (p && !row.replay) {
    const r = row.level === p.level + 1 ? applyPass(p, today) : { level: p.level, dueDay: p.dueDay, rose: false };
    tx.setProgress(row.scene_id, { ...p, level: r.level, dueDay: r.dueDay, passes: p.passes + 1, lastPassDay: today });
    if (r.rose) {
      rose = true;
      levels.push({ sceneId: row.scene_id, from: p.level, to: r.level as Level, dueDay: r.dueDay });
      if (r.level >= 3) tx.feed('level', { sceneId: row.scene_id, level: r.level });
    } else replayed.push(row.scene_id);
  } else if (p) replayed.push(row.scene_id);

  const counted = all.filter((o) => !o.skipped);
  const mistakes = all.reduce((s, o) => s + o.mistakes, 0);
  const hints = all.reduce((s, o) => s + o.hints, 0);
  const puzzles = Math.max(counted.length, 1);
  const stars = practiceStars(puzzles, mistakes, hints);
  const perfect = counted.length > 0 && mistakes === 0 && hints === 0;
  const perPuzzle = (mistakes + hints * 0.5) / puzzles;
  const delta = perPuzzle <= 0.15 ? SKILL_STEP : perPuzzle > 0.6 ? -SKILL_STEP : 0;
  tx.set('skill_estimate', Math.round(Math.max(SKILL_MIN, Math.min(SKILL_MAX, tx.u.skill_estimate + delta)) * 100) / 100);
  tx.bumpStat('practicesFinished');
  if (perfect) tx.bumpStat('perfectPractices');

  // The practice-finished XP: a new level, or a pass without one (a replay: XP only, no sesterces).
  const finishXp = (rose ? XP.newLevel : XP.replay) + (perfect ? XP.perfectPractice : 0);
  const sesterces = row.replay ? 0 : (rose ? SESTERCES.newLevel : 0) + (perfect ? SESTERCES.perfectPractice : 0);
  tx.addXp(finishXp);
  tx.addSesterces(sesterces);
  const rewards: Reward = { xp: puzzleXp + finishXp, sesterces };

  // The streak, then the quest (a quest done can make today a full streak day).
  const d = await ensureDaily(tx, content);
  const wasFull = (await tx.days()).get(today) === 'full';
  const streak = await countDay(tx, puzzleXp + finishXp);
  const quest = row.replay ? null : await creditPractice(tx, content, d, row.scene_id, row.level);
  await markFullIfDone(tx, content, d);
  const full = !wasFull && (await tx.days()).get(today) === 'full';

  await tx.checkAchievements();
  const rankAfter = xpRank(tx.u.xp);
  if (rankAfter > rankBefore) tx.feed('rank', { count: rankAfter });
  return {
    level: row.level,
    replay: !!row.replay,
    stars,
    rewards,
    quest,
    chest: quest?.chest ?? null,
    levels,
    replayed,
    streak: { ...streak, full },
    rankUp: rankAfter > rankBefore ? rankAfter : null,
  };
}
