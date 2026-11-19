// t(key, vars?): every user-visible string goes through it. Rules are at the top of fr.ts.
// In React, use `useT()` from web/src/state/player.ts so components re-render on a language switch.

import type { Language } from '../api';
import { en } from './en';
import { fr, type TKey } from './fr';

export type { TKey } from './fr';
export type TVars = Record<string, string | number>;

export const dictionaries: Record<Language, Record<TKey, string>> = { fr, en };

let current: Language = 'fr';

export function setLanguage(lang: Language): void {
  current = lang;
}

export function getLanguage(): Language {
  return current;
}

export function isTKey(key: string): key is TKey {
  return key in fr;
}

/** Translate in a given language. */
export function translate(lang: Language, key: TKey, vars?: TVars): string {
  let s = dictionaries[lang][key] ?? fr[key] ?? key;
  if (s.includes('|') && vars && typeof vars.n === 'number') {
    const [one, many] = s.split('|') as [string, string];
    const singular = lang === 'fr' ? Math.abs(vars.n) < 2 : vars.n === 1;
    s = singular ? one : many;
  }
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
  return s;
}

/** Translate in the current language. */
export function t(key: TKey, vars?: TVars): string {
  return translate(current, key, vars);
}
