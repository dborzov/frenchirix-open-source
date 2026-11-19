// Scoring of a kid's spoken French: a speech-recognition transcript (Whisper) against the expected
// French of a line or a unit. Generous about accents, elision, silent letters, near-homophones, the
// recogniser's word splits and joins, and mangled proper names; but it requires a real share of the
// expected words, in order, and content words among them. Silence, noise, English and Whisper's
// stock hallucinations score zero. Pure; used by the worker (POST /api/speech) and the client.
// See docs/app-server.md, "Speech recognition and the judge", for the rules and the tests.

export interface SpeechScore {
  score: number; // 0..1, weighted share of the expected words heard
  pass: boolean;
  matched: boolean[]; // per expected word (expectedWords), in order
  expectedWords: string[]; // the expected text split into display words, as written
  heardWords: string[]; // the transcript's words after normalisation
}

export type SpeechKind = 'line' | 'unit';

// ---- Vocabulary --------------------------------------------------------------------------------

/** The show's proper names, French spelling (docs/show-context.md). */
const NAMES = [
  'Astérix', 'Obélix', 'Idéfix', 'Panoramix', 'Abraracourcix', 'Bonemine', 'Mimine', 'Cochonnet',
  'Agecanonix', 'Cétautomatix', 'Assurancetourix', 'Ordralfabétix', 'Iélosubmarine', 'Barbix',
  'Toutétobofix', 'Aplusbégalix', 'Sucettalanix', 'Dimilliondeclix', 'Dimilliondevus', 'César',
  'Métadata', 'Fastanefurius', 'Potus', 'Apothika', 'Annabarbera', 'Blackangus', 'Touinepix', 'Panono',
  'Bibus', 'Vercingétorix', 'Brennus', 'Pompée', 'Cléopâtre', 'Lutèce', 'Armorique', 'Lugdunum',
  'Pompéi', 'Toutatis', 'Bélénos', 'Taranis', 'Bélisama', 'Jupiter', 'Continsta', 'Bigfarma',
  'Gallo-Romain', 'Gaulois',
];

/** Given to Whisper as vocabulary (never the expected sentence). */
export const SPEECH_HINT =
  'Astérix, Obélix, Idéfix, Panoramix, Abraracourcix, Bonemine, Agecanonix, Cétautomatix, ' +
  'Assurancetourix, Ordralfabétix, Aplusbégalix, Sucettalanix, Métadata, César, Fastanefurius, ' +
  'Potus, Apothika, Annabarbera, Blackangus, Panono, Toutatis, Bélénos, Jupiter, Lutèce, ' +
  'Gallo-Romains, Gaulois, sangliérie, menhir, potion magique.';

/** Little words: articles, pronouns, prepositions, conjunctions. They count less. */
const LITTLE = new Set(
  (
    'le la les l un une des du de d au aux et ou à a en y je j tu il elle on nous vous ils elles me m te t ' +
    'se s ne n que qu qui ce c ça ca cet cette ces mon ma mes ton ta tes son sa ses leur leurs lui moi toi ' +
    'si pour par sur dans avec mais donc car est es sont ai as suis'
  ).split(' '),
);
/** Interjections and fillers that a line may contain; they count least. */
const INTERJECTIONS = new Set(
  'oh ah eh hé he ha ho hein hum hmm mmh mh euh heu bah ben bon aïe aie ouh waouh ouah oups pff allez hop'.split(' '),
);
/** Hesitations dropped from the transcript (unless the expected text has them). */
const FILLERS = new Set('euh heu hum hmm mmh mh hm bah ah oh'.split(' '));

/** English words that are not French words: two of them (and 30% of the transcript) mean English. */
const ENGLISH = new Set(
  (
    'the to you your will is are and of it what don dont we they them this that with my i im he she was ' +
    'have be not do does did know want go going here there where who why how yes yeah okay ok please ' +
    'thank thanks hello hi throw clumsy re ll ve'
  ).split(' '),
);

const W_CONTENT = 1;
const W_LITTLE = 0.35;
const W_INTERJECTION = 0.25;

// Similarity of a matched pair; the score is the weighted sum of these.
const SIM_EXACT = 1;
const SIM_ACCENTLESS = 0.95;
const SIM_PHONETIC = 0.85;
const SIM_NEAR = 0.7;
const SIM_NAME = 0.8;

// ---- Normalisation -----------------------------------------------------------------------------

