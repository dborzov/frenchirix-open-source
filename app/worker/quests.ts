// Daily quests (docs/app-rules.md, "Daily quests"). The day's quests are built once, at the day's first
// visit (ensureDaily in daily.ts), and stored in daily.quests so they never reshuffle; "Do more" appends
// extra ones. Each is credited once, inside the batch of the request that did it (a practice completes
// once, a scene is unlocked once, both behind the rev guard), so retries and lost answers neither double
// nor lose credit.
import type { Chest, DailyState, Quest } from '../shared/api';
import { DAILY_UNLOCKS, EXTRA_QUEST_CHEST, MAX_LEVEL, SESTERCES, XP, compareDays, planQuests, type Day, type WaitingPractice } from '../shared/rules';
import { logTx } from './activity';
import type { Content } from './content';
import { asScenePractice, dueScenes, openPractices, releaseProgress, type PracticeRow } from './practice-pick';
import type { DailyRow, ProgressRow, StoredQuest, UserTx } from './tx';

/** Draws up to DAILY_CANDIDATES locked scenes, none of `exclude`, seeded by `seedKey` (daily.ts). */
export type Draw = (exclude: ReadonlySet<string>, seedKey: string) => string[];

// ---------------------------------------------------------------------------------------------
// Building the day's quests

/**
 * The practices that wait, in order: levels due (silver and up), most overdue first; then scenes
 * unlocked on an earlier day whose bronze practice was started and not finished, most recently played
 * first. A scene unlocked earlier and never started is not a quest: it waits in the Episodes tab.
 */
export function waitingPractices(progress: ReadonlyMap<string, ProgressRow>, open: readonly PracticeRow[], today: Day): WaitingPractice[] {
  const due: WaitingPractice[] = dueScenes(progress, today)
    .filter((id) => progress.get(id)!.level >= 1 && progress.get(id)!.level < MAX_LEVEL)
    .map((id) => ({ sceneId: id, level: progress.get(id)!.level + 1, reason: 'due' }));
  const started: WaitingPractice[] = [];
  for (const r of open) {
    const p = progress.get(r.scene_id);
    if (r.replay || r.level !== 1 || !p || p.level !== 0 || compareDays(p.unlockedDay, today) >= 0) continue;
    if (!started.some((w) => w.sceneId === r.scene_id)) started.push({ sceneId: r.scene_id, level: 1, reason: 'continue' });
  }
  return [...due, ...started];
}

/**
 * Builds the day's quests (queues the write). A row started by release 2.2 keeps its candidates as the
 * day's draw, and the scenes already chosen from it fill their places.
 */
export async function buildQuests(tx: UserTx, content: Content, d: DailyRow, draw: Draw): Promise<void> {
  const progress = releaseProgress(content, await tx.progress());
  const today = tx.today;
  const waiting = waitingPractices(progress, await openPractices(tx), today);
  const legacy = d.candidates.length > 0;
  const offer = legacy ? d.candidates.filter((id) => content.byId.has(id)) : draw(new Set(), `offers:${tx.id}:${today}`);
  d.quests = planQuests(waiting, offer.length).map((q): StoredQuest =>
    q.kind === 'choose' ? { k: 'choose', r: 0, c: q.chest, n: q.target, o: offer } : { k: 'practice', r: 0, c: q.chest, s: q.sceneId, l: q.level, w: q.reason ?? 'new' },
  );
  if (!legacy) d.candidates = [...offer];
  for (const id of d.unlocked) if (offer.includes(id)) fillPlace(d, 0, id);
  tx.saveDaily();
  if (tx.ctx) logTx(tx, tx.ctx, 'quests-built', { quests: d.quests.map((q) => ({ kind: q.k, sceneId: q.s ?? null, level: q.l ?? null, reason: q.w ?? null })), due: waiting.length });
  if (legacy) {
    const ci = currentChoose(d);
    if (ci >= 0 && !d.quests[ci]!.d && chosenOf(d.quests[ci]!, d) >= (d.quests[ci]!.n ?? DAILY_UNLOCKS)) await questDone(tx, content, d, ci);
  }
}

