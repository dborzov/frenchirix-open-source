import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AVATAR_BASE_KEYS, AVATAR_BASE_OPTIONS, CHEERS, DEFAULT_AVATAR, ITEMS, randomAvatar } from '../../../shared/catalog';
import { HAIR_STYLES } from './art/base';
import { ITEM_ART } from './art/registry';
import { Avatar } from './Avatar';
import { CHEER_ART } from './CheerSticker';
import { ItemIcon } from './ItemIcon';
import { BG, HAIR, SKIN } from './palette';

describe('avatar art', () => {
  it('has art for every item, and no art without an item', () => {
    for (const i of ITEMS) expect(ITEM_ART[i.art ?? i.id], i.id).toBeDefined();
    const ids = new Set(ITEMS.map((i) => i.art ?? i.id));
    for (const k of Object.keys(ITEM_ART)) expect(ids.has(k), k).toBe(true);
  });

  it('draws every base option', () => {
    for (const k of AVATAR_BASE_KEYS) expect((AVATAR_BASE_OPTIONS[k] as readonly string[]).length).toBeGreaterThan(0);
    for (const v of AVATAR_BASE_OPTIONS.skin) expect(SKIN[v]).toBeTruthy();
    for (const v of AVATAR_BASE_OPTIONS.hairColor) expect(HAIR[v]).toBeTruthy();
    for (const v of AVATAR_BASE_OPTIONS.bgColor) expect(BG[v]).toBeTruthy();
    for (const v of AVATAR_BASE_OPTIONS.hair) expect(HAIR_STYLES[v]).toBeTruthy();
  });

  it('has art for every cheer', () => {
    for (const c of CHEERS) expect(CHEER_ART[c.art], c.id).toBeDefined();
  });

  it('renders avatars and icons without crashing', () => {
    const all = ITEMS.map((i) => i.id);
    for (let n = 0; n < 15; n++) {
      const { container, unmount } = render(<Avatar avatar={randomAvatar(n, all)} size={n % 2 ? 32 : 300} />);
      expect(container.querySelector('svg')).toBeTruthy();
      unmount();
    }
    render(<Avatar avatar={DEFAULT_AVATAR} size={64} />);
    for (const i of ITEMS) {
      const { unmount } = render(<ItemIcon itemId={i.id} size={64} />);
      unmount();
    }
  });
});
