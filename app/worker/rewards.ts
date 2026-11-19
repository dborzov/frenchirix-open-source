// Chests, the shop, scene views and client counters.
import { Hono } from 'hono';
import type { ChestKind, ChestOpenResponse, EventsRequest, EventsResponse, SceneViewResponse, ShopBuyRequest, ShopBuyResponse, ShopOffer, ShopResponse } from '../shared/api';
import { ITEMS, ITEMS_BY_ID, type Item, type Rarity, type Reward } from '../shared/catalog';
import { createRng, hashString, type Rng } from '../shared/practice/rng';
import { MAX_STREAK_FREEZES, XP, addDays } from '../shared/rules';
import { getContent } from './content';
import { ensureDaily } from './daily';
import type { AppEnv } from './env';
import { runTx } from './session';
import { STARTER_ITEMS, type UserTx } from './tx';
import { clampInt, cryptoRandom, fail, jsonBody } from './util';

// ---------------------------------------------------------------------------------------------
// Loot

export interface LootTable {
  sesterces: [number, number];
  xp: [number, number];
  potion: number; // probability
  item: number; // probability
  rarity: Record<Rarity, number>; // weights
}

export const LOOT: Record<ChestKind, LootTable> = {
  wood: { sesterces: [8, 16], xp: [5, 10], potion: 0.1, item: 0.25, rarity: { common: 70, rare: 25, epic: 5, legendary: 0 } },
  silver: { sesterces: [15, 30], xp: [10, 20], potion: 0.2, item: 0.5, rarity: { common: 50, rare: 35, epic: 13, legendary: 2 } },
  gold: { sesterces: [30, 60], xp: [20, 30], potion: 0.35, item: 0.8, rarity: { common: 30, rare: 40, epic: 22, legendary: 8 } },
};
/** An item already owned turns into this many sesterces; so does a potion when potions are full. */
export const DUPLICATE_SESTERCES: Record<Rarity, number> = { common: 10, rare: 25, epic: 50, legendary: 100 };
export const POTION_AS_SESTERCES = 15;

const between = (rng: Rng, [lo, hi]: [number, number]) => lo + rng.int(hi - lo + 1);

/** The raw roll of a chest: what it contains before owned items and full potions are converted. */
export function rollChest(kind: ChestKind, rng: Rng): { sesterces: number; xp: number; potion: boolean; item: Item | null } {
  const t = LOOT[kind];
  const sesterces = between(rng, t.sesterces);
  const xp = between(rng, t.xp);
  const potion = rng.next() < t.potion;
  let item: Item | null = null;
  if (rng.next() < t.item) {
    const pool = ITEMS.filter((i) => i.sources.some((s) => s.kind === 'chest' && s.chests.includes(kind)));
    const rarities = (Object.keys(t.rarity) as Rarity[]).filter((r) => t.rarity[r] > 0 && pool.some((i) => i.rarity === r));
    if (rarities.length) {
      const total = rarities.reduce((s, r) => s + t.rarity[r], 0);
      let x = rng.next() * total;
      let rarity = rarities[rarities.length - 1]!;
      for (const r of rarities) {
        x -= t.rarity[r];
        if (x < 0) {
          rarity = r;
          break;
        }
      }
      item = rng.pick(pool.filter((i) => i.rarity === rarity));
    }
  }
  return { sesterces, xp, potion, item };
}

// ---------------------------------------------------------------------------------------------
// Shop

export const POTION_PRICE = 50;
export const FEATURED = 3;
export const FEATURED_DISCOUNT = 0.8;

export function shopItems(): Item[] {
  return ITEMS.filter((i) => i.price !== null && i.sources.some((s) => s.kind === 'shop'));
}

/** Today's specials: the same for everyone on a day. */
export function featuredIds(day: string): Set<string> {
  const rng = createRng(hashString(`shop:${day}`));
  return new Set(rng.shuffle(shopItems().map((i) => i.id).sort()).slice(0, FEATURED));
}

export function priceOf(item: Item, featured: boolean): number {
  return featured ? Math.max(1, Math.round(item.price! * FEATURED_DISCOUNT)) : item.price!;
}

// ---------------------------------------------------------------------------------------------
// Per-request and per-day caps of client counters

export const CAPS = {
  loopsPerRequest: 200,
  loopsPerDay: 2000,
  songsPerRequest: 3,
  songsPerDay: 20,
  viewsPerDay: 30, // views that count (and earn XP) per day
};

export const rewardRoutes = new Hono<AppEnv>();