/** The first place of round `round` still waiting for a scene gets this one. */
function fillPlace(d: DailyRow, round: number, sceneId: string): void {
  const place = d.quests!.find((q) => q.k === 'practice' && q.r === round && !q.s);
  if (place) place.s = sceneId;
}

// ---------------------------------------------------------------------------------------------
// Reading them

/** Index of the current choose quest (the latest one), or -1 when there is none. */
export function currentChoose(d: DailyRow): number {
  const qs = d.quests ?? [];
  for (let i = qs.length - 1; i >= 0; i--) if (qs[i]!.k === 'choose') return i;
  return -1;
}

/** Scenes chosen so far from a choose quest's draw. */
export function chosenOf(q: StoredQuest, d: DailyRow): number {
  return (q.o ?? []).filter((id) => d.unlocked.includes(id)).length;
}

const inRelease = (content: Content, q: StoredQuest) => q.k !== 'practice' || !q.s || content.byId.has(q.s);

/** The practice quests of the same round before quest `index`, not done yet: the choose quest waits for them. */
export function waitingFor(content: Content, d: DailyRow, index: number): number[] {
  const qs = d.quests ?? [];
  const q = qs[index]!;
  const out: number[] = [];
  for (let j = 0; j < index; j++) {
    const o = qs[j]!;
    if (o.k === 'practice' && o.r === q.r && !o.d && inRelease(content, o)) out.push(j);
  }
  return out;
}

/** Every quest done (extra ones too), and a quest built at all. */
function allDone(content: Content, d: DailyRow, round?: number): boolean {
  const qs = (d.quests ?? []).filter((q) => inRelease(content, q) && (round === undefined || q.r === round));
  return qs.length > 0 && qs.every((q) => !!q.d);
}

/** The quests as the client sees them (DailyState). */
export async function questsState(tx: UserTx, content: Content, d: DailyRow): Promise<DailyState> {
  const progress = releaseProgress(content, await tx.progress());
  const open = await openPractices(tx);
  const stored = d.quests ?? [];
  const quests: Quest[] = [];
  stored.forEach((q, index) => {
    if (!inRelease(content, q)) return; // a scene no longer in the release: left out (the indexes stay)
    const done = !!q.d;
    const practice = q.k === 'practice' ? (q.l ?? 1) : 0;
    const row = q.k === 'practice' && q.s && !done ? open.find((r) => !r.replay && r.scene_id === q.s && r.level === practice) : undefined;
    const wait = q.k === 'choose' && !done ? waitingFor(content, d, index) : [];
    const target = q.k === 'choose' ? (q.n ?? DAILY_UNLOCKS) : 0;
    quests.push({
      index,
      kind: q.k,
      round: q.r,
      extra: q.r > 0,
      chest: q.c,
      done,
      chestId: q.d ?? null,
      sceneId: q.k === 'practice' ? (q.s ?? null) : null,
      level: practice,
      reason: q.k === 'practice' ? (q.w ?? 'new') : null,
      practice: row ? asScenePractice(row) : null,
      chosen: q.k === 'choose' ? (done ? target : Math.min(target, chosenOf(q, d))) : 0,
      target,
      locked: wait.length > 0,
      waitingFor: wait,
    });
  });
  const ci = currentChoose(d);
  const cq = ci >= 0 ? stored[ci]! : null;
  const lockedLeft = content.sceneIds.some((id) => !progress.has(id));
  return {
    day: d.day,
    quests,
    questsDone: allDone(content, d, 0),
    round: stored.reduce((m, q) => Math.max(m, q.r), 0),
    choose: ci >= 0 ? ci : null,
    candidates: (cq?.o ?? []).filter((id) => content.byId.has(id)).map((sceneId) => ({ sceneId, unlocked: d.unlocked.includes(sceneId) || progress.has(sceneId) })),
    unlocksLeft: cq && !cq.d ? Math.max(0, (cq.n ?? DAILY_UNLOCKS) - chosenOf(cq, d)) : 0,
    doMore: allDone(content, d) && lockedLeft,
    dueSceneIds: dueScenes(progress, tx.today),
  };
}

