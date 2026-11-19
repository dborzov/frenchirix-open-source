// Leagues: weekly XP tables (weeks start Monday in the kid's zone), five tiers, groups of up to 20.
// A kid joins a group lazily on their first XP of a week. Last week's group is settled lazily, the first
// time any of its members is seen in a new week: the top go up a tier, the bottom go down.
import { Hono } from 'hono';
import type { LeagueResponse, LeagueRow, LeagueSummary } from '../shared/api';
import { LEAGUE_DEMOTE, LEAGUE_GROUP_SIZE, LEAGUE_PROMOTE, LEAGUE_TIERS, addDays, weekOf, type LeagueTier } from '../shared/rules';
import type { AppEnv } from './env';
import { runTx } from './session';
import { parseAvatar, type UserTx } from './tx';
import { randomId } from './util';

export const TOP_TIER = (LEAGUE_TIERS.length - 1) as LeagueTier;
/** Relegation only happens in groups at least this big. */
export const DEMOTE_MIN_GROUP = 10;

export const promoteCount = (tier: number) => (tier < TOP_TIER ? LEAGUE_PROMOTE : 0);
export const demoteCount = (tier: number) => (tier > 0 ? LEAGUE_DEMOTE : 0);

/** Settles one group once: returns the new tier of every member that moved. */
export async function settleGroup(db: D1Database, groupId: string): Promise<Map<string, number>> {
  const moved = new Map<string, number>();
  const claim = await db.prepare('UPDATE league_groups SET settled = 1 WHERE id = ? AND settled = 0').bind(groupId).run();
  if (claim.meta.changes !== 1) return moved;
  const g = await db.prepare('SELECT tier FROM league_groups WHERE id = ?').bind(groupId).first<{ tier: number }>();
  const members = (
    await db.prepare('SELECT user_id, xp FROM league_members WHERE group_id = ? ORDER BY xp DESC, user_id').bind(groupId).all<{ user_id: string; xp: number }>()
  ).results;
  const tier = g?.tier ?? 0;
  const n = members.length;
  const up = Math.min(promoteCount(tier), n);
  const down = n >= DEMOTE_MIN_GROUP ? Math.min(demoteCount(tier), n - up) : 0;
  members.forEach((m, i) => {
    if (i < up) moved.set(m.user_id, tier + 1);
    else if (i >= n - down) moved.set(m.user_id, tier - 1);
  });
  if (moved.size) {
    await db.batch([...moved].map(([id, t]) => db.prepare('UPDATE users SET league_tier = ? WHERE id = ?').bind(t, id)));
  }
  return moved;
}

/** First sight of this kid in a new week: settle the group of their last league week. */
export async function touchLeague(tx: UserTx): Promise<void> {
  const week = weekOf(tx.today);
  if (tx.u.league_seen_week === week) return;
  const last = await tx.db
    .prepare('SELECT m.group_id, g.settled FROM league_members m JOIN league_groups g ON g.id = m.group_id WHERE m.user_id = ? AND m.week < ? ORDER BY m.week DESC LIMIT 1')
    .bind(tx.id, week)
    .first<{ group_id: string; settled: number }>();
  if (last && !last.settled) {
    const moved = await settleGroup(tx.db, last.group_id);
    const mine = moved.get(tx.id);
    if (mine !== undefined) tx.u.league_tier = mine;
  }
  if (last?.settled) {
    // Settled by someone else: our tier may have changed under us.
    const r = await tx.db.prepare('SELECT league_tier FROM users WHERE id = ?').bind(tx.id).first<{ league_tier: number }>();
    if (r) tx.u.league_tier = r.league_tier;
  }
  tx.set('league_seen_week', week);
}

