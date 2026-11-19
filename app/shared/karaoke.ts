// Karaoke recordings (docs/app-server.md, "Karaoke recordings"; docs/app-games.md, "Karaoke: singing
// along with the microphone"): the check a take must pass before it can be heard or saved, the limits
// the client and the server share, and the timing arithmetic that puts the kid's voice on the song where
// they sang it. Pure; used by the Worker, the client, the fixture client and the tests.
//
// Words: a song is one of the karaoke songs; a take is what the microphone just captured, not saved
// yet; a recording is the kid's saved singing of one song (at most one per kid and song).

import { plainTokens } from './speech';

/** Takes checked (sent to Whisper) per kid and day: generous, a guard on cost only. */
export const KARAOKE_TAKES_PER_DAY = 20;
/** A take may end this long after the song (the recorder stops at the song's end; this is slack). */
export const KARAOKE_SLACK_MS = 2000;
/** The upload's size cap: about 75 s of 16 kHz mono 16-bit WAV, beyond the longest song (54 s, 1.73 MB). */
export const KARAOKE_MAX_BYTES = 2_400_000;
/** A take shorter than this is not worth a check (the server refuses it; the client never sends one). */
export const KARAOKE_MIN_MS = 1000;
/** The longest take the recorder allows, whatever the song: the size cap's length, less a margin. */
export const KARAOKE_MAX_MS = 70_000;
/** Every take is a WAV at this rate, mono, 16-bit PCM: what the recorder makes and every browser decodes. */
export const KARAOKE_RATE = 16000;

// ---- The check: profanity only ------------------------------------------------------------------
//
// What a kid sings does not have to match the song: a take is refused only for words a school would
// not want a kid to keep. The transcript is cut into tokens (plainTokens: lower case, no accents,
// elisions and hyphens split, nothing dropped), and a token counts when
//   - it contains a STEM (unambiguous, also inside a longer word: « connerie », "fuckin", « nazisme »);
//   - it is a WORD (short words that are innocent inside longer ones: « con », « cul », "ass"), also
//     with a final s or x (plurals);
//   - it is a CONTEXT word in its rude context (« bite » after a French determiner, never the English
//     "bite"; « gueule » after « ta », « vos », « ferme »; « baiser » after « faire »);
// and it is not part of an INNOCENT phrase. Innocent phrases cover the two classes of mistake: a
// hyphenated word whose half is a listed word (« pique-nique », « cul-de-sac », « cul-de-jatte »: the
// split halves are matched as a phrase), and a word that is rude in one language or one place and
// innocent in another ("the pros and the cons", "chili con carne", « faire la nique », « pain bâtard »,
// "Moby Dick"). Whisper's own censoring ("f*ck", "f***") counts. The words of the song's lyrics never
// count, and no word the show itself says may be listed (tools/karaoke-bundle.test.ts checks every
// line, alternate, question and answer of the bundle). It refuses every word the account-name filter
// (shared/catalog/badwords.ts) refuses, but those innocent in a sentence (« en retard », the bicycle's
// « pédale », a « tapette » for flies, "hoe", "butt", the Mongols, « sexe » as in boy or girl; and the
// mild insults the show says, « idiot », « crétin »): shared/karaoke.test.ts lists them.

/** Unambiguous: counted anywhere in a token. Accentless lower case. */
const STEMS: readonly string[] = [
  // French
  'merde', 'merdiq', 'merdeu', 'emmerd', 'putain', 'connard', 'conard', 'connass', 'conass', 'connerie',
  'salope', 'salopard', 'salaud', 'encule', 'enfoire', 'batard', 'bordel', 'couill', 'branleu', 'branlett',
  'pouffiass', 'petasse', 'grognasse', 'chiasse', 'chiott', 'foutre', 'niquer', 'tafiole', 'tarlouz', 'fiotte',
  'bougnoul', 'youpin', 'chinetoq', 'sodomi', 'zgeg', 'trouduc', 'nazi', 'hitler', 'porn', 'penis', 'vagin',
  // English
  'fuck', 'shit', 'bitch', 'asshole', 'bastard', 'whore', 'wanker', 'bollock', 'nigga', 'nigger', 'dickhead',
  'motherf', 'blowjob', 'cumshot', 'jizz', 'twat', 'faggot', 'rapist',
];

