// The avatar's free body choices, the default avatar of a new kid, and the check before saving.
// Option ids are stored in D1 inside the avatar: never rename one, only add. The client draws each
// option (web/src/avatar/); a test there checks every id here has art.

import { ITEMS, ITEMS_BY_ID } from './items';
import { ITEM_SLOTS, type Avatar, type Item, type ItemSlot } from './types';

/** The free choices in `Avatar.base`, key -> option ids. The first id of each list is its default. */
export const AVATAR_BASE_OPTIONS = {
  skin: ['s3', 's1', 's2', 's4', 's5', 's6', 's7', 's8', 's9', 's10'],
  hair: ['tuft', 'short', 'bowl', 'spiky', 'curly', 'long', 'braids', 'ponytail', 'bun', 'afro', 'mohawk', 'pigtails', 'wavy', 'bald'],
  hairColor: ['blond', 'ginger', 'auburn', 'brown', 'black', 'grey', 'white', 'red', 'blue', 'pink', 'green', 'purple'],
  eyes: ['round', 'happy', 'wide', 'sleepy', 'wink', 'sparkle'],
  brows: ['normal', 'thick', 'raised', 'cross', 'none'],
  mouth: ['smile', 'grin', 'laugh', 'tongue', 'oh', 'smirk'],
  facialHair: ['none', 'droopy', 'handlebar', 'curly', 'walrus', 'beard', 'long-beard', 'braided-beard', 'goatee'],
  bgColor: ['sky', 'mint', 'sun', 'peach', 'lilac', 'rose', 'lime', 'teal'],
} as const satisfies Record<string, readonly string[]>;

export type AvatarBaseKey = keyof typeof AVATAR_BASE_OPTIONS;
export const AVATAR_BASE_KEYS = Object.keys(AVATAR_BASE_OPTIONS) as AvatarBaseKey[];
export type AvatarBase = { [K in AvatarBaseKey]: (typeof AVATAR_BASE_OPTIONS)[K][number] };

export const AVATAR_VERSION = 1;

/** The full base of an avatar, with every missing or unknown choice replaced by its default. */
export function resolveBase(avatar: Pick<Avatar, 'base'> | null | undefined): AvatarBase {
  const out = {} as Record<string, string>;
  for (const key of AVATAR_BASE_KEYS) {
    const options = AVATAR_BASE_OPTIONS[key] as readonly string[];
    const v = avatar?.base?.[key];
    out[key] = v && options.includes(v) ? v : options[0]!;
  }
  return out as AvatarBase;
}

/** Every kid owns these items from the start. */
export function isStarterItem(item: Item): boolean {
  return item.sources.some((s) => s.kind === 'starter');
}
export const STARTER_ITEM_IDS: ReadonlySet<string> = new Set(ITEMS.filter(isStarterItem).map((i) => i.id));

/** Starter items of a slot. */
export function starterItems(slot: ItemSlot): Item[] {
  return ITEMS.filter((i) => i.slot === slot && isStarterItem(i));
}

/**
 * Problems with an avatar a kid wants to save; empty means fine. Rejects unknown base choices,
 * unknown slots, unknown items, items in the wrong slot, and items the kid does not own (starter
 * items are owned by everyone).
 */
