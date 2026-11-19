// Types of the catalog: avatar items, achievements, cheers. Adding an item or an achievement is
// adding data in this directory; the server and the client read the same catalog.

import type { ChestKind } from '../rules';

export interface Localized {
  fr: string;
  en: string;
}

/** Where an item is worn on the avatar. `held` covers sports equipment and musical instruments. */
export type ItemSlot = 'hat' | 'hair' | 'face' | 'top' | 'bottom' | 'feet' | 'held' | 'back' | 'pet' | 'background';
export const ITEM_SLOTS: readonly ItemSlot[] = ['hat', 'hair', 'face', 'top', 'bottom', 'feet', 'held', 'back', 'pet', 'background'];

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';

/** One way to get an item. An item may have several. */
export type ItemSource =
  | { kind: 'starter' } // every kid owns it from the start
  | { kind: 'shop' } // bought with sesterces at `price`
  | { kind: 'chest'; chests: ChestKind[] } // can drop from these loot boxes
  | { kind: 'achievement'; achievementId: string } // the reward of an achievement
  | { kind: 'gift' }; // only received from a friend

export interface Item {
  id: string; // kebab-case, stable forever (stored in inventories)
  slot: ItemSlot;
  name: Localized;
  joke: Localized; // one funny line shown with the item
  rarity: Rarity;
  sources: ItemSource[];
  price: number | null; // sesterces in the shop; null when not sold
  art?: string; // key of the item's art in web/src/avatar; defaults to the id
}

/**
 * The kid's avatar. `base` holds the free body choices, one option id per key of
 * AVATAR_BASE_OPTIONS (avatar.ts): skin, hair, hairColor, eyes, brows, mouth, facialHair, bgColor.
 * A missing key means that key's default. `worn` maps a slot to an owned item id; a missing slot
 * means nothing worn there. Check with validateAvatar before saving.
 */
export interface Avatar {
  v: number; // format version
  base: Record<string, string>;
  worn: Partial<Record<ItemSlot, string>>;
}

export const DEFAULT_AVATAR: Avatar = {
  v: 1,
  base: { skin: 's3', hair: 'tuft', hairColor: 'blond', eyes: 'round', mouth: 'smile' },
  worn: {},
};

/** Counters the server keeps per kid; achievements are conditions over them. */
export type StatKey =
  | 'practicesFinished' // practices finished, replays included
  | 'perfectPractices' // practices finished with no mistake and no hint
  | 'questsDone' // daily quests done, extra ones included
  | 'puzzlesFinished'
  | 'streak'
  | 'bestStreak'
  | 'daysPractised'
  | 'scenesUnlocked'
  | 'scenesViewed'
  | 'scenesBronze' // scenes at bronze or better
  | 'scenesSilver'
  | 'scenesGold'
  | 'scenesTitanium'
  | 'scenesDiamond'
  | 'scenesPlutonium'
  | 'linesSpoken'
  | 'loopsHeard'
  | 'songsSung'
  | 'questionsAnswered'
  | 'xp'
  | 'follows'
  | 'followers'
  | 'cheersSent'
  | 'giftsSent'
  | 'giftsReceived'
  | 'bestFriendStreak'
  | 'chestsOpened'
  | 'itemsOwned'
  | 'itemsBought'
  | 'sesterceSpent'
  | 'episodesComplete'; // episodes whose every scene is unlocked (0-5)

/** What a kid gets from an achievement or a chest. */
export interface Reward {
  xp?: number;
  sesterces?: number;
  potions?: number;
  items?: string[]; // item ids
  chest?: ChestKind;
}

export interface Achievement {
  id: string;
  name: Localized;
  description: Localized;
  condition: { stat: StatKey; gte: number };
  reward: Reward;
  rewardName?: Localized; // the named reward announced ("un nouveau costume de dinosaure")
  secret?: boolean; // hidden until earned
}

/** A sticker friends can send each other. No free text anywhere. */
export interface Cheer {
  id: string;
  name: Localized;
  art: string; // key of the sticker art in the client
  color: string; // a CSS colour token name, e.g. 'unit-3'
}
