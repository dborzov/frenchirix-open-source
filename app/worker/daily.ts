// The day: candidates, unlocking, "Do more", and the day's quests (built and credited in quests.ts).
import { Hono } from 'hono';
import type { DailyResponse, DailyState, MoreResponse, UnlockRequest, UnlockResponse } from '../shared/api';
import { createRng, hashString, type Rng } from '../shared/practice/rng';
import { DAILY_CANDIDATES, DAILY_UNLOCKS } from '../shared/rules';
import type { SceneSummary } from '../shared/content';
import { getContent, inScene, type Content } from './content';
import { buildQuests, chooseScene, chosenOf, currentChoose, doMore, questsState, waitingFor, type Draw } from './quests';
import type { AppEnv } from './env';
import { runTx } from './session';
import type { DailyRow, UserTx } from './tx';
import { fail, jsonBody } from './util';

export { dueScenes } from './practice-pick';

// ---------------------------------------------------------------------------------------------
// Candidates

function weightedPick<T>(items: T[], weight: (t: T) => number, n: number, rng: Rng): T[] {
  const pool = items.map((t) => ({ t, w: Math.max(1e-6, weight(t)) }));
  const out: T[] = [];
  while (out.length < n && pool.length) {
    const total = pool.reduce((s, p) => s + p.w, 0);
    let r = rng.next() * total;
    let i = 0;
    for (; i < pool.length - 1; i++) {
      r -= pool[i]!.w;
      if (r < 0) break;
    }
    out.push(pool[i]!.t);
    pool.splice(i, 1);
  }
  return out;
}

/**
 * Draws today's candidates from the locked scenes. Weight grows with score, shrinks with the distance
 * between the scene's difficulty and the kid's skill, times a random factor; while a song scene is locked,
 * at least one candidate is a song scene. On day one (nothing unlocked yet): one scene of each starter
 * song, then easy, high-score scenes, preferring short ones.
 */
export function drawCandidates(
  content: Content,
  progress: ReadonlyMap<string, unknown>,
  skillEstimate: number,
  rng: Rng,
  exclude: ReadonlySet<string> = new Set(),
): string[] {
  const locked = content.sceneIds.filter((id) => !progress.has(id) && !exclude.has(id)).map((id) => content.byId.get(id)!);
  const picked: SceneSummary[] = [];
  const rest = () => locked.filter((s) => !picked.includes(s));
  if (progress.size === 0) {
    // Songs first: one scene of each starter song, at random among its locked scenes, preferring its earliest.
    const starters = content.index.songs.filter((x) => x.starter);
    for (const song of starters) {
      const scenes = rest().filter((s) => s.songId === song.id);
      if (!scenes.length) continue;
      const minOrder = Math.min(...scenes.map((s) => s.order));
      picked.push(...weightedPick(scenes, (s) => 1 / (1 + s.order - minOrder), 1, rng));
    }
    // The other candidates are not more scenes of the starter songs (one of each is enough).
    const starterIds = new Set(starters.map((x) => x.id));
    const easy = rest().filter((s) => s.difficulty <= 2 && s.score >= 4 && !(s.songId && starterIds.has(s.songId)));
    picked.push(...weightedPick(easy, (s) => 60_000 / Math.max(5_000, s.durationMs), DAILY_CANDIDATES - picked.length, rng));
    picked.push(...weightedPick(rest(), (s) => (s.difficulty <= 2 ? 10 : 1) * s.score, DAILY_CANDIDATES - picked.length, rng));
    return picked.map((s) => s.id);
  }
  const weight = (s: SceneSummary) => s.score * s.score * Math.exp(-Math.abs(s.difficulty - skillEstimate)) * (0.4 + rng.next());
  // While a song scene is still locked, at least one of the candidates is a song scene.
  const songs = locked.filter((s) => s.kind === 'song');
  if (songs.length) picked.push(...weightedPick(songs, weight, 1, rng));
  picked.push(...weightedPick(rest(), weight, DAILY_CANDIDATES - picked.length, rng));
  return picked.map((s) => s.id);
}

/** Episodes whose every unlockable scene is unlocked. */
export function episodesComplete(content: Content, progress: ReadonlyMap<string, unknown>): number {
  const unlockable = new Set(content.sceneIds);
  return content.index.episodes.filter((e) => {
    const ids = e.sceneIds.filter((id) => unlockable.has(id));
    return ids.length > 0 && ids.every((id) => progress.has(id));
  }).length;
}

