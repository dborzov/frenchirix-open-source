import { afterEach, describe, expect, it } from 'vitest';
import { en } from './en';
import { fr } from './fr';
import { setLanguage, t, translate } from './index';

afterEach(() => setLanguage('fr'));

describe('i18n', () => {
  it('fr and en have the same keys and no empty strings', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(fr).sort());
    for (const [k, v] of [...Object.entries(fr), ...Object.entries(en)]) expect(v, k).not.toBe('');
  });

  it('keys are namespaced', () => {
    for (const k of Object.keys(fr)) expect(k).toMatch(/^[a-z]+(\.[\w-]+)+$/);
  });

  it('interpolates and pluralises per language', () => {
    expect(translate('fr', 'home.hello', { name: 'Zoé' })).toBe('Salut, Zoé !');
    expect(translate('fr', 'common.days', { n: 0 })).toBe('0 jour');
    expect(translate('fr', 'common.days', { n: 1 })).toBe('1 jour');
    expect(translate('fr', 'common.days', { n: 3 })).toBe('3 jours');
    expect(translate('en', 'common.days', { n: 0 })).toBe('0 days');
    expect(translate('en', 'common.days', { n: 1 })).toBe('1 day');
  });

  it('follows the current language', () => {
    expect(t('nav.home')).toBe('Accueil');
    setLanguage('en');
    expect(t('nav.home')).toBe('Home');
  });
});
