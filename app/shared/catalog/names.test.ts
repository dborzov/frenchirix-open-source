import { describe, expect, it } from 'vitest';
import { NAME_RE } from '../rules';
import { checkName, isRude, nameKey, normalizeForFilter } from './badwords';
import { NAME_ADJECTIVES, NAME_NOUNS, nameAt, randomName } from './names';

describe('generated names', () => {
  it('has at least 60 nouns and 60 adjectives', () => {
    expect(NAME_NOUNS.length).toBeGreaterThanOrEqual(60);
    expect(NAME_ADJECTIVES.length).toBeGreaterThanOrEqual(60);
    expect(new Set(NAME_NOUNS.map((n) => n[0])).size).toBe(NAME_NOUNS.length);
    expect(new Set(NAME_ADJECTIVES.map((a) => a[0])).size).toBe(NAME_ADJECTIVES.length);
  });

  it('agrees the adjective with the noun', () => {
    expect(nameAt(NAME_NOUNS.findIndex((n) => n[0] === 'sanglier'), 0)).toBe('sanglier-grognon');
    expect(nameAt(NAME_NOUNS.findIndex((n) => n[0] === 'chèvre'), 0)).toBe('chèvre-grognonne');
  });

  it('every combination that fits is a valid, polite name', () => {
    let fits = 0;
    for (let i = 0; i < NAME_NOUNS.length; i++) {
      for (let j = 0; j < NAME_ADJECTIVES.length; j++) {
        const name = nameAt(i, j);
        if (!name) continue;
        fits++;
        expect(NAME_RE.test(name), name).toBe(true);
        expect(checkName(name), name).toEqual({ ok: true });
      }
    }
    expect(fits).toBeGreaterThan(3600);
  });

  it('randomName gives a valid name', () => {
    for (let k = 0; k < 50; k++) expect(checkName(randomName())).toEqual({ ok: true });
  });
});

describe('name filter', () => {
  it('normalises disguises', () => {
    expect(normalizeForFilter('M_3_R--D3')).toBe('merde');
    expect(normalizeForFilter('PÛÛTAAAIN')).toBe('putain');
    expect(normalizeForFilter('$h1t')).toBe('shit');
  });

  it.each([
    'merde', 'MERDE', 'm3rde', 'm.e.r.d.e', 'meeerde', 'mèrde', 'super-merde', 'fuuuck', 'f_u_c_k', 'pUtAiN',
    'connard', 'c0nnard', 'sh1t', 'b1tch', '5alope', 'con', 'gros-con', 'c-o-n', 'cul', 'cuuul', 'pipi_cul',
    'ass', 'big-ass', '4ss', 'cunt', 'dick', 'xx-dick-xx', 'enculé', 'n1gger', 'faggot', 'pédé', 'butt-face',
  ])('rejects %s', (name) => {
    expect(isRude(name)).toBe(true);
  });

  it.each([
    'assassin', 'Scunthorpe', 'concombre', 'calcul', 'culotte', 'basculer', 'computer', 'sanglier-grognon',
    'as-du-volant', 'titan', 'cocorico', 'escargot', 'Constance', 'Dickens', 'classe', 'passion', 'bassin',
    'but-en-or', 'fagot', 'Niger', 'pissenlit', 'technique', 'pédalo', 'Zoé2012', 'Obélix_77', 'cocotte',
    'Abraracourcix', 'Panoramix', 'chinchilla-rigolo', 'Bertrand', 'Hassan', 'Nicolas', 'Matthieu',
  ])('accepts %s', (name) => {
    expect(isRude(name)).toBe(false);
  });

  it('checks length and characters', () => {
    expect(checkName('ab')).toEqual({ ok: false, reason: 'length' });
    expect(checkName('a'.repeat(21))).toEqual({ ok: false, reason: 'length' });
    expect(checkName('zoé zoé')).toEqual({ ok: false, reason: 'chars' });
    expect(checkName('zoé!')).toEqual({ ok: false, reason: 'chars' });
    expect(checkName('m3rde')).toEqual({ ok: false, reason: 'rude' });
    expect(checkName('Zoé_la-Gauloise')).toEqual({ ok: true });
  });

  it('keys names by lower case without accents', () => {
    expect(nameKey('Chèvre-Grognonne')).toBe('chevre-grognonne');
    expect(nameKey('ZOÉ')).toBe(nameKey('zoe'));
  });
});