/** Puts the kid in a group for this week if they are not in one. */
export async function ensureMembership(tx: UserTx): Promise<void> {
  const week = weekOf(tx.today);
  const db = tx.db;
  const have = await db.prepare('SELECT 1 FROM league_members WHERE user_id = ? AND week = ?').bind(tx.id, week).first();
  if (have) return;
  await touchLeague(tx);
  const tier = tx.u.league_tier;
  let groupId: string | null = null;
  for (let attempt = 0; attempt < 4 && !groupId; attempt++) {
    const g = await db
      .prepare('SELECT id FROM league_groups WHERE week = ? AND tier = ? AND size < ? ORDER BY size DESC, id LIMIT 1')
      .bind(week, tier, LEAGUE_GROUP_SIZE)
      .first<{ id: string }>();
    if (!g) {
      groupId = randomId('g');
      await db.prepare('INSERT INTO league_groups (id, week, tier, size) VALUES (?, ?, ?, 1)').bind(groupId, week, tier).run();
    } else {
      const r = await db.prepare('UPDATE league_groups SET size = size + 1 WHERE id = ? AND size < ?').bind(g.id, LEAGUE_GROUP_SIZE).run();
      if (r.meta.changes === 1) groupId = g.id;
    }
  }
  if (!groupId) return;
  await db.prepare('INSERT OR IGNORE INTO league_members (week, user_id, group_id, tier, xp) VALUES (?, ?, ?, ?, 0)').bind(week, tx.id, groupId, tier).run();
}

/** Called by UserTx.commit when XP went up: join a group and queue the XP. */
export async function queueLeagueXp(tx: UserTx, xp: number): Promise<void> {
  await ensureMembership(tx);
  tx.stmt('UPDATE league_members SET xp = xp + ? WHERE user_id = ? AND week = ?', xp, tx.id, weekOf(tx.today));
}

export async function leagueSummary(tx: UserTx): Promise<LeagueSummary | null> {
  const week = weekOf(tx.today);
  const r = await tx.db
    .prepare(
      `SELECT m.xp, m.tier,
        (SELECT count(*) FROM league_members o WHERE o.group_id = m.group_id) AS size,
        (SELECT count(*) FROM league_members o WHERE o.group_id = m.group_id AND (o.xp > m.xp OR (o.xp = m.xp AND o.user_id < m.user_id))) + 1 AS rank
       FROM league_members m WHERE m.user_id = ? AND m.week = ?`,
    )
    .bind(tx.id, week)
    .first<{ xp: number; tier: number; size: number; rank: number }>();
  if (!r) return null;
  return { week, tier: r.tier as LeagueTier, weekXp: r.xp, rank: r.rank, groupSize: r.size };
}

export const leagueRoutes = new Hono<AppEnv>();

leagueRoutes.get('/league', async (c) =>
  runTx(c, async (tx) => {
    await touchLeague(tx);
    await tx.commit();
    const week = weekOf(tx.today);
    const m = await tx.db.prepare('SELECT group_id, tier FROM league_members WHERE user_id = ? AND week = ?').bind(tx.id, week).first<{ group_id: string; tier: number }>();
    let rows: LeagueRow[];
    let tier = tx.u.league_tier as LeagueTier;
    if (m) {
      tier = m.tier as LeagueTier;
      const r = await tx.db
        .prepare('SELECT m.user_id, m.xp, u.name, u.avatar FROM league_members m JOIN users u ON u.id = m.user_id WHERE m.group_id = ? ORDER BY m.xp DESC, m.user_id')
        .bind(m.group_id)
        .all<{ user_id: string; xp: number; name: string; avatar: string }>();
      rows = r.results.map((x, i) => ({ userId: x.user_id, name: x.name, avatar: parseAvatar(x.avatar), weekXp: x.xp, rank: i + 1, me: x.user_id === tx.id }));
    } else {
      rows = [{ userId: tx.id, name: tx.u.name, avatar: parseAvatar(tx.u.avatar), weekXp: 0, rank: 1, me: true }];
    }
    return c.json<LeagueResponse>({
      week,
      endsDay: addDays(week, 6),
      tier,
      rows,
      promote: promoteCount(tier),
      demote: demoteCount(tier),
    });
  }),
);
