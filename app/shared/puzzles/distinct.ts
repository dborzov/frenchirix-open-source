// Choices a kid can tell apart: the content words of English and French text, for the rule that a
// wrong choice is never close in meaning to the right one (docs/app-games.md, "Choices"). A kid often
// hears only a fragment of French out of its context: "Un monde" offered "a world" and "in this
// world" was a trap. Function words (articles, prepositions, pronouns, auxiliaries, conjunctions,
// interjections) do not count; simple plural and inflected forms count as the same word. Between short
// choices, words of one synonym family count as the same word too (SYNONYMS).
// Self-contained (no imports from the puzzle types) so that every type can use it without a cycle.

const EN_FUNCTION = new Set(
  (
    'a an the this that these those some any no every each all both either neither another other others such what which whose whom who ' +
    'i me my mine myself you your yours yourself yourselves he him his himself she her hers herself it its itself we us our ours ourselves ' +
    'they them their theirs themselves one ones ' +
    'in on at to of for from with without by about into onto over under up down out off through after before between against among ' +
    'around than as since until till upon within across behind along toward towards per via ' +
    'and or but nor so yet if then because when while where though although unless whether how why ' +
    'be am is are was were been being do does did doing have has had having will would shall should can could may might must let ' +
    'not very too also just only even still there here now again really quite rather ' +
    'oh ah eh hey well okay ok huh uh um hmm yes yeah no nope'
  ).split(' '),
);

const FR_FUNCTION = new Set(
  (
    'le la les l un une des de du d au aux a et ou mais donc ni car que qu qui quoi dont ce c cet cette ces ca cela ceci celui celle ceux celles ' +
    'mon ton son ma ta sa mes tes ses notre votre nos vos leur leurs je j tu t il elle on nous vous ils elles me m te se s lui eux moi toi soi y en ' +
    'ne n pas point dans sur sous avec sans pour par chez vers entre contre depuis pendant avant ' +
    'est es suis sont sommes etes etait etaient etre ai as avons avez ont avait avaient avoir eu ete ' +
    'si comme tout tous toute toutes tres trop aussi ici voila voici oh ah eh he hein ben bah oui non ouais'
  ).split(' '),
);

/**
 * Families of English words a kid would take for the same meaning on a sign, from what the release's
 * unit glosses contain: "how good it is" and "wonderful", "there is nothing better" and "how good it
 * is", "ah okay" and "very well". A short choice that has a word or phrase of a family shares the
 * family (its first word) with every other that has one (`sharedEnWords`); whole lines do not use them
 * (their threshold, LINE_SHARED_MAX, counts words). Words match whole, or with a plural "s"; "well" alone
 * is an interjection ("well, I'm off"), so only "very well" counts.
 */
