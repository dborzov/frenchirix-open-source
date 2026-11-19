// Social, with no free text anywhere: search by name, follow, friends and their milestones, gifts
// (a cheer from the fixed set, an owned item, a potion), and the inbox.
import { Hono } from 'hono';
import type {
  FeedItem,
  FollowRequest,
  FollowResponse,
  Friend,
  FriendsResponse,
  Gift,
  GiftRequest,
  GiftResponse,
  InboxEntry,
  InboxResponse,
  PublicProfile,
  SocialSearchResponse,
} from '../shared/api';
import { CHEERS_BY_ID, ITEMS_BY_ID, type ItemSlot } from '../shared/catalog';
import { nameKey } from '../shared/catalog/badwords';
import { MAX_STREAK_FREEZES, addDays, displayedStreak, friendStreak, kidDay, weekOf, xpRank, type Day, type Level } from '../shared/rules';
import { getContent } from './content';
import { ensureDaily } from './daily';
import type { AppEnv } from './env';
import { runTx } from './session';
import { STARTER_ITEMS as STARTER, parseAvatar, type UserRow, type UserTx } from './tx';
import { fail, jsonBody, randomId } from './util';

export const MAX_FOLLOWS = 200;
export const GIFTS_PER_DAY = 10; // all gifts, cheers included
export const MOVES_PER_DAY = 3; // items and potions given per day
const FEED_DAYS = 14;

type PublicRow = Pick<UserRow, 'id' | 'name' | 'avatar' | 'xp' | 'streak_count' | 'streak_best' | 'streak_last_day' | 'potions' | 'time_zone'>;
const PUBLIC_COLS = 'u.id, u.name, u.avatar, u.xp, u.streak_count, u.streak_best, u.streak_last_day, u.potions, u.time_zone';

function publicOf(r: PublicRow, nowMs: number, following: boolean, followsMe: boolean): PublicProfile {
  const today = kidDay(nowMs, r.time_zone);
  return {
    id: r.id,
    name: r.name,
    avatar: parseAvatar(r.avatar),
    xpRank: xpRank(r.xp),
    streak: displayedStreak({ count: r.streak_count, best: r.streak_best, lastDay: r.streak_last_day }, r.potions, today),
    following,
    followsMe,
  };
}

async function relations(tx: UserTx, ids: string[]): Promise<{ following: Set<string>; followers: Set<string> }> {
  if (!ids.length) return { following: new Set(), followers: new Set() };
  const marks = ids.map(() => '?').join(',');
  const r = await tx.db
    .prepare(`SELECT follower_id, followee_id FROM follows WHERE (follower_id = ? AND followee_id IN (${marks})) OR (followee_id = ? AND follower_id IN (${marks}))`)
    .bind(tx.id, ...ids, tx.id, ...ids)
    .all<{ follower_id: string; followee_id: string }>();
  const following = new Set<string>();
  const followers = new Set<string>();
  for (const x of r.results) {
    if (x.follower_id === tx.id) following.add(x.followee_id);
    else followers.add(x.follower_id);
  }
  return { following, followers };
}

async function publicProfile(tx: UserTx, userId: string): Promise<PublicProfile | null> {
  const r = await tx.db.prepare(`SELECT ${PUBLIC_COLS} FROM users u WHERE u.id = ?`).bind(userId).first<PublicRow>();
  if (!r) return null;
  const rel = await relations(tx, [userId]);
  return publicOf(r, tx.nowMs, rel.following.has(userId), rel.followers.has(userId));
}

const countSql = (col: 'follower_id' | 'followee_id') => `(SELECT count(*) FROM follows WHERE ${col} = ?)`;

export const socialRoutes = new Hono<AppEnv>();

socialRoutes.get('/social/search', async (c) => {
  const q = nameKey((c.req.query('q') ?? '').trim()).slice(0, 20);
  return runTx(c, async (tx) => {
    if (q.length < 2) return c.json<SocialSearchResponse>({ users: [] });
    const esc = q.replace(/[\\%_]/g, (ch) => `\\${ch}`);
    const r = await tx.db
      .prepare(`SELECT ${PUBLIC_COLS} FROM users u WHERE u.name_key LIKE ? ESCAPE '\\' AND u.id != ? ORDER BY u.name_key LIMIT 20`)
      .bind(`${esc}%`, tx.id)
      .all<PublicRow>();
    const rel = await relations(tx, r.results.map((x) => x.id));
    return c.json<SocialSearchResponse>({ users: r.results.map((x) => publicOf(x, tx.nowMs, rel.following.has(x.id), rel.followers.has(x.id))) });
  });
});