export function validateAvatar(avatar: Avatar, ownedItemIds: ReadonlySet<string> | readonly string[]): string[] {
  if (!avatar || typeof avatar !== 'object') return ['avatar is not an object'];
  const owned = ownedItemIds instanceof Set ? ownedItemIds : new Set(ownedItemIds as readonly string[]);
  const problems: string[] = [];
  if (typeof avatar.v !== 'number' || avatar.v < 1 || avatar.v > AVATAR_VERSION) problems.push(`unknown version ${String(avatar.v)}`);
  if (!avatar.base || typeof avatar.base !== 'object') problems.push('base is not an object');
  else {
    for (const [key, value] of Object.entries(avatar.base)) {
      const options = (AVATAR_BASE_OPTIONS as Record<string, readonly string[]>)[key];
      if (!options) problems.push(`unknown base choice ${key}`);
      else if (typeof value !== 'string' || !options.includes(value)) problems.push(`unknown ${key} ${String(value)}`);
    }
  }
  if (!avatar.worn || typeof avatar.worn !== 'object') problems.push('worn is not an object');
  else {
    for (const [slot, itemId] of Object.entries(avatar.worn)) {
      if (!(ITEM_SLOTS as readonly string[]).includes(slot)) {
        problems.push(`unknown slot ${slot}`);
        continue;
      }
      if (itemId === undefined || itemId === null || itemId === '') continue;
      const item = typeof itemId === 'string' ? ITEMS_BY_ID.get(itemId) : undefined;
      if (!item) problems.push(`unknown item ${String(itemId)}`);
      else if (item.slot !== slot) problems.push(`${itemId} does not go in slot ${slot}`);
      else if (!owned.has(itemId) && !STARTER_ITEM_IDS.has(itemId)) problems.push(`${itemId} is not owned`);
    }
  }
  return problems;
}

// A small deterministic hash and generator, so a seed always gives the same avatar.
function hash(seed: string | number): number {
  const s = String(seed);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function generator(seed: string | number): () => number {
  let a = hash(seed) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function pick<T>(next: () => number, list: readonly T[]): T {
  return list[Math.floor(next() * list.length)]!;
}

const NATURAL_HAIR = ['blond', 'ginger', 'auburn', 'brown', 'black', 'brown', 'black', 'blond'] as const;

/**
 * A decent-looking starting avatar, different for each seed (use the kid's id). Natural hair
 * colours, a friendly face, starter clothes only.
 */
export function defaultAvatar(seed: string | number): Avatar {
  const next = generator(seed);
  const hair = pick(next, AVATAR_BASE_OPTIONS.hair.filter((h) => h !== 'bald' && h !== 'mohawk'));
  const base: AvatarBase = {
    skin: pick(next, AVATAR_BASE_OPTIONS.skin),
    hair,
    hairColor: next() < 0.1 ? pick(next, ['red', 'blue', 'pink', 'green', 'purple'] as const) : pick(next, NATURAL_HAIR),
    eyes: pick(next, ['round', 'round', 'happy', 'wide', 'sparkle'] as const),
    brows: pick(next, ['normal', 'normal', 'thick', 'raised'] as const),
    mouth: pick(next, ['smile', 'smile', 'grin', 'laugh'] as const),
    facialHair: next() < 0.2 ? pick(next, ['droopy', 'handlebar', 'curly', 'walrus'] as const) : 'none',
    bgColor: pick(next, AVATAR_BASE_OPTIONS.bgColor),
  };
  const worn: Avatar['worn'] = {};
  for (const slot of ['top', 'bottom', 'feet'] as const) {
    const options = starterItems(slot);
    if (options.length) worn[slot] = pick(next, options).id;
  }
  if (next() < 0.35) {
    const hats = starterItems('hat');
    if (hats.length) worn.hat = pick(next, hats).id;
  }
  return { v: AVATAR_VERSION, base, worn };
}

/** A random avatar from the choices and items the kid owns (the editor's "surprise me"). */
export function randomAvatar(seed: string | number, ownedItemIds: ReadonlySet<string> | readonly string[]): Avatar {
  const next = generator(`surprise:${seed}`);
  const owned = ownedItemIds instanceof Set ? ownedItemIds : new Set(ownedItemIds as readonly string[]);
  const base = {} as Record<string, string>;
  for (const key of AVATAR_BASE_KEYS) base[key] = pick(next, AVATAR_BASE_OPTIONS[key] as readonly string[]);
  if (next() < 0.6) base.facialHair = 'none';
  const worn: Avatar['worn'] = {};
  const always: readonly ItemSlot[] = ['top', 'bottom', 'feet'];
  for (const slot of ITEM_SLOTS) {
    const options = ITEMS.filter((i) => i.slot === slot && (owned.has(i.id) || STARTER_ITEM_IDS.has(i.id)));
    if (!options.length) continue;
    if (always.includes(slot) || next() < 0.55) worn[slot] = pick(next, options).id;
  }
  return { v: AVATAR_VERSION, base, worn };
}