rewardRoutes.post('/chests/:id/open', async (c) => {
  const id = c.req.param('id');
  return runTx(c, async (tx) => {
    await tx.preload(['chests', 'inventory', 'achievements']);
    const chest = (await tx.chests()).find((x) => x.id === id);
    if (!chest) return fail(404, 'not-found');
    const roll = rollChest(chest.kind, createRng(hashString(`${id}:${Math.floor(cryptoRandom() * 1e9)}`)));
    const loot: Reward = { sesterces: roll.sesterces, xp: roll.xp };
    if (roll.potion) {
      if (tx.addPotions(1) === 0) loot.potions = 1;
      else loot.sesterces! += POTION_AS_SESTERCES;
    }
    if (roll.item) {
      const owned = await tx.ownedItems();
      if (owned.has(roll.item.id)) loot.sesterces! += DUPLICATE_SESTERCES[roll.item.rarity];
      else {
        tx.addItem(roll.item.id, 1);
        loot.items = [roll.item.id];
      }
    }
    tx.addSesterces(loot.sesterces!);
    tx.addXp(loot.xp!);
    tx.removeChest(id);
    tx.stmt('UPDATE chests SET opened_at = ?, loot = ? WHERE id = ? AND user_id = ? AND opened_at IS NULL', tx.nowMs, JSON.stringify(loot), id, tx.id);
    tx.bumpStat('chestsOpened');
    await tx.commit();
    return c.json<ChestOpenResponse>({ chest, loot, patch: tx.patch });
  });
});

rewardRoutes.get('/shop', async (c) =>
  runTx(c, async (tx) => {
    const inv = await tx.inventory();
    const featured = featuredIds(tx.today);
    const offers: ShopOffer[] = shopItems().map((i) => ({
      itemId: i.id,
      price: priceOf(i, featured.has(i.id)),
      owned: inv.get(i.id) ?? (STARTER_ITEMS.has(i.id) ? 1 : 0),
      featured: featured.has(i.id),
    }));
    offers.sort((a, b) => Number(b.featured) - Number(a.featured) || a.price - b.price);
    return c.json<ShopResponse>({
      offers,
      potionPrice: tx.u.potions >= MAX_STREAK_FREEZES ? null : POTION_PRICE,
      refreshesDay: addDays(tx.today, 1),
    });
  }),
);

rewardRoutes.post('/shop/buy', async (c) => {
  const body = await jsonBody<ShopBuyRequest>(c);
  return runTx(c, async (tx) => {
    await tx.preload(['inventory', 'achievements']);
    let price: number;
    if ('potion' in body && body.potion === true) {
      if (tx.u.potions >= MAX_STREAK_FREEZES) return fail(409, 'potions-full');
      price = POTION_PRICE;
      if (tx.u.sesterces < price) return fail(409, 'not-enough-sesterces');
      tx.addPotions(1);
    } else {
      const itemId = 'itemId' in body && typeof body.itemId === 'string' ? body.itemId : '';
      const item = ITEMS_BY_ID.get(itemId);
      if (!item || !shopItems().includes(item)) return fail(404, 'not-found');
      // A second tap, another tab or a stale shop page: never sell the same item twice.
      if (((await tx.inventory()).get(itemId) ?? 0) > 0 || STARTER_ITEMS.has(itemId)) return fail(409, 'already-owned');
      price = priceOf(item, featuredIds(tx.today).has(itemId));
      if (tx.u.sesterces < price) return fail(409, 'not-enough-sesterces');
      tx.addItem(itemId, 1);
      tx.bumpStat('itemsBought');
    }
    tx.addSesterces(-price);
    tx.bumpStat('sesterceSpent', price);
    await tx.commit();
    return c.json<ShopBuyResponse>({ patch: tx.patch });
  });
});

rewardRoutes.post('/scenes/:id/view', async (c) => {
  const sceneId = c.req.param('id');
  return runTx(c, async (tx) => {
    await tx.preload(['progress', 'daily', 'achievements']);
    const p = (await tx.progress()).get(sceneId);
    // A locked scene (a candidate watched before choosing) is not counted or rewarded.
    if (!p) return c.json<SceneViewResponse>({ patch: {} });
    const d = await ensureDaily(tx, await getContent(c.env));
    if (d.views_n < CAPS.viewsPerDay) {
      d.views_n++;
      tx.saveDaily();
      tx.setProgress(sceneId, { ...p, views: p.views + 1 });
      tx.addXp(XP.view);
      await tx.commit();
    }
    return c.json<SceneViewResponse>({ patch: tx.patch });
  });
});

rewardRoutes.post('/events', async (c) => {
  const body = await jsonBody<Partial<EventsRequest>>(c);
  return runTx(c, async (tx) => {
    await tx.preload(['daily', 'progress', 'achievements']);
    const d = await ensureDaily(tx, await getContent(c.env));
    let loops = 0;
    let songs = 0;
    for (const e of Array.isArray(body.events) ? body.events.slice(0, 100) : []) {
      if (e?.stat === 'loopsHeard') loops += clampInt(e.n, 0, CAPS.loopsPerRequest);
      else if (e?.stat === 'songsSung') songs += clampInt(e.n, 0, CAPS.songsPerRequest);
    }
    loops = Math.max(0, Math.min(loops, CAPS.loopsPerRequest, CAPS.loopsPerDay - d.loops_n));
    songs = Math.max(0, Math.min(songs, CAPS.songsPerRequest, CAPS.songsPerDay - d.songs_n));
    if (loops || songs) {
      d.loops_n += loops;
      d.songs_n += songs;
      tx.saveDaily();
      tx.bumpStat('loopsHeard', loops);
      tx.bumpStat('songsSung', songs);
      await tx.commit();
    }
    return c.json<EventsResponse>({ patch: tx.patch });
  });
});
