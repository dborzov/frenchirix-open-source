// What comes out of a loot box, one piece at a time. Pure; tested in pieces.test.ts.
import type { Rarity, Reward } from '../../../shared/catalog';
import { ITEMS_BY_ID } from '../../../shared/catalog';
import type { ChestKind } from '../../../shared/rules';

export type LootPiece =
  | { kind: 'sesterces'; n: number }
  | { kind: 'xp'; n: number }
  | { kind: 'potions'; n: number }
  | { kind: 'chest'; chest: ChestKind }
  | { kind: 'item'; itemId: string; rarity: Rarity };

const RARITY_ORDER: Record<Rarity, number> = { common: 0, rare: 1, epic: 2, legendary: 3 };

/** The pieces of a reward in reveal order: coins, XP, potions, a chest, then items rarest last (the climax). */
export function lootPieces(reward: Reward): LootPiece[] {
  const out: LootPiece[] = [];
  if (reward.sesterces) out.push({ kind: 'sesterces', n: reward.sesterces });
  if (reward.xp) out.push({ kind: 'xp', n: reward.xp });
  if (reward.potions) out.push({ kind: 'potions', n: reward.potions });
  if (reward.chest) out.push({ kind: 'chest', chest: reward.chest });
  const items = (reward.items ?? []).map((itemId) => ({ kind: 'item' as const, itemId, rarity: ITEMS_BY_ID.get(itemId)?.rarity ?? 'common' }));
  items.sort((a, b) => RARITY_ORDER[a.rarity] - RARITY_ORDER[b.rarity]);
  return [...out, ...items];
}

/** The best rarity among the pieces, for the size of the fanfare. */
export function bestRarity(pieces: readonly LootPiece[]): Rarity | null {
  let best: Rarity | null = null;
  for (const p of pieces) if (p.kind === 'item' && (best === null || RARITY_ORDER[p.rarity] > RARITY_ORDER[best])) best = p.rarity;
  return best;
}

/** Design-system colour of a rarity. */
export const RARITY_COLOR: Record<Rarity, 'cyan' | 'blue' | 'purple' | 'yellow'> = {
  common: 'cyan',
  rare: 'blue',
  epic: 'purple',
  legendary: 'yellow',
};

export function rarityRank(r: Rarity): number {
  return RARITY_ORDER[r];
}