async function follow(c: any, on: boolean): Promise<Response> {
  const body = await jsonBody<Partial<FollowRequest>>(c);
  const userId = typeof body.userId === 'string' ? body.userId : '';
  return runTx(c, async (tx) => {
    if (userId === tx.id) return fail(400, 'bad-request', 'yourself');
    const exists = await tx.db.prepare('SELECT id FROM users WHERE id = ?').bind(userId).first();
    if (!exists) return fail(404, 'not-found');
    await tx.achievements();
    if (on) {
      const n = await tx.db.prepare(`SELECT ${countSql('follower_id')} AS n`).bind(tx.id).first<{ n: number }>();
      if ((n?.n ?? 0) >= MAX_FOLLOWS) return fail(409, 'rate-limited', 'too many follows');
      tx.stmt('INSERT OR IGNORE INTO follows (follower_id, followee_id, created_at) VALUES (?, ?, ?)', tx.id, userId, tx.nowMs);
    } else {
      tx.stmt('DELETE FROM follows WHERE follower_id = ? AND followee_id = ?', tx.id, userId);
    }
    // The other kid's follower count, without touching anything else of theirs.
    tx.stmt(`UPDATE users SET stats = json_set(stats, '$.followers', ${countSql('followee_id')}) WHERE id = ?`, userId, userId);
    const before = (await tx.db.prepare(`SELECT ${countSql('follower_id')} AS n`).bind(tx.id).first<{ n: number }>())?.n ?? 0;
    const already = !!(await tx.db.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?').bind(tx.id, userId).first());
    tx.setStat('follows', before + (on && !already ? 1 : !on && already ? -1 : 0));
    await tx.commit();
    const user = (await publicProfile(tx, userId))!;
    return c.json({ user, patch: tx.patch } satisfies FollowResponse);
  });
}

socialRoutes.post('/social/follow', (c) => follow(c, true));
socialRoutes.delete('/social/follow', (c) => follow(c, false));

socialRoutes.get('/social/friends', async (c) =>
  runTx(c, async (tx) => {
    const db = tx.db;
    const today = tx.today;
    const r = await db
      .prepare(
        `SELECT ${PUBLIC_COLS},
           EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = ?1 AND f.followee_id = u.id) AS following,
           EXISTS (SELECT 1 FROM follows f WHERE f.followee_id = ?1 AND f.follower_id = u.id) AS follows_me,
           (SELECT xp FROM league_members m WHERE m.user_id = u.id AND m.week = ?2) AS week_xp
         FROM users u
         WHERE u.id IN (SELECT followee_id FROM follows WHERE follower_id = ?1 UNION SELECT follower_id FROM follows WHERE followee_id = ?1)
         LIMIT 400`,
      )
      .bind(tx.id, weekOf(today))
      .all<PublicRow & { following: number; follows_me: number; week_xp: number | null }>();
    const ids = r.results.map((x) => x.id);
    const since = addDays(today, -60);
    const days = new Map<string, Set<Day>>();
    if (ids.length) {
      const all = [tx.id, ...ids];
      const dr = await db
        .prepare(`SELECT user_id, day FROM days WHERE kind != 'saved' AND day >= ? AND user_id IN (${all.map(() => '?').join(',')})`)
        .bind(since, ...all)
        .all<{ user_id: string; day: string }>();
      for (const x of dr.results) {
        if (!days.has(x.user_id)) days.set(x.user_id, new Set());
        days.get(x.user_id)!.add(x.day);
      }
    }
    const mine = days.get(tx.id) ?? new Set<Day>();
    const friends: Friend[] = r.results.map((x) => ({
      ...publicOf(x, tx.nowMs, !!x.following, !!x.follows_me),
      friendStreak: friendStreak(mine, days.get(x.id) ?? new Set(), today),
      practisedToday: x.streak_last_day === kidDay(tx.nowMs, x.time_zone),
      weekXp: x.week_xp ?? 0,
    }));
    friends.sort((a, b) => Number(b.following && b.followsMe) - Number(a.following && a.followsMe) || b.friendStreak - a.friendStreak || a.name.localeCompare(b.name));
    const best = Math.max(0, ...friends.filter((f) => f.following && f.followsMe).map((f) => f.friendStreak));
    if (best > (tx.stats.bestFriendStreak ?? 0)) {
      tx.setStat('bestFriendStreak', best);
      await tx.commit();
    }

    // The feed: milestones of the kids I follow.
    const fr = await db
      .prepare(
        `SELECT f.*, u.name, u.avatar,
           EXISTS (SELECT 1 FROM gifts g WHERE g.from_id = ?1 AND g.feed_item_id = f.id) AS cheered
         FROM feed f JOIN users u ON u.id = f.user_id
         WHERE f.user_id IN (SELECT followee_id FROM follows WHERE follower_id = ?1) AND f.created_at > ?2
         ORDER BY f.created_at DESC LIMIT 50`,
      )
      .bind(tx.id, tx.nowMs - FEED_DAYS * 86_400_000)
      .all<any>();
    const feed: FeedItem[] = fr.results.map((f) => {
      const item: FeedItem = { id: f.id, user: { id: f.user_id, name: f.name, avatar: parseAvatar(f.avatar) }, kind: f.kind, day: f.day, cheeredByMe: !!f.cheered };
      if (f.scene_id) item.sceneId = f.scene_id;
      if (f.level !== null) item.level = f.level as Level;
      if (f.count !== null) item.count = f.count;
      if (f.achievement_id) item.achievementId = f.achievement_id;
      return item;
    });
    return c.json<FriendsResponse>({ friends, feed });
  }),
);

socialRoutes.post('/social/gift', async (c) => {
  const body = await jsonBody<Partial<GiftRequest>>(c);
  const to = typeof body.toUserId === 'string' ? body.toUserId : '';
  const gift = body.gift as Gift | undefined;
  const content = await getContent(c.env);
  return runTx(c, async (tx) => {
    if (!gift || typeof gift !== 'object' || to === tx.id) return fail(400, 'bad-request');
    const db = tx.db;
    const follows = await db.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?').bind(tx.id, to).first();
    if (!follows) return fail(403, 'not-found', 'follow them first');
    await tx.preload(['daily', 'progress', 'inventory', 'achievements']);
    const d = await ensureDaily(tx, content);
    if (d.gifts_n >= GIFTS_PER_DAY) return fail(429, 'rate-limited', 'gifts per day');
    const id = randomId('g');
    let ref: string | null = null;
    let feedItemId: string | null = null;
    // Receiver updates bump their rev (so their own concurrent request replays) and abort the batch
    // when a condition fails (json('...') raises).
    if (gift.kind === 'cheer') {
      if (!CHEERS_BY_ID.has(gift.cheerId)) return fail(400, 'bad-request', 'cheer');
      ref = gift.cheerId;
      if (typeof gift.feedItemId === 'string') {
        const f = await db.prepare('SELECT id FROM feed WHERE id = ? AND user_id = ?').bind(gift.feedItemId, to).first();
        if (!f) return fail(404, 'not-found', 'feed item');
        const dup = await db.prepare('SELECT 1 FROM gifts WHERE from_id = ? AND feed_item_id = ?').bind(tx.id, gift.feedItemId).first();
        if (dup) return fail(409, 'rate-limited', 'already cheered');
        feedItemId = gift.feedItemId;
      }
      tx.bumpStat('cheersSent');
      tx.stmt(`UPDATE users SET inbox_unread = inbox_unread + 1, rev = rev + 1 WHERE id = ?`, to);
    } else if (gift.kind === 'item') {
      if (d.moves_n >= MOVES_PER_DAY) return fail(429, 'rate-limited', 'items per day');
      const inv = await tx.inventory();
      const item = ITEMS_BY_ID.get(gift.itemId);
      if (!item || !(inv.get(gift.itemId) ?? 0)) return fail(409, 'not-owned');
      ref = gift.itemId;
      tx.addItem(gift.itemId, -1);
      // Taking off what is no longer owned.
      if (!inv.has(gift.itemId) && !STARTER.has(gift.itemId)) {
        const avatar = parseAvatar(tx.u.avatar);
        const worn = { ...avatar.worn };
        let changed = false;
        for (const [slot, itemId] of Object.entries(worn)) {
          if (itemId === gift.itemId) {
            delete worn[slot as ItemSlot];
            changed = true;
          }
        }
        if (changed) tx.set('avatar', JSON.stringify({ ...avatar, worn }));
      }
      d.moves_n++;
      tx.stmt(
        `INSERT INTO inventory (user_id, item_id, count) VALUES (?, ?, 1) ON CONFLICT (user_id, item_id) DO UPDATE SET count = count + 1`,
        to, gift.itemId,
      );
      tx.stmt(
        `UPDATE users SET inbox_unread = inbox_unread + 1, rev = rev + 1,
           stats = json_set(stats, '$.giftsReceived', coalesce(json_extract(stats, '$.giftsReceived'), 0) + 1) WHERE id = ?`,
        to,
      );
    } else if (gift.kind === 'potion') {
      if (d.moves_n >= MOVES_PER_DAY) return fail(429, 'rate-limited', 'potions per day');
      if (tx.u.potions < 1) return fail(409, 'not-owned');
      const r = await db.prepare('SELECT potions FROM users WHERE id = ?').bind(to).first<{ potions: number }>();
      if (!r) return fail(404, 'not-found');
      if (r.potions >= MAX_STREAK_FREEZES) return fail(409, 'potions-full');
      tx.set('potions', tx.u.potions - 1);
      d.moves_n++;
      tx.stmt(
        `UPDATE users SET potions = potions + 1, inbox_unread = inbox_unread + 1, rev = rev + 1,
           stats = json_set(stats, '$.giftsReceived', coalesce(json_extract(stats, '$.giftsReceived'), 0) + 1)
         WHERE id = ? AND (CASE WHEN potions < ? THEN 1 ELSE json('potions-full') END)`,
        to, MAX_STREAK_FREEZES,
      );
    } else {
      return fail(400, 'bad-request', 'gift kind');
    }
    if (gift.kind !== 'cheer') tx.bumpStat('giftsSent');
    d.gifts_n++;
    tx.saveDaily();
    tx.stmt(
      'INSERT INTO gifts (id, from_id, to_id, kind, ref, feed_item_id, day, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      id, tx.id, to, gift.kind, ref, feedItemId, tx.today, tx.nowMs,
    );
    await tx.commit();
    return c.json<GiftResponse>({ patch: tx.patch });
  });
});

socialRoutes.get('/social/inbox', async (c) =>
  runTx(c, async (tx) => {
    const r = await tx.db
      .prepare(
        `SELECT g.*, u.name, u.avatar FROM gifts g LEFT JOIN users u ON u.id = g.from_id
         WHERE g.to_id = ? ORDER BY g.created_at DESC LIMIT 50`,
      )
      .bind(tx.id)
      .all<any>();
    const entries: InboxEntry[] = r.results.map((g) => ({
      id: g.id,
      from: { id: g.from_id, name: g.name ?? '?', avatar: parseAvatar(g.avatar ?? '') },
      gift:
        g.kind === 'cheer'
          ? { kind: 'cheer', cheerId: g.ref, ...(g.feed_item_id ? { feedItemId: g.feed_item_id } : {}) }
          : g.kind === 'item'
            ? { kind: 'item', itemId: g.ref }
            : { kind: 'potion' },
      day: g.day,
      seen: !!g.seen,
    }));
    if (tx.u.inbox_unread !== 0 || entries.some((e) => !e.seen)) {
      tx.set('inbox_unread', 0);
      tx.stmt('UPDATE gifts SET seen = 1 WHERE to_id = ? AND seen = 0', tx.id);
      await tx.commit();
      tx.patch.inboxUnread = 0;
    }
    return c.json<InboxResponse>({ entries, patch: tx.patch });
  }),
);
