// The name filter: a French and English list of rude words, and a normaliser that defeats simple
// disguises (case, accents, repeated letters, digits and symbols for letters, separators).
// checkName gives the client instant feedback; the server runs the same check and adds uniqueness.
//
// Two lists, to avoid the classic false positives ("assassin", "Scunthorpe", "calcul"):
// - SUBSTRING words are unambiguous: rejected wherever they appear, even inside a longer name.
// - WORD words are short and appear inside innocent words: rejected only as a whole word of the
//   name (words are split on separators such as '-' and '_'), or when the whole name is that word.

import { NAME_MAX, NAME_MIN, NAME_RE } from '../rules';

const SUBSTRING: readonly string[] = [
  // French
  'merde', 'putain', 'connard', 'connasse', 'conasse', 'salope', 'salaud', 'encule', 'enfoire', 'batard',
  'bordel', 'couille', 'branleur', 'branlette', 'pouffiasse', 'petasse', 'grognasse', 'chiasse',
  'emmerde', 'foutre', 'niquer', 'tafiole', 'bougnoul', 'youpin', 'sodomi', 'zgeg', 'trouduc',
  // English
  'fuck', 'shit', 'bitch', 'asshole', 'bastard', 'whore', 'wanker', 'bollock', 'nigga', 'dickhead',
  'motherf', 'penis', 'vagina', 'porn', 'sexy', 'boob', 'pussy', 'blowjob', 'cumshot', 'jizz', 'twat',
  'hitler', 'nazi',
];

const WORD: readonly string[] = [
  // French
  'con', 'cons', 'conne', 'cul', 'culs', 'pute', 'putes', 'bite', 'bites', 'pede', 'pedes', 'zob', 'chier',
  'nique', 'pisse', 'pedale', 'tapette', 'sexe', 'gouine', 'mongol', 'debile', 'abruti', 'idiot', 'idiote',
  'cretin', 'cretine', 'nichon', 'nichons',
  // English
  'ass', 'arse', 'cunt', 'dick', 'dicks', 'cock', 'cocks', 'tit', 'tits', 'fag', 'slut', 'cum', 'sex',
  'crap', 'piss', 'damn', 'hoe', 'kkk', 'poop', 'butt', 'nigger', 'niggers', 'faggot', 'faggots', 'retard',
  'rapist',
];

const LEET: Record<string, string> = {
  '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', '$': 's', '!': 'i', '€': 'e', '|': 'i',
};

/** Lower case, no accents, look-alike digits and symbols turned into letters. Separators kept. */
function deLeet(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .replace(/[01345780@$!€|]/g, (ch) => LEET[ch] ?? ch);
}

/** Repeated letters collapsed: 'meeerrde' -> 'merde'. */
function collapse(s: string): string {
  return s.replace(/(.)\1+/g, '$1');
}

/**
 * The normalised form of a name: lower case, no accents, look-alikes as letters, separators removed,
 * repeated letters collapsed. 'M_3_R--D3' -> 'merde'.
 */
export function normalizeForFilter(name: string): string {
  return collapse(deLeet(name).replace(/[^a-z]/g, ''));
}

const SUBSTRING_N = SUBSTRING.map(normalizeForFilter);
// A short word matches a token of the name after collapsing repeated letters ('cuuul' is 'cul'). A word
// with a double letter whose collapsed form is innocent ('ass' -> 'as', 'butt' -> 'but', 'faggot' ->
// 'fagot') matches only a token that still has a doubled letter.
const WORD_PLAIN = new Set<string>();
const WORD_DOUBLED = new Set<string>();
for (const w of WORD) {
  const d = deLeet(w);
  (collapse(d) === d ? WORD_PLAIN : WORD_DOUBLED).add(collapse(d));
}

function isRudeWord(token: string): boolean {
  if (!token) return false;
  const c = collapse(token);
  if (WORD_PLAIN.has(c)) return true;
  return WORD_DOUBLED.has(c) && c !== token;
}

/** True when the name contains a rude word, even disguised. */
export function isRude(name: string): boolean {
  const n = normalizeForFilter(name);
  if (SUBSTRING_N.some((w) => n.includes(w))) return true;
  const d = deLeet(name);
  // Words of the name, split on anything that is not a letter.
  const tokens = d.split(/[^a-z]+/).filter(Boolean);
  if (tokens.some(isRudeWord)) return true;
  // The whole name as one word ('c-o-n', 'c.u.l'), and runs of single letters joined ('x-c-u-l-x').
  if (isRudeWord(d.replace(/[^a-z]/g, ''))) return true;
  let run = '';
  for (const t of [...tokens, '']) {
    if (t.length === 1) run += t;
    else {
      if (run.length > 1 && isRudeWord(run)) return true;
      run = '';
    }
  }
  return false;
}

export type NameCheck = { ok: true } | { ok: false; reason: 'length' | 'chars' | 'rude' };

/** Is this an acceptable name? (Uniqueness is checked by the server.) */
export function checkName(name: string): NameCheck {
  const len = [...name].length;
  if (len < NAME_MIN || len > NAME_MAX) return { ok: false, reason: 'length' };
  if (!NAME_RE.test(name)) return { ok: false, reason: 'chars' };
  if (isRude(name)) return { ok: false, reason: 'rude' };
  return { ok: true };
}

/** The key names are unique by: lower case, no accents. 'Sanglier-Grognon' and 'sanglier-grognon' collide. */
export function nameKey(name: string): string {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}
