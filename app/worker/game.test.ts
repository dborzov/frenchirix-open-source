import { beforeEach, describe, expect, it } from 'vitest';
import { ACHIEVEMENTS_BY_ID, ITEMS } from '../shared/catalog';
import { createRng } from '../shared/practice/rng';
import { LEVEL_WAIT_DAYS, MAX_STREAK_FREEZES, addDays } from '../shared/rules';
import { LOOT, rollChest } from './rewards';
import { Browser, db, freshWorld, playPractice, unlockSome } from './testing';

beforeEach(freshWorld);

const DAY = '2026-11-13';

describe('candidates and unlocking', () => {
  it('keeps the candidates for the day, allows 3 unlocks from them only', async () => {
    const b = new Browser();
    const s = await b.start();
    const candidates = s.daily.candidates.map((o: any) => o.sceneId);
    expect((await b.ok('GET', '/api/daily')).daily.candidates.map((o: any) => o.sceneId)).toEqual(candidates);
    expect((await b.json('POST', '/api/daily/unlock', { sceneId: 's01e01-9999-9999' })).body.error).toBe('not-offered');
    for (const id of candidates.slice(0, 3)) {
      const r = await b.ok('POST', '/api/daily/unlock', { sceneId: id });
      expect(r.patch.progress[id]).toMatchObject({ level: 0, dueDay: null, unlockedDay: DAY });
    }
    expect((await b.json('POST', '/api/daily/unlock', { sceneId: candidates[0] })).body.error).toBe('already-unlocked');
    expect((await b.json('POST', '/api/daily/unlock', { sceneId: candidates[3] })).body.error).toBe('no-unlocks-left');
    const d = (await b.ok('GET', '/api/daily')).daily;
    expect(d.unlocksLeft).toBe(0);
    expect(d.quests[0]).toMatchObject({ kind: 'choose', done: true, chosen: 3, target: 3 });
    expect(d.quests.slice(1).map((q: any) => q.sceneId)).toEqual(candidates.slice(0, 3));
    // Next day: new candidates, unlocked scenes are never offered again.
    b.at(addDays(DAY, 1));
    const d2 = (await b.ok('GET', '/api/daily')).daily;
    expect(d2.day).toBe(addDays(DAY, 1));
    expect(d2.unlocksLeft).toBe(3);
    for (const o of d2.candidates) expect(candidates.slice(0, 3)).not.toContain(o.sceneId);
  });

  it('refuses a practice on a scene not unlocked yet, a candidate included', async () => {
    const b = new Browser();
    const s = await b.start();
    const r = await b.json('POST', '/api/practices/start', { kind: 'scene', sceneId: s.daily.candidates[0].sceneId });
    expect([r.status, r.body.error]).toEqual([403, 'scene-locked']);
  });
});

describe('practices and levels', () => {
  it('climbs the whole ladder to plutonium across days; an early repeat never raises a level', async () => {
    const b = new Browser();
    await b.start();
    const id = (await unlockSome(b, 1))[0]!;
    let day = DAY;
    const scene = async () => playPractice(b.at(day), { kind: 'scene', sceneId: id });
    let r = await scene();
    expect(r.levels[0]).toMatchObject({ from: 0, to: 1, dueDay: addDays(day, 1) });
    // Same day again: practice, no rise.
    r = await scene();
    expect(r.levels).toEqual([]);
    expect(r.replayed).toEqual([id]);
    for (let m = 1; m <= 5; m++) {
      const wait = LEVEL_WAIT_DAYS[m - 1]!;
      if (wait > 1) {
        // The day before it is due: still practice.
        day = addDays(day, wait - 1);
        r = await scene();
        expect(r.levels, `level ${m} early`).toEqual([]);
        day = addDays(day, 1);
      } else day = addDays(day, 1);
      r = await scene();
      expect(r.levels[0], `level ${m + 1}`).toMatchObject({ from: m, to: m + 1, dueDay: m + 1 === 6 ? null : addDays(day, LEVEL_WAIT_DAYS[m]!) });
    }
    const p = (await b.ok('GET', '/api/me')).state.progress[id];
    expect(p.level).toBe(6);
    expect(p.dueDay).toBeNull();
    day = addDays(day, 30);
    expect((await scene()).replayed).toEqual([id]);
  });

  it('missed units become focus units', async () => {
    const b = new Browser();
    await b.start();
    const id = (await unlockSome(b, 1))[0]!;
    const { FIXTURE_SCENE } = await import('../shared/fixtures');
    // fixtureSceneFor serves the fixture's lines under every id; use ids that parse into this scene's range.
    const { plan } = await b.ok('POST', '/api/practices/start', { kind: 'scene', sceneId: id });
    const m = /^(s\d+e\d+)-(\d+)-/.exec(id)!;
    const unit = `${m[1]}-${m[2]}:1`;
    await b.ok('POST', `/api/practices/${plan.id}/complete`, {
      outcomes: [{ puzzleId: 'a', type: 'match', sceneId: id, unitIds: [unit, 'zzz:1'], missedUnitIds: [unit], mistakes: 2, hints: 0, skipped: false, ms: 1 }],
      ms: 1,
    });
    const row = await db().prepare('SELECT * FROM unit_stats').all<any>();
    expect(row.results.map((r) => [r.unit_id, r.seen, r.missed])).toEqual([[unit, 1, 1]]);
    expect((await b.ok('POST', '/api/practices/start', { kind: 'scene', sceneId: id })).plan.focusUnitIds).toEqual([unit]);
    expect(FIXTURE_SCENE).toBeTruthy();
  });
});

