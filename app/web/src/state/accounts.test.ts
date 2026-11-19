// The accounts a shared device remembers (state/accounts.ts) and how the player store and the
// switching actions keep the list right (state/player.ts, state/account.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_AVATAR } from '../../../shared/catalog';
import { FIXTURE_PLAYER } from '../../../shared/fixtures';
import { ACCOUNTS_KEY, accountsOnDevice, forgetAccount, MAX_ACCOUNTS, rememberAccount, rememberedAccounts, resetAccountsMemory } from './accounts';
import { usePlayer } from './player';

const kid = (id: string, name = `kid-${id}`, pin = '123') => ({ id, name, pin, avatar: DEFAULT_AVATAR });

beforeEach(() => {
  localStorage.clear();
  resetAccountsMemory();
  usePlayer.setState({ state: null, status: 'idle', error: null, language: 'en' });
});
afterEach(() => vi.restoreAllMocks());

describe('remembered accounts', () => {
  it('remembers accounts in the order they came, refreshing name, PIN and avatar in place', () => {
    rememberAccount(kid('a'), 1);
    rememberAccount(kid('b'), 2);
    rememberAccount({ ...kid('a', 'zoe-la-gauloise', '456') }, 3);
    expect(rememberedAccounts().map((a) => [a.id, a.name, a.pin, a.at])).toEqual([
      ['a', 'zoe-la-gauloise', '456', 3],
      ['b', 'kid-b', '123', 2],
    ]);
    expect(JSON.parse(localStorage.getItem(ACCOUNTS_KEY)!)).toHaveLength(2);
  });

  it('forgets one account', () => {
    rememberAccount(kid('a'));
    rememberAccount(kid('b'));
    forgetAccount('a');
    expect(rememberedAccounts().map((a) => a.id)).toEqual(['b']);
    forgetAccount('nobody');
    expect(rememberedAccounts().map((a) => a.id)).toEqual(['b']);
  });

  it('drops the account used longest ago when full, never the one remembered now', () => {
    for (let i = 0; i < MAX_ACCOUNTS; i++) rememberAccount(kid(`k${i}`), 100 + i);
    rememberAccount(kid('k0'), 500); // k0 played again: k1 is now the oldest
    rememberAccount(kid('new'), 600);
    const ids = rememberedAccounts().map((a) => a.id);
    expect(ids).toHaveLength(MAX_ACCOUNTS);
    expect(ids).toContain('k0');
    expect(ids).toContain('new');
    expect(ids).not.toContain('k1');
  });

  it('skips malformed entries and survives unreadable storage', () => {
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify([kid('x'), { id: 'y' }, { ...kid('z'), pin: '12' }, 'nope'].map((a) => (typeof a === 'object' && 'avatar' in a ? { ...a, at: 1 } : a))));
    expect(rememberedAccounts().map((a) => a.id)).toEqual(['x']);
    localStorage.setItem(ACCOUNTS_KEY, '{not json');
    expect(rememberedAccounts()).toEqual([]);
  });

  it('works in memory when storage throws (a private window)', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    rememberAccount(kid('a'));
    rememberAccount(kid('b'));
    forgetAccount('a');
    expect(rememberedAccounts().map((a) => a.id)).toEqual(['b']);
  });

  it('always lists the current account, as the server sent it', () => {
    rememberAccount(kid('a', 'old-name'));
    expect(accountsOnDevice(kid('a', 'new-name')).map((a) => a.name)).toEqual(['new-name']);
    expect(accountsOnDevice(kid('c')).map((a) => a.id)).toEqual(['a', 'c']);
    expect(accountsOnDevice(null).map((a) => a.id)).toEqual(['a']);
  });
});

describe('the player store remembers', () => {
  it('every account it loads, and a renamed one under its new name', () => {
    const st = structuredClone(FIXTURE_PLAYER);
    usePlayer.getState().replace(st);
    expect(rememberedAccounts().map((a) => [a.id, a.name, a.pin])).toEqual([[st.profile.id, st.profile.name, st.profile.pin]]);
    usePlayer.getState().apply({ profile: { name: 'panoramix-junior' } });
    expect(rememberedAccounts().map((a) => a.name)).toEqual(['panoramix-junior']);
    // A patch without the profile does not touch the list.
    const before = localStorage.getItem(ACCOUNTS_KEY);
    usePlayer.getState().apply({ currencies: { sesterces: 3 } });
    expect(localStorage.getItem(ACCOUNTS_KEY)).toBe(before);
  });
});