const ELIDABLE = new Set(['l', 'd', 'j', 'm', 't', 's', 'n', 'c', 'qu', 'jusqu', 'lorsqu', 'puisqu', 'quoiqu', 'presqu']);

function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '');
}

/** Lower case, accents kept, one char per char (so ranges map back). */
function lowerNfc(s: string): string {
  return s.normalize('NFC').toLowerCase().replace(/[’ʼ`´]/g, "'");
}

const UNITS = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix',
  'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize'];
const TENS = ['', 'dix', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante', 'soixante', 'quatre-vingt', 'quatre-vingt'];

/** French words for 0-9999 (hyphens become word breaks later). */
export function numberToFrench(n: number): string {
  if (n < 0 || n > 9999 || !Number.isInteger(n)) return String(n);
  if (n <= 16) return UNITS[n]!;
  if (n < 20) return `dix-${UNITS[n - 10]}`;
  if (n < 100) {
    const t = Math.floor(n / 10);
    let u = n % 10;
    if (t === 7 || t === 9) u += 10;
    const base = TENS[t]!;
    if (u === 0) return t === 8 ? 'quatre-vingts' : base;
    if (u === 1 && t !== 8 && t !== 9) return `${base} et un`;
    if (u === 11 && t === 7) return `${base} et onze`;
    return `${base}-${numberToFrench(u)}`;
  }
  if (n < 1000) {
    const h = Math.floor(n / 100);
    const r = n % 100;
    const head = h === 1 ? 'cent' : `${UNITS[h]} cent${r === 0 ? 's' : ''}`;
    return r ? `${head} ${numberToFrench(r)}` : head;
  }
  const k = Math.floor(n / 1000);
  const r = n % 1000;
  const head = k === 1 ? 'mille' : `${numberToFrench(k)} mille`;
  return r ? `${head} ${numberToFrench(r)}` : head;
}

/** Comparison tokens of a piece of text: lower case, accents kept, elisions split, numbers as words. */
function tokens(text: string): string[] {
  let s = lowerNfc(text).replace(/\d+/g, (d) => ` ${numberToFrench(Number(d))} `);
  s = s.replace(/[^\p{L}\p{N}'\s-]/gu, ' ');
  const out: string[] = [];
  for (const raw of s.split(/[\s-]+/)) {
    if (!raw) continue;
    const parts = raw.split("'").filter(Boolean);
    // Split an elision (l'ami, qu'il, j'ai); keep words like aujourd'hui whole.
    let i = 0;
    while (i < parts.length - 1 && ELIDABLE.has(parts[i]!)) out.push(parts[i++]!);
    const rest = parts.slice(i).join('');
    if (rest) out.push(rest);
  }
  return out;
}

/** Display words of the expected text: whitespace-separated, punctuation-only pieces dropped. */
function displayWords(text: string): string[] {
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
}

const NAME_KEYS = new Set(NAMES.flatMap((n) => tokens(n)).map(stripAccents));
function isName(tok: string): boolean {
  const a = stripAccents(tok);
  return NAME_KEYS.has(a) || (a.length >= 5 && /ix$/.test(a));
}

function weightOf(tok: string): number {
  if (isName(tok)) return W_CONTENT;
  if (INTERJECTIONS.has(tok)) return W_INTERJECTION;
  if (LITTLE.has(tok)) return W_LITTLE;
  return W_CONTENT;
}

// ---- Phonetics ---------------------------------------------------------------------------------

/** A rough French sound key: homophones and near-homophones get the same key. */
export function phoneticKey(word: string): string {
  let s = word.toLowerCase().replace(/ç/g, 's').replace(/œ/g, 'e');
  s = s.replace(/^([lmtsdc])es$/, '$1é'); // les, mes, des: "lé"
  s = s.replace(/(er|ez|et|ais|ait|aient)$/, 'é');
  s = s.replace(/eaux?$/, 'o').replace(/eau/g, 'o').replace(/aux?$/, 'o').replace(/au/g, 'o');
  s = s.replace(/(ain|aim|ein|eim)(?![aeiouéèêiîmn])/g, '1'); // pain = pin, plein, faim
  s = s.replace(/[èêë]/g, 'é').replace(/a[iî]/g, 'é').replace(/ei/g, 'é');
  s = s.replace(/[àâä]/g, 'a').replace(/[îï]/g, 'i').replace(/[ôö]/g, 'o').replace(/[ùûü]/g, 'u');
  s = s.replace(/ph/g, 'f').replace(/th/g, 't').replace(/ch/g, 'X').replace(/sh/g, 'X');
  s = s.replace(/gn/g, 'N');
  s = s.replace(/qu/g, 'k').replace(/ck/g, 'k').replace(/c(?=[eiyé])/g, 's').replace(/c/g, 'k');
  s = s.replace(/gu(?=[eiyé])/g, 'g').replace(/g(?=[eiyé])/g, 'j');
  s = s.replace(/h/g, '');
  s = s.replace(/oi/g, 'wa').replace(/ou/g, 'U').replace(/y/g, 'i');
  s = s.replace(/ien(?![aeiouéU])/g, 'i1');
  s = s.replace(/(ain|ein|aim|in|im|yn|un|um)(?![aeiouéUn1])/g, '1');
  s = s.replace(/(an|am|en|em)(?![aeiouéUn1])/g, '2');
  s = s.replace(/(on|om)(?![aeiouéUn1])/g, '3');
  s = s.replace(/(?<=[aeiouéU123])s(?=[aeiouéU])/g, 'z');
  s = s.replace(/([a-zX])\1+/g, '$1');
  // Silent endings: a final e, then final s t d x z p (x kept after i: the -ix names).
  if (s.length > 2) s = s.replace(/e$/, '');
  for (let k = 0; k < 2 && s.length > 2; k++) s = s.replace(/(?<!i)x$/, '').replace(/[stdzp]$/, '');
  s = s.replace(/(?<=[^aeiouéU123])e(?=[^aeiouéU123])/g, ''); // a schwa between consonants (petit, ptit)
  return s.replace(/é/g, 'E');
}

/**
 * A rough, readable French sound spelling of a text, one group per word ("Ils sont fous, ces Romains"
 * → "il son fou sé romin"): homophones come out the same. Given to the speech judge so it can compare
 * by sound (docs/app-server.md, "Why this speech design").
 */
export function soundSpelling(text: string): string {
  return tokens(text)
    .map((t) =>
      phoneticKey(t)
        .replace(/1/g, 'in')
        .replace(/2/g, 'an')
        .replace(/3/g, 'on')
        .replace(/X/g, 'ch')
        .replace(/N/g, 'gn')
        .replace(/E/g, 'é')
        .replace(/U/g, 'ou'),
    )
    .filter(Boolean)
    .join(' ');
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n]!;
}

/** How alike an expected token and a heard token are (0 = not a match). */
function similarity(exp: string, heard: string, name: boolean): number {
  if (exp === heard) return SIM_EXACT;
  const a = stripAccents(exp);
  const b = stripAccents(heard);
  if (a === b) return SIM_ACCENTLESS;
  const pa = phoneticKey(exp);
  const pb = phoneticKey(heard);
  if (pa === pb && pa.length > 0) return SIM_PHONETIC;
  if (name) {
    const tol = Math.max(1, Math.floor(0.4 * a.length));
    if (levenshtein(a, b) <= tol || levenshtein(pa, pb) <= Math.max(1, Math.floor(0.4 * pa.length))) return SIM_NAME;
    return 0;
  }
  if (a.length >= 5 && b.length >= 4) {
    const d = levenshtein(a, b);
    if (d <= (a.length >= 8 ? 2 : 1)) return SIM_NEAR;
    if (pa.length >= 4 && levenshtein(pa, pb) <= 1) return SIM_NEAR;
  }
  return 0;
}

// ---- Transcript cleaning -----------------------------------------------------------------------

/** Whisper's known outputs on silence or noise, matched on the accentless lower-case transcript. */
const HALLUCINATIONS: RegExp[] = [
  /sous[\s-]*titr\w*.*$/g, // "Sous-titres réalisés par la communauté d'Amara.org", "Sous-titrage ST' 501"
  /\S*\s*amara(\s*\.?\s*org)?/g,
  /merci d'?\s*avoir regarde( cette video)?/g,
  /merci de (votre attention|nous avoir suivis?)/g,
  /n'?\s*oubliez pas de (vous abonner|liker)\S*/g,
  /abonnez[\s-]*vous( a (la|ma) chaine)?/g,
  /\bst'?\s*501\b/g,
  /\b(www|http)\S*/g,
  /\b(radio[\s-]*canada|cc by\S*)\b/g,
];

function removeHallucinations(text: string): string {
  const low = lowerNfc(text);
  // A per-character accentless copy (same length), to find the phrases and cut the same ranges.
  const flat = [...low].map((c) => stripAccents(c)[0] ?? c).join('');
  if (flat.length !== low.length) return low; // surrogate pairs: give up cutting, rarely matters
  const keep = new Array<boolean>(low.length).fill(true);
  for (const re of HALLUCINATIONS) {
    re.lastIndex = 0;
    for (const m of flat.matchAll(re)) for (let i = m.index!; i < m.index! + m[0].length; i++) keep[i] = false;
  }
  return [...low].map((c, i) => (keep[i] ? c : ' ')).join('');
}

/**
 * A text's comparison tokens without accents: lower case, elisions and hyphens split, numbers as words
 * ("Qu'il t'a dit 3 fois" -> qu il t a dit trois fois). Nothing is dropped, Whisper's stock phrases
 * neither (removeHallucinations cuts everything after « sous-titr… »): the karaoke check
 * (shared/karaoke.ts) must see every word.
 */
export function plainTokens(text: string): string[] {
  return tokens(text).map(stripAccents);
}

function syllables(tok: string): number {
  return (stripAccents(tok).match(/[aeiouy]+/g) ?? []).length;
}

// ---- Alignment ---------------------------------------------------------------------------------

interface Alignment {
  gain: number[]; // per expected token, weight * similarity of its match (0 if unmatched)
}

const MAX_JOIN = 3; // heard pieces joined into one expected word (lui même -> lui-même, a plus bégalix)
const MAX_JOIN_NAME = 4;
const MAX_SPLIT = 2; // expected tokens heard as one word (j'ai -> jai)

/** Best in-order matching of expected tokens to heard tokens (a weighted LCS with joins and splits). */
function align(E: string[], H: string[], weights: number[], names: boolean[]): Alignment {
  const n = E.length;
  const m = H.length;
  // best[i][j] = best total gain for E[i:] and H[j:]; move[i][j] records the step taken.
  const best: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  const move: [number, number, number][][] = Array.from({ length: n + 1 }, () =>
    new Array<[number, number, number]>(m + 1).fill([0, 0, 0]),
  );
  for (let i = n; i >= 0; i--) {
    for (let j = m; j >= 0; j--) {
      if (i === n || j === m) continue;
      let b = best[i + 1]![j]!;
      let mv: [number, number, number] = [1, 0, 0];
      if (best[i]![j + 1]! > b) {
        b = best[i]![j + 1]!;
        mv = [0, 1, 0];
      }
      // One expected token against 1..k heard tokens joined.
      const kmax = names[i] ? MAX_JOIN_NAME : MAX_JOIN;
      let joined = '';
      for (let k = 1; k <= kmax && j + k <= m; k++) {
        joined += H[j + k - 1];
        const sim = similarity(E[i]!, joined, names[i]!);
        const sizeOk = k === 1 || joined.length <= E[i]!.length + 2;
        if (sim > 0 && sizeOk) {
          const g = weights[i]! * sim + best[i + 1]![j + k]!;
          if (g > b + 1e-9) {
            b = g;
            mv = [1, k, sim];
          }
        }
      }
      // 2..MAX_SPLIT expected tokens against one heard token.
      let glued = E[i]!;
      let w = weights[i]!;
      for (let k = 2; k <= MAX_SPLIT && i + k <= n; k++) {
        glued += E[i + k - 1];
        w += weights[i + k - 1]!;
        const sim = similarity(glued, H[j]!, false);
        if (sim > 0) {
          const g = w * sim + best[i + k]![j + 1]!;
          if (g > b + 1e-9) {
            b = g;
            mv = [k, -1, sim];
          }
        }
      }
      best[i]![j] = b;
      move[i]![j] = mv;
    }
  }
  const gain = new Array<number>(n).fill(0);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    const [di, dj, sim] = move[i]![j]!;
    if (dj === -1) {
      for (let k = 0; k < di; k++) gain[i + k] = weights[i + k]! * sim;
      i += di;
      j += 1;
    } else if (di === 1 && dj > 0) {
      gain[i] = weights[i]! * sim;
      i += 1;
      j += dj;
    } else {
      i += di;
      j += dj;
    }
  }
  return { gain };
}

// ---- Scoring -----------------------------------------------------------------------------------

/** Pass thresholds: [max expected tokens, min score, min share of content weight]. */
const LINE_THRESHOLDS: [number, number, number][] = [
  [3, 0.6, 0.5],
  [8, 0.5, 0.5],
  [Infinity, 0.45, 0.4],
];
const UNIT_MIN_SCORE = 0.5;
/** A unit with up to this many content words needs all of them; longer ones need UNIT_LONG_CONTENT. */
const UNIT_ALL_CONTENT_UP_TO = 2;
const UNIT_LONG_CONTENT = 0.6;
/** Transcripts much longer than the target (word salad) are scaled down. */
const LENGTH_SLACK = (n: number) => Math.max(n + 2, Math.ceil(1.6 * n) + 2);

export function scoreSpeech(expected: string, heard: string, opts?: { kind?: SpeechKind }): SpeechScore {
  const kind = opts?.kind ?? 'line';
  const expectedWords = displayWords(expected);
  const wordTokens = expectedWords.map((w) => tokens(w));
  const E = wordTokens.flat();
  const owner = wordTokens.flatMap((ts, wi) => ts.map(() => wi));
  const names = E.map(isName);
  let weights = E.map(weightOf);
  // A line made only of little words (Toi, toi et toi !) counts them all as content.
  const allLittle = weights.every((w) => w < W_CONTENT);
  if (allLittle) weights = weights.map(() => W_CONTENT);
  const isContent = weights.map((w) => w >= W_CONTENT);

  // Transcript: drop stock hallucinations, fillers the target does not have, and runs of one token
  // longer than the target ever has.
  const expectedSet = new Set(E);
  const maxRun = new Map<string, number>();
  const flatE = E.map(stripAccents);
  flatE.forEach((t, k) => {
    let r = 1;
    while (k + r < flatE.length && flatE[k + r] === t) r++;
    maxRun.set(t, Math.max(maxRun.get(t) ?? 0, r));
  });
  const H: string[] = [];
  for (const t of tokens(removeHallucinations(heard))) {
    if (FILLERS.has(t) && !expectedSet.has(t)) continue;
    const ft = stripAccents(t);
    let run = 0;
    for (let k = H.length - 1; k >= 0 && stripAccents(H[k]!) === ft; k--) run++;
    if (run >= (maxRun.get(ft) ?? 1)) continue;
    H.push(t);
  }
  const heardWords = H;

  const zero = (): SpeechScore => ({
    score: 0,
    pass: false,
    matched: expectedWords.map(() => false),
    expectedWords,
    heardWords,
  });
  if (E.length === 0 || H.length === 0) return zero();
  // One syllable cannot say a target of three syllables or more.
  const expSyllables = E.reduce((s, t) => s + syllables(t), 0);
  if (expSyllables >= 3 && H.reduce((s, t) => s + syllables(t), 0) <= 1) return zero();
  // An English sentence (the kid read the translation) is not French.
  const flatSet = new Set(flatE);
  const english = H.filter((t) => ENGLISH.has(t) && !flatSet.has(stripAccents(t))).length;
  if (english >= 2 && english >= 0.3 * H.length) return zero();

  const { gain } = align(E, H, weights, names);
  const total = weights.reduce((s, w) => s + w, 0);
  const contentTotal = weights.reduce((s, w, k) => s + (isContent[k] ? w : 0), 0);
  const contentGain = gain.reduce((s, g, k) => s + (isContent[k] ? g : 0), 0);
  // Little words alone never earn anything: no content word heard means nothing was said.
  if (contentGain === 0) return zero();

  let score = gain.reduce((s, g) => s + g, 0) / total;
  const slack = LENGTH_SLACK(E.length);
  if (H.length > slack) score *= slack / H.length;
  score = Math.min(1, Math.max(0, score));
  const contentShare = contentTotal > 0 ? contentGain / contentTotal : 0;

  let pass: boolean;
  if (kind === 'unit') {
    const contentCount = isContent.filter(Boolean).length;
    const contentHeard = isContent.filter((c, k) => c && gain[k]! > 0).length;
    const needAll = contentCount <= UNIT_ALL_CONTENT_UP_TO;
    pass = score >= UNIT_MIN_SCORE && (needAll ? contentHeard === contentCount : contentHeard / contentCount >= UNIT_LONG_CONTENT);
  } else {
    const [, minScore, minContent] = LINE_THRESHOLDS.find(([max]) => E.length <= max)!;
    pass = score >= minScore && contentShare >= minContent;
  }

  // A display word is lit when at least half of its weight was heard.
  const matched = expectedWords.map((_, wi) => {
    let w = 0;
    let g = 0;
    owner.forEach((o, k) => {
      if (o === wi) {
        w += weights[k]!;
        g += gain[k]! > 0 ? weights[k]! : 0;
      }
    });
    return w > 0 && g / w >= 0.5;
  });
  return { score: Math.round(score * 1000) / 1000, pass, matched, expectedWords, heardWords };
}

// ---- The judge ---------------------------------------------------------------------------------
// When scoreSpeech does not pass, a small Workers AI text model is asked whether the transcript is an
// attempt at one of the candidate lines, judged by sound (docs/app-server.md, "Why this speech design").

export interface JudgeVerdict {
  attempt: boolean;
  candidate: number; // index into the candidates, -1 for none
}

export const JUDGE_SYSTEM = `You check whether a French-immersion child tried to say a French line aloud. A speech recogniser, told which line to expect, wrote down what it heard. Compare by SOUND, not by spelling: each line comes with a rough sound spelling where words that sound alike are written alike.

Say attempt=true when what was heard sounds like the line or a recognisable part of it, even when:
- the spelling differs but the sounds are the same or close (vert/vers/verre, pain/pin, ils ont/il on, est/et/ai, ces/ses/c'est, à/a, mer/mère/maire, copain/copains, gagné/gagner/gagnez, sang/cent/sans, du/tu);
- little words are dropped, added or changed (le/la, de/du, un/une, et);
- the pronunciation is a child's or a learner's: wrong vowels, missing sounds, a name turned into other words ("Je regrasse à Toutatis" for "Je rends grâce à Toutatis", "Déprayébou" for "Déployez-vous");
- only part of the line was said, if it is about half of it or its main words.

Say attempt=false when what was heard is: empty; English or another language; a different French sentence that does not sound like any line; humming or singing ("la la la", "oh oh oh"); one or two words that are not in the line; only the first word of a long line; credits such as "Sous-titrage ST' 501" or "Merci d'avoir regardé".

Answer with JSON only: {"attempt": true or false, "candidate": the number of the line attempted, or -1}`;

/** The chat messages for the judge. `sounds` adds the rough sound spelling of each text. */
export function judgeMessages(candidates: string[], heard: string, opts?: { sounds?: boolean }): { role: 'system' | 'user'; content: string }[] {
  const sounds = opts?.sounds ?? true;
  const clean = (s: string) => s.replace(/\s+/g, ' ').replace(/(^|\s)- /g, '$1').trim();
  const lines = candidates.map((c, i) => `${i}: "${clean(c)}"${sounds ? ` (sounds: ${soundSpelling(c)})` : ''}`);
  const user =
    `${candidates.length > 1 ? 'Lines' : 'Line'}:\n${lines.join('\n')}\n\n` +
    `Heard: "${clean(heard)}"${sounds ? ` (sounds: ${soundSpelling(heard)})` : ''}`;
  return [
    { role: 'system', content: JUDGE_SYSTEM },
    { role: 'user', content: user },
  ];
}

/** The judge's answer, parsed defensively: null when it is not a usable verdict. */
export function parseJudge(answer: unknown, n: number): JudgeVerdict | null {
  let o: unknown = answer;
  if (typeof answer === 'string') {
    const m = answer.match(/\{[\s\S]*?\}/);
    if (!m) return null;
    try {
      o = JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
  if (!o || typeof o !== 'object') return null;
  const r = o as Record<string, unknown>;
  const a = r.attempt;
  const attempt = a === true || a === 'true' ? true : a === false || a === 'false' ? false : null;
  if (attempt === null) return null;
  let candidate = Number(r.candidate ?? (n === 1 ? 0 : -1));
  if (!Number.isInteger(candidate) || candidate < -1 || candidate >= n) candidate = -1;
  if (attempt && candidate === -1) candidate = n === 1 ? 0 : -1;
  if (attempt && candidate === -1) return null;
  return { attempt, candidate };
}

/** When the judge fails or times out: pass anything that heard at least one of the target's content
 *  words (by sound) and is not English, silence or a stock hallucination (scoreSpeech gives those 0). */
export function lenientPass(s: SpeechScore): boolean {
  return s.score > 0 && s.heardWords.length > 0;
}
