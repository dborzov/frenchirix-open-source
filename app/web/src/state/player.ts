// The player store: holds the PlayerState, applies every StatePatch the API returns, boots by
// calling POST /api/session. The server is the authority; never change the state here by hand,
// apply what the server sent:
//
//   const res = await api.unlock(sceneId);
//   usePlayer.getState().apply(res.patch);
//
// Read with selectors so a component re-renders only for what it uses:
//   const sesterces = usePlayer((s) => s.state?.currencies.sesterces ?? 0);
import { useCallback } from 'react';
import { create } from 'zustand';
import { applyPatch, type Language, type PlayerState, type StatePatch } from '../../../shared/api';
import { setLanguage as setI18nLanguage, translate, type TKey, type TVars } from '../../../shared/i18n';
import { api, ApiRequestError } from '../api';
import { setSessionLostHandler } from '../api/client';
import { rememberAccount } from './accounts';

export type BootStatus = 'idle' | 'booting' | 'ready' | 'error';

interface PlayerStore {
  state: PlayerState | null;
  status: BootStatus;
  error: ApiRequestError | null;
  language: Language; // mirrors state.profile.language once booted; drives t()
  /** When the whole state last came from the server (boot, login, GET /api/me), in ms. */
  syncedAt: number;
  boot: () => Promise<void>;
  /** Apply a patch from any API response. */
  apply: (patch: StatePatch | undefined | null) => void;
  /** Replace the whole state (session, login, GET /api/me). */
  replace: (state: PlayerState) => void;
  setLanguage: (lang: Language) => Promise<void>;
}

/**
 * A new account always starts in English, whatever the device's language: the user decided that
 * French first "might be too intimidating" (docs/intent.md, "Language"); the switch to French is in
 * the profile. The browser's language is not followed.
 */
function defaultLanguage(): Language {
  return 'en';
}

function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Toronto';
  } catch {
    return 'America/Toronto';
  }
}

export const usePlayer = create<PlayerStore>((set, get) => ({
  state: null,
  status: 'idle',
  error: null,
  language: 'en',
  syncedAt: 0,

  boot: async () => {
    if (get().status === 'booting') return;
    set({ status: 'booting', error: null });
    try {
      const res = await api.session({ timeZone: browserTimeZone(), language: defaultLanguage() });
      get().replace(res.state);
      set({ status: 'ready' });
    } catch (e) {
      const err = e instanceof ApiRequestError ? e : new ApiRequestError(0, 'internal', String(e));
      set({ status: 'error', error: err });
    }
  },

  apply: (patch) => {
    const st = get().state;
    if (!st || !patch) return;
    const next = applyPatch(st, patch);
    if (next.profile.language !== get().language) setI18nLanguage(next.profile.language);
    set({ state: next, language: next.profile.language });
  },

  replace: (state) => {
    setI18nLanguage(state.profile.language);
    set({ state, language: state.profile.language, syncedAt: Date.now() });
  },

  setLanguage: async (lang) => {
    const before = get().language;
    // Switch at once; the server confirms.
    setI18nLanguage(lang);
    const st = get().state;
    set({ language: lang, state: st ? applyPatch(st, { profile: { language: lang } }) : st });
    try {
      const res = await api.patchMe({ language: lang });
      get().apply(res.patch);
    } catch (e) {
      setI18nLanguage(before);
      set({ language: before, state: get().state ? applyPatch(get().state!, { profile: { language: before } }) : null });
      throw e;
    }
  },
}));

// Before the state arrives (the splash, an error panel when the boot fails) the interface speaks the
// store's language, English, like a new account: shared/i18n alone would start in French.
setI18nLanguage(usePlayer.getState().language);

// The server no longer knows this browser's kid (401 no-session on any call): boot again, which makes
// a new session (and, without a cookie, a new kid; the "Tu as déjà joué ?" question offers the login).
setSessionLostHandler(() => {
  if (usePlayer.getState().status === 'ready') void usePlayer.getState().boot();
});

// The device remembers every account loaded on it, with its name, PIN and avatar as the server last sent
// them (state/accounts.ts): the player selection lists them.
usePlayer.subscribe((s, prev) => {
  const p = s.state?.profile;
  if (p && p !== prev.state?.profile) rememberAccount(p);
});

/** t() bound to the store's language: components that call it re-render on a language switch. */
export function useT(): (key: TKey, vars?: TVars) => string {
  const lang = usePlayer((s) => s.language);
  return useCallback((key: TKey, vars?: TVars) => translate(lang, key, vars), [lang]);
}

/** The PlayerState, for screens that render only once booted (App guarantees it is set). */
export function usePlayerState(): PlayerState {
  const st = usePlayer((s) => s.state);
  if (!st) throw new Error('usePlayerState before boot');
  return st;
}