describe('streak', () => {
  async function practiceOn(b: Browser, day: string) {
    b.at(day);
    if (!Object.keys((await b.ok('GET', '/api/me')).state.progress).length) await unlockSome(b, 1);
    const sceneId = Object.keys((await b.ok('GET', '/api/me')).state.progress)[0]!;
    return playPractice(b, { kind: 'scene', sceneId });
  }

  it('grows day by day, resets after a missed day without a freeze', async () => {
    const b = new Browser();
    await b.start();
    expect((await practiceOn(b, DAY)).streak.count).toBe(1);
    expect((await practiceOn(b, addDays(DAY, 1))).streak.count).toBe(2);
    b.at(addDays(DAY, 3));
    expect((await b.ok('GET', '/api/me')).state.streak.count).toBe(0);
    const r = await practiceOn(b, addDays(DAY, 3));
    expect(r.streak).toEqual({ count: 1, extended: true, freezesUsed: 0, reset: true, full: false });
  });

  it('a potion saves one missed day', async () => {
    const b = new Browser();
    const s = await b.start();
    await db().prepare('UPDATE users SET potions = 1 WHERE id = ?').bind(s.profile.id).run();
    await practiceOn(b, DAY);
    await practiceOn(b, addDays(DAY, 1));
    b.at(addDays(DAY, 3));
    expect((await b.ok('GET', '/api/me')).state.streak.count).toBe(2);
    const r = await practiceOn(b, addDays(DAY, 3));
    expect(r.streak).toEqual({ count: 3, extended: true, freezesUsed: 1, reset: false, full: false });
    expect(r.patch.currencies.potions).toBe(0);
    // The missed day shows as saved by the potion.
    expect(r.patch.streak.week.slice(-3).map((x: any) => x.kind)).toEqual(['light', 'saved', 'light']);
    expect(r.achievements).toContain('streak-3');
    expect(r.patch.inventory['polka-dot-toga']).toBe(1);
  });
});

describe('chests and achievements', () => {
  it('rolls loot by tier: always sesterces and XP, items only from chest sources', () => {
    const rng = createRng(42);
    const chestItems = new Set(ITEMS.filter((i) => i.sources.some((s) => s.kind === 'chest')).map((i) => i.id));
    let items = { wood: 0, gold: 0 };
    for (let i = 0; i < 2000; i++) {
      for (const kind of ['wood', 'gold'] as const) {
        const r = rollChest(kind, rng);
        expect(r.sesterces).toBeGreaterThanOrEqual(LOOT[kind].sesterces[0]);
        expect(r.xp).toBeGreaterThanOrEqual(LOOT[kind].xp[0]);
        if (r.item) {
          expect(chestItems.has(r.item.id)).toBe(true);
          expect(r.item.sources.some((s) => s.kind === 'chest' && s.chests.includes(kind))).toBe(true);
          items[kind]++;
        }
      }
    }
    expect(items.gold).toBeGreaterThan(items.wood);
  });

  it('opens a chest once, adds the loot', async () => {
    const b = new Browser();
    await b.start();
    const [sceneId] = await unlockSome(b, 1);
    const done = await playPractice(b, { kind: 'scene', sceneId }); // its bronze quest gives a chest
    const before = (await b.ok('GET', '/api/me')).state;
    const r = await b.ok('POST', `/api/chests/${done.chest.id}/open`);
    expect(r.loot.sesterces).toBeGreaterThan(0);
    expect(r.loot.xp).toBeGreaterThan(0);
    const fromAchievements = Object.keys(r.patch.achievements ?? {}).reduce((n, id) => n + (ACHIEVEMENTS_BY_ID.get(id)!.reward.sesterces ?? 0), 0);
    expect(r.patch.currencies.sesterces).toBe(before.currencies.sesterces + r.loot.sesterces + fromAchievements);
    expect(r.patch.chests.remove).toEqual([done.chest.id]);
    expect(r.patch.stats.chestsOpened).toBe(1);
    expect((await b.json('POST', `/api/chests/${done.chest.id}/open`)).status).toBe(404);
  });

  it('grants an achievement once with its reward (a chest and a potion for 10 unlocks)', async () => {
    const b = new Browser();
    await b.start();
    let day = DAY;
    let got: any = null;
    for (let i = 0; i < 4 && !got; i++, day = addDays(day, 1)) {
      b.at(day);
      const d = (await b.ok('GET', '/api/daily')).daily;
      for (const o of d.candidates.filter((x: any) => !x.unlocked).slice(0, d.unlocksLeft)) {
        const r = await b.ok('POST', '/api/daily/unlock', { sceneId: o.sceneId });
        if (r.patch.achievements?.['unlock-10']) got = r;
      }
    }
    expect(got.patch.stats.scenesUnlocked).toBe(10);
    expect(got.patch.chests.add).toEqual([expect.objectContaining({ kind: 'silver', source: 'achievement' })]);
    expect(got.patch.currencies.potions).toBe(1);
    const me = (await b.ok('GET', '/api/me')).state;
    expect(me.achievements['unlock-10']).toMatchObject({ seen: false });
    await b.ok('PATCH', '/api/me', { seenAchievements: ['unlock-10'] });
    expect((await b.ok('GET', '/api/me')).state.achievements['unlock-10'].seen).toBe(true);
    const n = await db().prepare('SELECT count(*) AS n FROM achievements WHERE achievement_id = ?').bind('unlock-10').first<{ n: number }>();
    expect(n!.n).toBe(1);
  });
});

