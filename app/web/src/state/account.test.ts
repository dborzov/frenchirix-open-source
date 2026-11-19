// Switching player (state/account.ts): the list of remembered accounts follows what the server did.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FIXTURE_PLAYER } from '../../../shared/fixtures';
import type { PlayerState } from '../../../shared/api';

vi.mock('../api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../api')>();
  return { ...real, api: { ...real.api, login: vi.fn(), logout: vi.fn(), session: vi.fn() } };
});

const { api } = await import('../api');
const { logIn, newPlayer } = await import('./account');
const { rememberedAccounts, resetAccountsMemory } = await import('./accounts');
const { usePlayer } = await import('./player');

function player(id: string, name: string, pin = '123'): PlayerState {
  const st = structuredClone(FIXTURE_PLAYER);
  st.profile = { ...st.profile, id, name, pin };
  return st;
}

beforeEach(() => {
  localStorage.clear();
  resetAccountsMemory();
  vi.mocked(api.login).mockReset();
  vi.mocked(api.logout).mockReset();
  vi.mocked(api.session).mockReset();
  usePlayer.setState({ state: null, status: 'idle', error: null, language: 'en' });
  usePlayer.getState().replace(player('u_a', 'asterix-junior', '111'));
});

describe('switching player', () => {
  it('logs in with the stored name and PIN; both accounts stay on the device', async () => {
    vi.mocked(api.login).mockResolvedValue({ state: player('u_b', 'obelix-junior', '222'), previousDeleted: false });
    await logIn('obelix junior', '222');
    expect(vi.mocked(api.login).mock.calls[0]![0]).toMatchObject({ name: 'obelix-junior', pin: '222' });
    expect(usePlayer.getState().state?.profile.id).toBe('u_b');
    expect(rememberedAccounts().map((a) => a.id)).toEqual(['u_a', 'u_b']);
  });

  it('forgets the account left behind when the server deleted it (it held nothing)', async () => {
    vi.mocked(api.login).mockResolvedValue({ state: player('u_b', 'obelix-junior', '222'), previousDeleted: true });
    await logIn('obelix-junior', '222');
    expect(rememberedAccounts().map((a) => a.id)).toEqual(['u_b']);
  });

  it('changes nothing when the login fails', async () => {
    vi.mocked(api.login).mockRejectedValue(new Error('offline'));
    await expect(logIn('obelix-junior', '222')).rejects.toThrow('offline');
    expect(usePlayer.getState().state?.profile.id).toBe('u_a');
    expect(rememberedAccounts().map((a) => a.id)).toEqual(['u_a']);
  });

  it('"New player" keeps the kid who leaves on the device, unless the server deleted the account', async () => {
    vi.mocked(api.session).mockResolvedValue({ state: player('u_new', 'barde-bavard'), created: true });
    vi.mocked(api.logout).mockResolvedValue({ deleted: false });
    localStorage.setItem('frenchirix.onb.welcome', '1');
    await newPlayer();
    expect(usePlayer.getState().state?.profile.id).toBe('u_new');
    expect(rememberedAccounts().map((a) => a.id)).toEqual(['u_a', 'u_new']);
    // The kid's flags went with the old kid; the new one is not asked "Played before?".
    expect(localStorage.getItem('frenchirix.onb.welcome')).toBeNull();
    expect(localStorage.getItem('frx.pwa.welcomeBack')).toBe('new');

    vi.mocked(api.session).mockResolvedValue({ state: player('u_newer', 'druide-distrait'), created: true });
    vi.mocked(api.logout).mockResolvedValue({ deleted: true });
    await newPlayer();
    expect(rememberedAccounts().map((a) => a.id)).toEqual(['u_a', 'u_newer']);
  });
});
