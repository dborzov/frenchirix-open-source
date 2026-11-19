import { describe, expect, it } from 'vitest';
import data from '../../../data/versions.json';
import { setLanguage, translate } from '../../../shared/i18n';
import { sortedVersions, type VersionEntry } from '../screens/Version';
import { checkName, fallbackCheckName } from './checkName';
import { nextLevelText } from './parts';

describe('nextLevelText', () => {
  it('says now, tomorrow, in n days and every level, in both languages', () => {
    setLanguage('fr');
    expect(nextLevelText({ state: 'now' }, true)).toBe('Prêt !');
    expect(nextLevelText({ state: 'wait', days: 1 })).toBe('Prochain niveau demain');
    expect(nextLevelText({ state: 'wait', days: 4 })).toBe('Prochain niveau dans 4 jours');
    setLanguage('en');
    expect(nextLevelText({ state: 'wait', days: 1 }, true)).toBe('Tomorrow');
    expect(nextLevelText({ state: 'wait', days: 8 })).toBe('Next level in 8 days');
    expect(nextLevelText({ state: 'max' })).toBe(translate('en', 'home.level.max'));
    setLanguage('fr');
  });
});

describe('checkName', () => {
  it('rejects bad length and characters', () => {
    expect(fallbackCheckName('ab')).toEqual({ ok: false, reason: 'length' });
    expect(fallbackCheckName('a b c')).toEqual({ ok: false, reason: 'chars' });
    expect(fallbackCheckName('Astérix-14')).toEqual({ ok: true });
    expect(checkName('ab').ok).toBe(false);
    expect(checkName('Obélix_2').ok).toBe(true);
  });
});

describe('versions', () => {
  it('lists newest first, each with notes', () => {
    const list = sortedVersions((data as { versions: VersionEntry[] }).versions);
    expect(list[0]!.version).toBe('2.5.0');
    expect(list[list.length - 1]!.version).toBe('1.0');
    for (const v of list) {
      expect(v.notes.length).toBeGreaterThan(0);
      expect(v.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
