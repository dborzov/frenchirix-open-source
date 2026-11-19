// Practices: one row per (kid, scene, level) for a practice at a level, and replays (`replay = 1`, the
// practice at the scene's current level, XP only). This module reads them and decides what starting a
// scene plays; worker/practices.ts starts, saves and completes them, worker/quests.ts makes quests of them.
import type { ScenePractice } from '../shared/api';
import { MAX_LEVEL, compareDays, isDue, overdueDays, type Day } from '../shared/rules';
import type { Content } from './content';
import type { ProgressRow, UserTx } from './tx';

export interface PracticeRow {
  id: string;
  user_id: string;
  day: string;
  seed: number;
  plan: string;
  status: string;
  scene_id: string;
  level: number;
  replay: number;
  done: number;
  total: number | null;
  outcomes: string;
  credited_xp: number;
  content_version: string | null;
  composer_version: number | null;
  played_at: number | null;
}

const cache = new WeakMap<UserTx, PracticeRow[]>();

/** The kid's open practices (replays included), most recently played first. Cached per request. */
export async function openPractices(tx: UserTx, fresh = false): Promise<PracticeRow[]> {
  if (!fresh && cache.has(tx)) return cache.get(tx)!;
  const r = await tx.db
    .prepare("SELECT * FROM practices WHERE user_id = ? AND status = 'open' AND level IS NOT NULL ORDER BY played_at DESC, created_at DESC LIMIT 300")
    .bind(tx.id)
    .all<PracticeRow>();
  cache.set(tx, r.results);
  return r.results;
}

/** Unlocked scenes whose level can rise today, most overdue first. */
export function dueScenes(progress: ReadonlyMap<string, ProgressRow>, today: Day): string[] {
  return [...progress.entries()]
    .filter(([, p]) => isDue(p, today))
    .sort((a, b) => overdueDays(b[1], today) - overdueDays(a[1], today) || compareDays(a[1].unlockedDay, b[1].unlockedDay) || (a[0] < b[0] ? -1 : 1))
    .map(([id]) => id);
}

/** Unlocked scenes that are in the release (progress on other scenes is ignored). */
export function releaseProgress(content: Content, progress: ReadonlyMap<string, ProgressRow>): Map<string, ProgressRow> {
  return new Map([...progress].filter(([id]) => content.byId.has(id)));
}

/**
 * What starting a scene continues: its open practice for the next level; else, when the next level is
 * not due, its open replay at the scene's level. A scene whose next level is due and not started has none.
 */
export function scenePracticeRow(open: readonly PracticeRow[], sceneId: string, p: ProgressRow | undefined, today: Day): PracticeRow | null {
  if (!p) return null;
  const level = open.find((r) => !r.replay && r.scene_id === sceneId && r.level === p.level + 1);
  if (level) return level;
  if (p.level < MAX_LEVEL && isDue(p, today)) return null;
  return open.find((r) => !!r.replay && r.scene_id === sceneId && r.level === p.level) ?? null;
}

/** The progress of a started practice, as the state shows it (`done` never above `total`). */
export function asScenePractice(r: PracticeRow): ScenePractice {
  return { practiceId: r.id, level: r.level, replay: !!r.replay, done: r.total ? Math.min(r.done, r.total) : r.done, total: r.total };
}

/** Per release scene, what starting it continues (PlayerState.practices). */
export async function scenePractices(tx: UserTx, content: Content): Promise<Record<string, ScenePractice>> {
  const open = await openPractices(tx);
  const progress = await tx.progress();
  const today = tx.today;
  const out: Record<string, ScenePractice> = {};
  for (const id of new Set(open.map((r) => r.scene_id))) {
    if (!content.byId.has(id)) continue;
    const row = scenePracticeRow(open, id, progress.get(id), today);
    if (row) out[id] = asScenePractice(row);
  }
  return out;
}
