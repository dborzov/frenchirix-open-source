import { describe, expect, it } from 'vitest';
import { ITEMS } from '../../../shared/catalog';
import { bestRarity, lootPieces } from './pieces';

describe('lootPieces', () => {
  it('puts coins, XP and potions first, items last', () => {
    const items = ITEMS.slice(0, 2).map((i) => i.id);
    const pieces = lootPieces({ items, sesterces: 10, xp: 5, potions: 1 });
    expect(pieces.map((p) => p.kind)).toEqual(['sesterces', 'xp', 'potions', 'item', 'item']);
  });

  it('reveals the rarest item last', () => {
    const sorted = [...ITEMS].sort((a, b) => a.rarity.localeCompare(b.rarity));
    const pieces = lootPieces({ items: sorted.map((i) => i.id) });
    const ranks = pieces.map((p) => (p.kind === 'item' ? ['common', 'rare', 'epic', 'legendary'].indexOf(p.rarity) : -1));
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
  });

  it('is empty for an empty reward and has no best rarity', () => {
    expect(lootPieces({})).toEqual([]);
    expect(bestRarity([])).toBeNull();
  });

  it('treats an unknown item as common', () => {
    const pieces = lootPieces({ items: ['no-such-item'] });
    expect(pieces).toEqual([{ kind: 'item', itemId: 'no-such-item', rarity: 'common' }]);
  });
});