/** Counted as a whole token (or with a final s or x): innocent inside longer words. */
const WORDS: readonly string[] = [
  // French
  'con', 'conne', 'cul', 'cule', 'ptain', 'pute', 'pede', 'pd', 'zob', 'chier', 'chie', 'chieur', 'chieuse', 'chiant', 'chiante',
  'nique', 'niquez', 'niquent', 'nik', 'branle', 'branler', 'branlent', 'gouine', 'nichon', 'pouffe', 'negre', 'negresse',
  'negro', 'bicot', 'pisse', 'pisser', 'baise', 'baisent', 'baisez', 'heil',
  // English
  'ass', 'arse', 'cunt', 'dick', 'pussy', 'slut', 'cum', 'tits', 'boob', 'fag', 'piss', 'kkk', 'sexy',
];

/** Rude only in their context: the token, and what one of the two tokens before it must be. */
const CONTEXT: readonly { word: RegExp; before: RegExp }[] = [
  { word: /^bites?$/, before: /^(ma|ta|sa|la|une|des|les|mes|tes|ses|grosse|petite|suce|sucer|sucez)$/ }, // never the English "bite"
  { word: /^gueules?$/, before: /^(ta|vos|ferme|fermez|fermes)$/ }, // « ta gueule », « ferme ta grande gueule »; never « sa gueule », « la gueule du loup »
  { word: /^baiser$/, before: /^(faire|fais|va|vas|allez)$/ }, // « va te faire baiser »; never « un baiser »
];

/** Innocent phrases, a regular expression per token: their tokens never count. */
const INNOCENT: readonly string[] = [
  'pique niqu\\w*', // pique-nique, pique-niquer, pique-niquent
  'la nique', // faire la nique
  'cul de (sac|jatte|poule|bouteille|la)', // cul-de-sac, cul-de-jatte, le cul de la bouteille
  'culs de (sac|jatte|poule|bouteille)',
  'cul sec',
  'con (carne|amor|brio|fuoco|moto)', // chili con carne, con amore
  '(pros?|and|the|a) cons?', // the pros and the cons, a con
  'pros (et|and) (les|the) cons?',
  'pros (et|and) cons?',
  'pains? batards?',
  'chiens? batards?',
  'moby dick',
  'dick rivers',
  'cum laude',
];

const RUDE_WORDS = new Set(WORDS);
const INNOCENT_SEQ = INNOCENT.map((p) => p.split(' ').map((x) => new RegExp(`^(${x})$`)));
/** Whisper's own censoring: a letter then stars ("f*ck", "f***"), or a run of stars. */
const CENSORED = /\p{L}\*+\p{L}|\p{L}\*{2,}|\*{3,}/u;

function isRudeWord(t: string): boolean {
  if (RUDE_WORDS.has(t)) return true;
  return t.length > 2 && /[sx]$/.test(t) && RUDE_WORDS.has(t.slice(0, -1));
}

export interface TakeCheck {
  /** Nothing rude was heard: the take may be heard and kept. */
  ok: boolean;
  /** What counted, for the activity log (never shown to the kid). */
  words: string[];
}

/** Does this transcript hold a word a school would not want a kid to keep? The song's own lyrics never count. */
export function checkTake(transcript: string, lyrics: readonly string[]): TakeCheck {
  const toks = plainTokens(transcript);
  const lyr = plainTokens(lyrics.join('\n'));
  const lyricSet = new Set(lyr); // a word of the song never counts (« ta gueule » in a song that sings it)
  const innocent = toks.map(() => false);
  for (const seq of INNOCENT_SEQ) {
    for (let i = 0; i + seq.length <= toks.length; i++) {
      if (seq.every((re, k) => re.test(toks[i + k]!))) for (let k = 0; k < seq.length; k++) innocent[i + k] = true;
    }
  }
  const found: string[] = [];
  toks.forEach((t, i) => {
    if (innocent[i] || lyricSet.has(t)) return;
    const rude =
      STEMS.some((stem) => t.includes(stem)) ||
      isRudeWord(t) ||
      CONTEXT.some((c) => c.word.test(t) && [toks[i - 1], toks[i - 2]].some((b) => b !== undefined && c.before.test(b)));
    if (rude) found.push(t);
  });
  const words = [...new Set(found)];
  if (CENSORED.test(transcript)) words.push('***');
  return { ok: words.length === 0, words };
}