export const SYNONYMS: readonly (readonly string[])[] = [
  ['good', 'better', 'best', 'great', 'wonderful', 'nice', 'excellent', 'perfect', 'fine'],
  ['okay', 'ok', 'alright', 'all right', 'very well', 'fine', 'agreed'],
  ['bad', 'worse', 'worst', 'terrible', 'awful'],
  ['small', 'little', 'tiny'],
  ['afraid', 'fear', 'scared'],
  ['crazy', 'mad'],
  ['quiet', 'silence', 'shut up'],
  ['stop', 'enough', 'halt'],
  ['sorry', 'excuse', 'pardon'],
  ['maybe', 'perhaps'],
  ['goodbye', 'bye'],
  ['stupid', 'fool', 'idiot'],
  ['beautiful', 'handsome', 'pretty'],
  ['say', 'tell'],
  ['hit', 'beat'],
];
const FAMILIES = new Map<string, string[]>();
for (const family of SYNONYMS) for (const w of family) FAMILIES.set(w, [...(FAMILIES.get(w) ?? []), family[0]!]);

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/[’‘`]/g, "'")
    .replace(/[^\p{L}\p{N}' ]+/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** One English word to its stem: contractions dropped, simple plural and inflections removed. */
export function stemEn(word: string): string {
  let w = word.replace(/^'+|'+$/g, '');
  if (w === "won't") return 'will';
  if (w === "can't") return 'can';
  w = w.replace(/n't$/, '').replace(/'(s|re|ve|ll|d|m)$/, '');
  if (w.includes("'")) w = w.slice(0, w.indexOf("'"));
  const keep = (stem: string) => stem.length >= 3;
  if (w.length > 4 && w.endsWith('ies')) w = w.slice(0, -3) + 'y';
  else if (/(s|x|z|ch|sh)es$/.test(w) && keep(w.slice(0, -2))) w = w.slice(0, -2);
  else if (w.endsWith('s') && !/(ss|us|is)$/.test(w) && keep(w.slice(0, -1))) w = w.slice(0, -1);
  if (w.length > 4 && w.endsWith('ied')) w = w.slice(0, -3) + 'y';
  else if (w.endsWith('ing') && keep(w.slice(0, -3))) w = w.slice(0, -3);
  else if (w.endsWith('ed') && keep(w.slice(0, -2))) w = w.slice(0, -2);
  else if (w.endsWith('ly') && w.length >= 6) w = w.slice(0, -2);
  if (/([b-df-hj-np-tv-z])\1$/.test(w) && !/(ll|ss|ff|zz)$/.test(w)) w = w.slice(0, -1);
  if (w.length > 3 && w.endsWith('e')) w = w.slice(0, -1);
  return w;
}

/** One French word (accents folded) to its stem: plural, feminine and the common verb endings removed. */
export function stemFr(word: string): string {
  let w = word.replace(/^'+|'+$/g, '');
  if (w.includes("'")) w = w.slice(w.lastIndexOf("'") + 1); // l'homme -> homme
  if (w.length > 3 && /[sx]$/.test(w)) w = w.slice(0, -1);
  if (w.length > 4 && /(er|ez)$/.test(w)) w = w.slice(0, -2);
  if (w.length > 3 && w.endsWith('e')) w = w.slice(0, -1);
  return w;
}

/** Builds pick wrong choices among hundreds of glosses, many times over: remember each text's words. */
function memo(f: (s: string) => Set<string>): (s: string) => ReadonlySet<string> {
  const cache = new Map<string, Set<string>>();
  return (s) => {
    let v = cache.get(s);
    if (!v) {
      if (cache.size >= 20000) cache.clear();
      v = f(s);
      cache.set(s, v);
    }
    return v;
  };
}

/** The stems of the English content words of `s`. */
export const enContentWords = memo((s) => {
  const out = new Set<string>();
  for (const t of tokens(s)) {
    const bare = t.replace(/n't$/, '').replace(/'(s|re|ve|ll|d|m)$/, '');
    if (EN_FUNCTION.has(t) || EN_FUNCTION.has(bare)) continue;
    const w = stemEn(t);
    if (w.length < 2 || EN_FUNCTION.has(w)) continue;
    out.add(w);
  }
  return out;
});

/** The stems of the French content words of `s` (accents folded). */
export const frContentWords = memo((s) => {
  const out = new Set<string>();
  for (const t of tokens(s)) {
    for (const part of t.split("'")) {
      if (!part || FR_FUNCTION.has(part)) continue;
      const w = stemFr(part);
      if (w.length < 2 || FR_FUNCTION.has(w)) continue;
      out.add(w);
    }
  }
  return out;
});

/** The synonym families (SYNONYMS) of the words and two-word phrases of English `s`. */
export const enFamilies = memo((s) => {
  const out = new Set<string>();
  const t = tokens(s);
  t.forEach((w, i) => {
    const two = i + 1 < t.length ? `${w} ${t[i + 1]}` : '';
    for (const key of [w, w.endsWith('s') ? w.slice(0, -1) : '', two]) for (const f of FAMILIES.get(key) ?? []) out.add(f);
  });
  return out;
});

/** The content words of a short choice and the synonym families of its words, for `sharedEnWords`. */
const enMeaningWords = memo((s) => new Set([...enContentWords(s), ...enFamilies(s)]));

function common(a: ReadonlySet<string>, b: ReadonlySet<string>): string[] {
  return [...a].filter((w) => b.has(w));
}

/**
 * The English content words two short texts share (as stems): "a world" and "in this world" share
 * "world"; a synonym family counts as a word ("how good it is" and "wonderful" share "good").
 */
export function sharedEnWords(a: string, b: string): string[] {
  return common(enMeaningWords(a), enMeaningWords(b));
}

/** The French content words two texts share (as stems, accents folded): "Un monde" and "Dans ce monde". */
export function sharedFrWords(a: string, b: string): string[] {
  return common(frContentWords(a), frContentWords(b));
}

/**
 * Two pieces of French a kid would take for the same thing: they share a content word, or, when one
 * has no content word ("Oh là là"), one is the other or inside it word for word.
 */
export function frenchRelated(a: string, b: string): boolean {
  const ca = frContentWords(a);
  const cb = frContentWords(b);
  if (common(ca, cb).length) return true;
  if (ca.size && cb.size) return false;
  const ta = ` ${tokens(a).join(' ')} `;
  const tb = ` ${tokens(b).join(' ')} `;
  return ta.trim() !== '' && tb.trim() !== '' && (ta.includes(tb) || tb.includes(ta));
}

/**
 * Two whole lines are too close to offer one as a wrong choice for the other when they share more than
 * this share of the shorter line's content words. Whole lines are heard in full, so they may share up
 * to half of what they say ("We feel good, it is hot" / "We feel good in the land of Panono", 2 of 4),
 * but not more ("Ah yes, it's good" / "Yeah, yeah, it's good"; "Madame Arbre…" / "Madame Arbre, all is well").
 */
export const LINE_SHARED_MAX = 0.5;

function shareMost(ca: ReadonlySet<string>, cb: ReadonlySet<string>): boolean {
  const n = Math.min(ca.size, cb.size);
  return n > 0 && common(ca, cb).length / n > LINE_SHARED_MAX;
}

/** Two whole lines of English that say mostly the same things (see LINE_SHARED_MAX). */
export function linesShareMeaning(a: string, b: string): boolean {
  return shareMost(enContentWords(a), enContentWords(b));
}

/** Two whole lines of French that say mostly the same words (see LINE_SHARED_MAX), or the same text. */
export function frLinesShareWords(a: string, b: string): boolean {
  const ta = tokens(a).join(' ');
  return (ta !== '' && ta === tokens(b).join(' ')) || shareMost(frContentWords(a), frContentWords(b));
}
