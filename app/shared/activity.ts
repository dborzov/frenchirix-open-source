// The activity log and the kids' problem reports (docs/app-server.md, "Activity log and reports").
// The kinds of event are a small closed list: the client sends only CLIENT_LOG_KINDS (POST /api/log
// ignores anything else), the Worker writes SERVER_LOG_KINDS itself. Add a kind here, in the right
// list, and describe it in the docs; never reuse a kind for something else (rows are kept 180 days).

/** What the client logs (web/src/log/). */
export const CLIENT_LOG_KINDS = [
  'app-open', // the app started: { standalone, width, height, online }
  'route', // the path changed (the row's route is the new path)
  'practice-open', // the practice screen composed its practice: { practiceId, sceneId, level, replay, puzzles, startAt, speak }
  'puzzle-show', // a puzzle appeared: { practiceId, index, puzzleId, type }
  'puzzle-done', // a puzzle was finished: { practiceId, index, puzzleId, type, mistakes, hints, ms, skipped }
  'practice-results', // the results of a practice showed: { practiceId, puzzles, ms, alreadySaved }
  'api-fail', // a failed API call: { kind, code, status, method, path, ms }
  'media-fail', // a media file did not load: { reason: 'timeout' | 'offline' | 'http' | 'decode', status, src, where: 'gate' | 'play' }
  'crash', // an uncaught error, an unhandled rejection or an error boundary: { source, message, stack, where? }
  'cant-speak', // « Je ne peux pas parler »: { from: 'puzzle' | 'header', type }
  'mic', // the microphone could not be used: { status: 'denied' | 'unsupported' | 'error', type }
] as const;

/** What the Worker logs itself. */
export const SERVER_LOG_KINDS = [
  'speech', // every POST /api/speech that got a transcript: what was expected, what was heard, the verdict
  'server-error', // every 5xx the Worker answered: { status, code, message, method, path }
  'practice-start', // POST /api/practices/start: { practiceId, kind, sceneId, level, replay, done, total }
  'practice-progress', // POST /api/practices/:id/progress: { practiceId, done, total, fresh, xp }
  'practice-complete', // POST /api/practices/:id/complete: { practiceId, sceneId, level, replay, stars, done, ms, quest }
  'quests-built', // the day's quests were built (the day's first visit): { quests: [{ kind, sceneId, level, reason }], due }
  'quest-done', // a quest was done: { index, kind, round, sceneId, level, chest }
  'quest-more', // "Do more": { round, candidates }
  'streak', // today became a light or a full streak day: { kind: 'light' | 'full', count, freezesUsed, reset }
  'karaoke-take', // every karaoke take checked: { songId, verdict, words, transcript, offsetMs, durationMs, bytes, takeId, whisperMs, totalMs }
] as const;

export type ClientLogKind = (typeof CLIENT_LOG_KINDS)[number];
export type ServerLogKind = (typeof SERVER_LOG_KINDS)[number];
export type LogKind = ClientLogKind | ServerLogKind;

export const isClientLogKind = (k: unknown): k is ClientLogKind => typeof k === 'string' && (CLIENT_LOG_KINDS as readonly string[]).includes(k);

/** One event as the client sends it. `at` in ms since the epoch; `route` the path at that moment. */
export interface LogEvent {
  kind: ClientLogKind;
  at: number;
  route: string;
  data: Record<string, unknown>;
}

// POST /api/log: a batch of events (204). With or without a session; never an error the kid sees.
export interface LogRequest {
  /** A random id per browser tab (sessionStorage), to tell two tabs of one kid apart. */
  tab?: string;
  /** The client's build (sendBeacon cannot send the x-frx-build header). */
  build?: string;
  /** The client's clock when sending: the server moves the events' times by the difference. */
  sentAt?: number;
  events: LogEvent[];
}

// POST /api/reports: one "Quelque chose ne va pas ?" report -> { id }.
export interface ReportRequest {
  /** What the kid typed (may be empty). */
  text: string;
  route: string;
  /** What the app knew at the moment the button was pressed (web/src/report/context.ts). */
  context: Record<string, unknown>;
}
export interface ReportResponse {
  id: number;
}

/** The client's per-tab id on its API calls, so the Worker's own events link to the tab. */
export const TAB_HEADER = 'x-frx-tab';

/** Caps, shared so the client stays under what the server accepts. */
export const LOG_MAX_EVENTS = 50; // per request
export const LOG_MAX_BYTES = 64_000; // per request body
export const LOG_MAX_DATA_CHARS = 2_000; // per event's data JSON (beyond: { truncated: true })
export const REPORT_MAX_TEXT = 2_000; // characters of the kid's text kept
export const REPORT_MAX_CONTEXT_CHARS = 64_000; // the context JSON kept (beyond: { truncated, partial })
export const REPORTS_PER_HOUR = 10; // per kid
/** Activity rows older than this are deleted by the daily scheduled job; reports are kept. */
export const ACTIVITY_KEEP_DAYS = 180;