// ---- Timing: the voice where it was sung --------------------------------------------------------
//
// While a take records, the song plays through the audio engine (its own AudioContext) and the
// microphone is read by the recorder (another AudioContext). Both clocks are mapped to
// performance.now(): the recorder notes when its first sample reached the microphone, the engine when
// the song's position 0 reached the ear. The kid sings with what they hear, so the take's first sample
// belongs where the song was at that moment: offset = capture start - song start, both as heard. On
// playback the song and the voice go through the same engine and the same output, so nothing more is
// added. What the browser does not report (input latency on most browsers, Bluetooth output latency on
// some) shifts the voice late by that much.

/**
 * When the take's first sample reached the microphone, in performance.now() ms: the recorder's
 * context processed it at `firstSampleCtxS` on its clock, which read `ctxNowS` at `perfNowMs`; the
 * sound took `inputLatencyS` (MediaTrackSettings.latency, where the browser reports it) to get there.
 */
export function captureStartMs(perfNowMs: number, ctxNowS: number, firstSampleCtxS: number, inputLatencyS = 0): number {
  return perfNowMs - (ctxNowS - firstSampleCtxS) * 1000 - inputLatencyS * 1000;
}

export interface PlayClock {
  perfNowMs: number; // performance.now() ...
  ctxNowS: number; // ... and the engine's context clock read at the same moment
  outputLatencyS: number; // from rendering to the ear (outputLatency, else baseLatency)
  whenS: number; // the iteration starts on the context clock
  offsetS: number; // at this clip second
  rate: number;
}

/** When clip position `clipMs` of an iteration is heard, in performance.now() ms. */
export function heardAtMs(p: PlayClock, clipMs: number): number {
  return p.perfNowMs + (p.whenS + (clipMs / 1000 - p.offsetS) / p.rate - p.ctxNowS + p.outputLatencyS) * 1000;
}

/** Where the take's first sample sits on the song, in ms (negative: the microphone opened before the song began). */
export function takeOffsetMs(captureStartPerfMs: number, songZeroHeardPerfMs: number): number {
  return Math.round(captureStartPerfMs - songZeroHeardPerfMs);
}

/** A take that began before the song: the samples to drop from its start so it begins at the song's 0, and its offset then. */
export function alignTake(offsetMs: number, rate = KARAOKE_RATE): { dropSamples: number; offsetMs: number } {
  if (offsetMs >= 0) return { dropSamples: 0, offsetMs: Math.round(offsetMs) };
  return { dropSamples: Math.round((-offsetMs * rate) / 1000), offsetMs: 0 };
}

/**
 * The overlay's part of one iteration of a play. The iteration plays clip seconds [fromS, fromS + durS)
 * from `whenS` on the context clock at `rate`; the overlay (the kid's voice) covers clip seconds
 * [overlayOffsetS, overlayOffsetS + overlayDurS). Returns when to start the overlay, from where in it
 * and for how long (overlay seconds), or null when the two do not meet.
 */
export function overlaySpan(whenS: number, fromS: number, durS: number, rate: number, overlayOffsetS: number, overlayDurS: number): { atS: number; overlayFromS: number; durS: number } | null {
  const a = Math.max(fromS, overlayOffsetS);
  const b = Math.min(fromS + durS, overlayOffsetS + overlayDurS);
  if (b - a < 0.01) return null;
  return { atS: whenS + (a - fromS) / rate, overlayFromS: a - overlayOffsetS, durS: b - a };
}
