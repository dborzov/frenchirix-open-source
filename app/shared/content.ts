// Types of the content bundle written by `frenchirix export-app` into app/public/data.
// Transcribed from docs/app-architecture.md, "Content bundle". This file is the source of truth.
//
// Times in the bundle are milliseconds from the start of that scene's (or song's) audio file,
// except SceneSummary.startMs, which places the scene on the episode timeline.
// Media paths (`src`, `thumb`, `drill`) are URLs served by the app, e.g. '/media/a/<scene id>.m4a'.

export interface ContentIndex {
  version: string; // hash of the content, for cache busting
  episodes: EpisodeSummary[];
  scenes: SceneSummary[];
  songs: SongSummary[];
  bank: { lines: { fr: string; en: string }[]; units: { fr: string; en: string }[] }; // distractors for small scenes
}

export interface EpisodeSummary {
  id: string; // 's01e04'
  number: number;
  titleFr: string;
  titleEn: string;
  durationMs: number;
  sceneIds: string[]; // in timeline order
}

export interface SongSummary {
  id: string;
  episode: string;
  titleFr: string;
  titleEn: string;
  durationMs: number;
  thumb: string;
  starter?: boolean; // one of the songs the user wants offered first ("Choosing new scenes", docs/intent.md)
}

export type SceneKind = 'dialogue' | 'monologue' | 'song';

export interface SceneSummary {
  id: string;
  episode: string;
  order: number; // 0-based position on the episode timeline
  startMs: number; // where the scene starts in the episode (to place it on the timeline)
  durationMs: number; // length of the audio
  kind: SceneKind;
  titleFr: string;
  titleEn: string;
  score: number; // 1-5, how funny or interesting
  difficulty: number; // 1-5, how hard the French is
  thumb: string; // a representative frame
  lineCount: number;
  wordCount: number;
  songId?: string; // set when every line of the scene lies inside the line range of this song
}

export interface Frame {
  t: number; // when the frame appears
  src: string;
}

export interface Scene extends SceneSummary {
  audio: { src: string; durationMs: number };
  frames: Frame[];
  lines: Line[];
  notes: Note[]; // cultural references and wordplay, in English, for a ten-year-old
  questions: Question[];
}

export interface Line {
  id: string; // 's01e04-0016'
  speaker: string | null;
  fr: string; // what is said
  en: string; // its literal English
  startMs: number; // where it is spoken
  endMs: number;
  // Present and true when the forced alignment of this line was unreliable and its word times
  // (and so its unit loop windows) were placed approximately: on the speech recogniser's words,
  // or spread over the subtitle time by word length. See docs/app-export.md.
  approxTimes?: boolean;
  units: Unit[]; // cover every word of the line, in order, without overlap
  // Two funny alterations of the line (for say-choice), from app/data/alternates/<episode>.json.
  // units tile fr like a question's; audio is '/media/q/<hash>.m4a' when that clip exists
  // (same hash rule as the questions, docs/app-tts.md).
  alternates?: LineAlternate[];
}

export interface LineAlternate {
  fr: string;
  en: string;
  units: GlossUnit[];
  audio?: string;
}

export interface UnitWord {
  fr: string;
  cs: number;
  ce: number;
  startMs: number;
  endMs: number;
}

export interface Unit {
  id: string; // '<line id>:<idx>', stable across exports; the key for per-kid statistics
  kind: 'word' | 'expression';
  fr: string;
  en: string;
  note?: string;
  cs: number; // character span in line.fr (text between units is punctuation and spaces)
  ce: number;
  startMs: number; // the loop window in the audio
  endMs: number;
  key: boolean; // carries meaning: eligible for blanks, matching, saying. False for bare pronouns, articles, interjections
  words: UnitWord[];
  drill?: string; // path of a v1 word drill for this French, when there is one (play through, do not loop)
}

export interface Note {
  kind: 'reference' | 'wordplay';
  text: string;
  phrase?: string;
  lineId?: string;
  unitIds?: string[];
}

// A tappable piece of our own French (questions and answers): [cs, ce) is its span in the sentence.
// The units of a sentence tile it in order; text between them is only spaces and punctuation.
export interface GlossUnit {
  fr: string;
  en: string; // the meaning of this piece in this sentence
  cs: number;
  ce: number;
}

export interface QuestionAnswer {
  fr: string;
  en: string;
  correct: boolean;
  units: GlossUnit[];
  audio?: string; // '/media/q/<hash>.m4a', the pre-generated clip of this answer, when it exists
}

export type QuestionVoice = 'squeaky' | 'deep' | 'wobble' | 'echo';

export interface Question {
  id: string; // '<scene id>:q1'
  lineId?: string; // the line it is about
  fr: string;
  en: string;
  units: GlossUnit[];
  answers: QuestionAnswer[]; // 3 or 4, exactly one correct, the wrong ones funny
  // The funny voice preset the player applies, fixed per question at export.
  voice: QuestionVoice;
  // '/media/q/<hash>.m4a': the question's pre-generated clip, present only when the file exists.
  // <hash> = first 16 hex digits of SHA-1 of the exact sentence, UTF-8 (docs/app-tts.md).
  audio?: string;
}

export interface Song {
  id: string;
  episode: string;
  titleFr: string;
  titleEn: string;
  audio: { src: string; durationMs: number };
  frames: Frame[];
  lines: Line[];
}
