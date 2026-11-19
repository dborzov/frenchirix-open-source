import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CHEST_KINDS } from '../rules';
import {
  ACHIEVEMENTS,
  ACHIEVEMENTS_BY_ID,
  AVATAR_BASE_KEYS,
  AVATAR_BASE_OPTIONS,
  CHEERS,
  CHEST_RARITY_ODDS,
  DEFAULT_AVATAR,
  ITEM_SLOTS,
  ITEMS,
  ITEMS_BY_ID,
  chestItems,
  defaultAvatar,
  randomAvatar,
  resolveBase,
  starterItems,
  validateAvatar,
  type Avatar,
  type Rarity,
} from '.';

describe('catalog', () => {
  it('has unique ids', () => {
    for (const list of [ITEMS, ACHIEVEMENTS, CHEERS] as { id: string }[][]) {
      const ids = list.map((x) => x.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it('has enough of everything', () => {
    expect(ITEMS.length).toBeGreaterThanOrEqual(70);
    expect(ACHIEVEMENTS.length).toBeGreaterThanOrEqual(35);
    expect(CHEERS.length).toBeGreaterThanOrEqual(12);
    for (const r of ['common', 'rare', 'epic', 'legendary'] as Rarity[]) expect(ITEMS.some((i) => i.rarity === r)).toBe(true);
  });

  it('asks for every release scene in unlock-all', () => {
    const release = JSON.parse(readFileSync(new URL('../../data/release.json', import.meta.url), 'utf8')) as { scenes: string[] };
    expect(ACHIEVEMENTS_BY_ID.get('unlock-all')?.condition.gte).toBe(release.scenes.length);
  });

  it('keeps the starter ids the fixtures use', () => {
    for (const id of ['winged-helmet', 'squeaky-lyre', 'polka-dot-toga']) expect(ITEMS_BY_ID.has(id)).toBe(true);
    for (const id of ['first-lesson', 'streak-3', 'unlock-10']) expect(ACHIEVEMENTS_BY_ID.has(id)).toBe(true);
    for (const id of ['bravo', 'par-toutatis', 'menhir']) expect(CHEERS.some((c) => c.id === id)).toBe(true);
  });

  it('gives every slot starter options', () => {
    for (const slot of ITEM_SLOTS) expect(starterItems(slot).length, slot).toBeGreaterThan(0);
  });

  it('names, jokes and prices every item sensibly', () => {
    for (const i of ITEMS) {
      expect(i.name.fr && i.name.en && i.joke.fr && i.joke.en, i.id).toBeTruthy();
      expect(i.sources.length, i.id).toBeGreaterThan(0);
      const inShop = i.sources.some((s) => s.kind === 'shop');
      expect(inShop, `${i.id}: shop source iff price`).toBe(i.price !== null);
      if (i.price !== null) expect(i.price, i.id).toBeGreaterThan(0);
      const starter = i.sources.some((s) => s.kind === 'starter');
      if (starter) expect(i.sources.length, `${i.id}: a starter is only a starter`).toBe(1);
    }
  });

  it('links achievement items both ways', () => {
    for (const a of ACHIEVEMENTS) {
      expect(a.name.fr && a.name.en && a.description.fr && a.description.en, a.id).toBeTruthy();
      expect(a.condition.gte, a.id).toBeGreaterThan(0);
      const r = a.reward;
      expect(Boolean(r.items?.length || r.sesterces || r.potions || r.chest || r.xp), `${a.id} has a reward`).toBe(true);
      for (const itemId of r.items ?? []) {
        const item = ITEMS_BY_ID.get(itemId);
        expect(item, `${a.id} rewards unknown ${itemId}`).toBeDefined();
        expect(
          item!.sources.some((s) => s.kind === 'achievement' && s.achievementId === a.id),
          `${itemId} is marked as the reward of ${a.id}`,
        ).toBe(true);
      }
    }
    for (const i of ITEMS) {
      for (const s of i.sources) {
        if (s.kind !== 'achievement') continue;
        expect(ACHIEVEMENTS_BY_ID.get(s.achievementId)?.reward.items, `${i.id} -> ${s.achievementId}`).toContain(i.id);
      }
    }
  });

  it('has chest odds that sum to one and items for every possible drop', () => {
    for (const kind of CHEST_KINDS) {
      const odds = CHEST_RARITY_ODDS[kind];
      expect(Object.values(odds).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
      for (const [rarity, p] of Object.entries(odds)) if (p > 0) expect(chestItems(kind, rarity as Rarity).length, `${kind}/${rarity}`).toBeGreaterThan(0);
    }
  });
});

describe('avatar', () => {
  it('accepts the default avatar and starter items without owning them', () => {
    expect(validateAvatar(DEFAULT_AVATAR, [])).toEqual([]);
    expect(validateAvatar({ ...DEFAULT_AVATAR, worn: { hat: 'winged-helmet', top: 'red-tunic' } }, [])).toEqual([]);
  });

  it('rejects unknown and unowned things', () => {
    const base = DEFAULT_AVATAR;
    expect(validateAvatar({ ...base, worn: { hat: 'no-such-hat' } }, [])).toHaveLength(1);
    expect(validateAvatar({ ...base, worn: { hat: 'squeaky-lyre' } }, ['squeaky-lyre'])).toHaveLength(1);
    expect(validateAvatar({ ...base, worn: { held: 'squeaky-lyre' } }, [])).toHaveLength(1);
    expect(validateAvatar({ ...base, worn: { held: 'squeaky-lyre' } }, ['squeaky-lyre'])).toEqual([]);
    expect(validateAvatar({ ...base, base: { ...base.base, skin: 'purple' } }, [])).toHaveLength(1);
    expect(validateAvatar({ ...base, base: { ...base.base, tail: 'yes' } }, [])).toHaveLength(1);
    expect(validateAvatar({ ...base, worn: { tail: 'x' } } as unknown as Avatar, [])).toHaveLength(1);
    expect(validateAvatar({ ...base, v: 99 }, [])).toHaveLength(1);
  });

  it('makes a valid, deterministic, varied default avatar per seed', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const av = defaultAvatar(`u_${i}`);
      expect(validateAvatar(av, [])).toEqual([]);
      expect(defaultAvatar(`u_${i}`)).toEqual(av);
      expect(av.worn.top && av.worn.bottom && av.worn.feet).toBeTruthy();
      seen.add(JSON.stringify(av));
    }
    expect(seen.size).toBeGreaterThan(45);
  });

  it('surprises only with owned items', () => {
    for (let i = 0; i < 30; i++) expect(validateAvatar(randomAvatar(i, ['squeaky-lyre', 'cat']), ['squeaky-lyre', 'cat'])).toEqual([]);
  });

  it('resolves missing base keys to defaults', () => {
    const b = resolveBase({ base: { skin: 's7' } });
    expect(b.skin).toBe('s7');
    for (const k of AVATAR_BASE_KEYS) expect((AVATAR_BASE_OPTIONS[k] as readonly string[]).includes(b[k])).toBe(true);
  });
});