/** The draw of candidates for this kid now (quests.ts). */
function drawFor(tx: UserTx, content: Content, progress: ReadonlyMap<string, unknown>): Draw {
  return (exclude, seedKey) => drawCandidates(content, progress, tx.u.skill_estimate, createRng(hashString(seedKey)), exclude);
}

/** Makes sure today's daily row exists and has the day's quests, built at the day's first visit (queues the write). */
export async function ensureDaily(tx: UserTx, content: Content): Promise<DailyRow> {
  const d = await tx.daily();
  if (d.quests === null) await buildQuests(tx, content, d, drawFor(tx, content, await tx.progress()));
  return d;
}

// ---------------------------------------------------------------------------------------------
// Weak spots

/** Weakest units first: unit id list from unit_stats. */
export async function weakUnits(tx: UserTx): Promise<string[]> {
  const r = await tx.db
    .prepare(
      'SELECT unit_id FROM unit_stats WHERE user_id = ? AND missed > 0 ORDER BY CAST(missed AS REAL) / seen DESC, missed DESC LIMIT 100',
    )
    .bind(tx.id)
    .all<{ unit_id: string }>();
  return (r.results ?? []).map((x) => x.unit_id);
}

/** The weakest units among these scenes (the plan's focusUnitIds). */
export function focusUnits(weak: string[], sceneIds: string[], n = 8): string[] {
  return weak.filter((u) => sceneIds.some((s) => inScene(s, u))).slice(0, n);
}

// ---------------------------------------------------------------------------------------------
// DailyState

/** The day as the client sees it: the quests, the current candidates, "Do more". */
export async function dailyState(tx: UserTx, content: Content): Promise<DailyState> {
  return questsState(tx, content, await ensureDaily(tx, content));
}

// ---------------------------------------------------------------------------------------------
// Routes

export const dailyRoutes = new Hono<AppEnv>();

dailyRoutes.get('/daily', async (c) => {
  const content = await getContent(c.env);
  return runTx(c, async (tx) => {
    await tx.preload(['progress', 'daily']);
    await ensureDaily(tx, content);
    await tx.commit();
    const daily = await dailyState(tx, content);
    return c.json<DailyResponse>({ daily, patch: { ...tx.patch, daily } });
  });
});

dailyRoutes.post('/daily/unlock', async (c) => {
  const body = await jsonBody<Partial<UnlockRequest>>(c);
  const sceneId = typeof body.sceneId === 'string' ? body.sceneId : '';
  const content = await getContent(c.env);
  return runTx(c, async (tx) => {
    await tx.preload(['progress', 'daily', 'days']);
    const d = await ensureDaily(tx, content);
    const progress = await tx.progress();
    const ci = currentChoose(d);
    const cq = ci >= 0 ? d.quests![ci]! : null;
    if (!cq || !(cq.o ?? []).includes(sceneId) || !content.byId.has(sceneId)) return fail(400, 'not-offered');
    if (progress.has(sceneId) || d.unlocked.includes(sceneId)) return fail(400, 'already-unlocked');
    if (cq.d || chosenOf(cq, d) >= (cq.n ?? DAILY_UNLOCKS)) return fail(400, 'no-unlocks-left');
    if (waitingFor(content, d, ci).length) return fail(409, 'choose-locked', 'finish the practice quests before it first');
    tx.setProgress(sceneId, { level: 0, dueDay: null, passes: 0, unlockedDay: tx.today, views: 0, lastPassDay: null }, true);
    const quest = await chooseScene(tx, content, d, sceneId);
    if (progress.size % 10 === 0) tx.feed('unlock', { count: progress.size, sceneId });
    tx.setStat('episodesComplete', episodesComplete(content, progress));
    await tx.commit();
    const daily = await dailyState(tx, content);
    return c.json<UnlockResponse>({ quest, patch: { ...tx.patch, daily } });
  });
});

dailyRoutes.post('/daily/more', async (c) => {
  const content = await getContent(c.env);
  return runTx(c, async (tx) => {
    await tx.preload(['progress', 'daily']);
    const d = await ensureDaily(tx, content);
    if (!(await doMore(tx, content, d, drawFor(tx, content, await tx.progress())))) return fail(409, 'more-unavailable');
    await tx.commit();
    const daily = await dailyState(tx, content);
    return c.json<MoreResponse>({ daily, patch: { ...tx.patch, daily } });
  });
});