// ---------------------------------------------------------------------------------------------
// Credit

/** Quest `index` is done: its chest, XP and sesterces, the counter, the log; then the full streak check. */
async function questDone(tx: UserTx, content: Content, d: DailyRow, index: number): Promise<Chest> {
  const q = d.quests![index]!;
  await tx.chests();
  const chest = tx.addChest(q.c, 'quest');
  q.d = chest.id;
  tx.saveDaily();
  tx.addXp(XP.quest);
  tx.addSesterces(SESTERCES.quest);
  tx.bumpStat('questsDone');
  if (tx.ctx) logTx(tx, tx.ctx, 'quest-done', { index, kind: q.k, round: q.r, sceneId: q.s ?? null, level: q.l ?? null, chest: q.c });
  await markFullIfDone(tx, content, d);
  return chest;
}

/**
 * Today becomes a full streak day once it is a light one (a practice finished today) and every one of
 * the day's quests (round 0) is done. Returns true when it became full now.
 */
export async function markFullIfDone(tx: UserTx, content: Content, d: DailyRow): Promise<boolean> {
  const today = tx.today;
  if (tx.u.streak_last_day !== today) return false;
  const qs = (d.quests ?? []).filter((q) => q.r === 0 && inRelease(content, q));
  if (!qs.length || !qs.every((q) => !!q.d)) return false;
  const days = await tx.days();
  if (days.get(today) === 'full') return false;
  tx.markDay(today, 'full');
  if (tx.ctx) logTx(tx, tx.ctx, 'streak', { kind: 'full', count: tx.u.streak_count, freezesUsed: 0, reset: false });
  return true;
}

/** A practice at `level` on `sceneId` was passed today: the quest it does, once. */
export async function creditPractice(tx: UserTx, content: Content, d: DailyRow, sceneId: string, level: number): Promise<{ index: number; chest: Chest } | null> {
  const index = (d.quests ?? []).findIndex((q) => q.k === 'practice' && !q.d && q.s === sceneId && q.l === level);
  if (index < 0) return null;
  return { index, chest: await questDone(tx, content, d, index) };
}

/**
 * A scene of the current draw was chosen (the caller checked it may be): it fills the first place of
 * its round, and the choice that reaches the target does the choose quest.
 */
export async function chooseScene(tx: UserTx, content: Content, d: DailyRow, sceneId: string): Promise<{ index: number; chest: Chest } | null> {
  const ci = currentChoose(d);
  const cq = d.quests![ci]!;
  d.unlocked.push(sceneId);
  fillPlace(d, cq.r, sceneId);
  tx.saveDaily();
  if (chosenOf(cq, d) < (cq.n ?? DAILY_UNLOCKS)) return null;
  return { index: ci, chest: await questDone(tx, content, d, ci) };
}

/** "Do more": a fresh draw and its extra quests, once every quest is done. False when it is not available. */
export async function doMore(tx: UserTx, content: Content, d: DailyRow, draw: Draw): Promise<boolean> {
  const progress = releaseProgress(content, await tx.progress());
  if (!allDone(content, d) || !content.sceneIds.some((id) => !progress.has(id))) return false;
  const round = d.quests!.reduce((m, q) => Math.max(m, q.r), 0) + 1;
  const key = `offers:${tx.id}:${tx.today}:${round}`;
  let offer = draw(new Set(d.candidates), key);
  if (!offer.length) offer = draw(new Set(), key); // every locked scene was offered today already
  const target = Math.min(DAILY_UNLOCKS, offer.length);
  d.quests!.push({ k: 'choose', r: round, c: EXTRA_QUEST_CHEST, n: target, o: offer });
  for (let i = 0; i < target; i++) d.quests!.push({ k: 'practice', r: round, c: EXTRA_QUEST_CHEST, s: null, l: 1, w: 'new' });
  d.candidates = [...d.candidates, ...offer.filter((id) => !d.candidates.includes(id))];
  tx.saveDaily();
  if (tx.ctx) logTx(tx, tx.ctx, 'quest-more', { round, candidates: offer });
  return true;
}