describe('shop', () => {
  it('sells catalog items and potions, checks money and the potion cap', async () => {
    const b = new Browser();
    const s = await b.start();
    const shop = await b.ok('GET', '/api/shop');
    expect(shop.offers.length).toBeGreaterThan(0);
    const offer = shop.offers.find((o: any) => o.owned === 0)!;
    expect((await b.json('POST', '/api/shop/buy', { itemId: offer.itemId })).body.error).toBe('not-enough-sesterces');
    await db().prepare('UPDATE users SET sesterces = 1000 WHERE id = ?').bind(s.profile.id).run();
    const r = await b.ok('POST', '/api/shop/buy', { itemId: offer.itemId });
    expect(r.patch.inventory[offer.itemId]).toBe(1);
    expect(r.patch.currencies.sesterces).toBe(1000 - offer.price);
    // Never sold twice (a second tap, another tab, a stale shop page): nothing is charged.
    const twice = await b.json('POST', '/api/shop/buy', { itemId: offer.itemId });
    expect(twice.status).toBe(409);
    expect(twice.body.error).toBe('already-owned');
    expect((await b.ok('GET', '/api/me')).state.currencies.sesterces).toBe(1000 - offer.price);
    const starter = shop.offers.find((o: any) => o.owned > 0);
    if (starter) expect((await b.json('POST', '/api/shop/buy', { itemId: starter.itemId })).body.error).toBe('already-owned');
    expect((await b.json('POST', '/api/shop/buy', { itemId: 'polka-dot-toga' })).body.error).toBe('not-found');
    for (let i = 0; i < MAX_STREAK_FREEZES; i++) await b.ok('POST', '/api/shop/buy', { potion: true });
    expect((await b.json('POST', '/api/shop/buy', { potion: true })).body.error).toBe('potions-full');
    expect((await b.ok('GET', '/api/shop')).potionPrice).toBeNull();
    // Wearing it is now allowed.
    const item = ITEMS.find((i) => i.id === offer.itemId)!;
    expect((await b.json('PATCH', '/api/me', { avatar: { v: 1, base: {}, worn: { [item.slot]: item.id } } })).status).toBe(200);
  });
});

describe('views and counters', () => {
  it('counts views of unlocked scenes and caps client counters', async () => {
    const b = new Browser();
    await b.start();
    const id = (await unlockSome(b, 1))[0]!;
    const v = await b.ok('POST', `/api/scenes/${id}/view`, {});
    expect(v.patch.progress[id].views).toBe(1);
    expect(v.patch.stats.scenesViewed).toBe(1);
    const locked = await b.json('POST', '/api/scenes/s01e01-0004-0008x/view', {});
    expect(locked).toEqual({ status: 200, body: { patch: {} } });
    const e = await b.ok('POST', '/api/events', { events: [{ stat: 'loopsHeard', n: 1e9 }, { stat: 'songsSung', n: 2 }, { stat: 'xp', n: 99 }] });
    expect(e.patch.stats.loopsHeard).toBe(200);
    expect(e.patch.stats.songsSung).toBe(2);
    expect(e.patch.stats.xp).toBeUndefined();
  });
});
