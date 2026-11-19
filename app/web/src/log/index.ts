// The activity log on the client (docs/app-architecture.md, "Activity log and reports").
//
//   log('puzzle-done', { type, mistakes, hints, ms })
//
// log() keeps the last RING_SIZE events in memory (a "Quelque chose ne va pas ?" report sends the last
// ones) and, once installLogging() has run (main.tsx), sends them to POST /api/log in batches: every
// FLUSH_MS, every BATCH_SIZE events, and when the page is hidden or left (navigator.sendBeacon). A
// failed send is dropped quietly: this is the one place where a silent failure is right, because
// logging must never bother a kid. Nothing here throws. Before installLogging() (unit tests, the
// liveness check) nothing is sent and no timer runs.
//
// The kinds are a closed list (CLIENT_LOG_KINDS in shared/activity.ts); one line per event where it
// happens. Also kept here: the last console errors (for reports) and the puzzle on screen (puzzleWhere).
import { LOG_MAX_BYTES, LOG_MAX_DATA_CHARS, LOG_MAX_EVENTS, TAB_HEADER, type ClientLogKind, type LogEvent, type LogRequest } from '../../../shared/activity';
import { BUILD_HEADER } from '../../../shared/build';
import { BUILD } from '../pwa/update';

export const RING_SIZE = 100;
export const BATCH_SIZE = 20;
export const FLUSH_MS = 30_000;
const QUEUE_MAX = 200;
const CONSOLE_KEEP = 10;
const STRING_MAX = 500;
const LOG_PATH = '/api/log';

/** Sends one batch (a LogRequest as JSON); `beacon` when the page is going away. Must not throw. */
export type LogSender = (body: string, beacon: boolean) => void;

let ring: LogEvent[] = [];
let queue: LogEvent[] = [];
let consoleErrors: string[] = [];
let sender: LogSender | null = null;

/** A random id for this browser tab, kept across reloads in sessionStorage. */
export const TAB: string = (() => {
  const make = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  try {
    const k = 'frx.log.tab';
    const v = sessionStorage.getItem(k);
    if (v) return v;
    const id = make();
    sessionStorage.setItem(k, id);
    return id;
  } catch {
    return make();
  }
})();

const here = (): string => {
  try {
    return location.pathname;
  } catch {
    return '?';
  }
};

/** A plain copy of the data, strings clipped, at most LOG_MAX_DATA_CHARS of JSON. */
function tidy(data: Record<string, unknown>): Record<string, unknown> {
  try {
    const s = JSON.stringify(data, (_k, v: unknown) => (typeof v === 'string' && v.length > STRING_MAX ? `${v.slice(0, STRING_MAX)}…` : v));
    if (!s) return {};
    return s.length <= LOG_MAX_DATA_CHARS - 20 ? (JSON.parse(s) as Record<string, unknown>) : { truncated: true, chars: s.length };
  } catch {
    return { unloggable: true };
  }
}

/** Record one event. Never throws. */
export function log(kind: ClientLogKind, data: Record<string, unknown> = {}): void {
  try {
    const e: LogEvent = { kind, at: Date.now(), route: here(), data: tidy(data) };
    ring.push(e);
    if (ring.length > RING_SIZE) ring.splice(0, ring.length - RING_SIZE);
    if (!sender) return;
    queue.push(e);
    if (queue.length > QUEUE_MAX) queue.splice(0, queue.length - QUEUE_MAX);
    if (queue.length >= BATCH_SIZE) flushLog();
  } catch {
    // logging must never bother a kid
  }
}

/** Send what is queued, in batches under the server's caps. Never throws. */
export function flushLog(beacon = false): void {
  if (!sender) return;
  try {
    while (queue.length) {
      const events: LogEvent[] = [];
      let size = 200;
      while (queue.length && events.length < LOG_MAX_EVENTS) {
        const n = JSON.stringify(queue[0]).length + 1;
        if (events.length && size + n > LOG_MAX_BYTES - 1000) break;
        events.push(queue.shift()!);
        size += n;
      }
      const body: LogRequest = { tab: TAB, build: BUILD, sentAt: Date.now(), events };
      try {
        sender(JSON.stringify(body), beacon);
      } catch {
        // dropped
      }
    }
  } catch {
    queue = [];
  }
}

/** The last n events, oldest first (copies). */
export function recentEvents(n = 50): LogEvent[] {
  return ring.slice(-n).map((e) => ({ ...e }));
}

// Dev builds: the end-to-end specs read what was logged (window.__frxLog()).
if (typeof window !== 'undefined' && import.meta.env?.DEV) (window as unknown as { __frxLog: () => LogEvent[] }).__frxLog = () => recentEvents(100);

/** The last console errors, newest last. */
export function recentConsoleErrors(): string[] {
  return [...consoleErrors];
}

const text = (v: unknown): string => {
  if (v instanceof Error) return `${v.name}: ${v.message}`;
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
};

/** An error's message and the first lines of its stack, for a 'crash' event. */
export function crashData(e: unknown): { message: string; stack?: string } {
  const message = text(e).slice(0, 300);
  const stack = e instanceof Error && e.stack ? e.stack.split('\n').slice(0, 6).join('\n').slice(0, 800) : undefined;
  return stack ? { message, stack } : { message };
}

function noteConsoleError(args: unknown[]): void {
  try {
    consoleErrors.push(args.map(text).join(' ').replace(/\s+/g, ' ').slice(0, 300));
    if (consoleErrors.length > CONSOLE_KEEP) consoleErrors.splice(0, consoleErrors.length - CONSOLE_KEEP);
  } catch {
    // nothing
  }
}

/** POST /api/log with fetch (keepalive), or sendBeacon when the page is going away. Failures are dropped. */
const httpSender: LogSender = (body, beacon) => {
  if (beacon && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
    try {
      if (navigator.sendBeacon(LOG_PATH, new Blob([body], { type: 'application/json' }))) return;
    } catch {
      // fall back to fetch
    }
  }
  fetch(LOG_PATH, {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/json', [BUILD_HEADER]: BUILD, [TAB_HEADER]: TAB },
    credentials: 'same-origin',
    keepalive: true,
  }).catch(() => {});
};

let installed = false;

/**
 * Once, from main.tsx: start sending (not in fixture mode, which has no server), catch uncaught errors
 * and unhandled rejections, keep the console's errors, and log that the app opened.
 */
export function installLogging(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  if (import.meta.env.VITE_FIXTURES !== '1') sender = httpSender;
  window.setInterval(() => flushLog(), FLUSH_MS);
  window.addEventListener('pagehide', () => flushLog(true));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushLog(true);
  });
  window.addEventListener('error', (e: ErrorEvent) => log('crash', { source: 'error', ...crashData(e.error ?? e.message), file: e.filename ? `${e.filename}:${e.lineno}:${e.colno}` : undefined }));
  window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => log('crash', { source: 'rejection', ...crashData(e.reason) }));
  const original = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    noteConsoleError(args);
    original(...args);
  };
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
  log('app-open', { standalone, width: window.innerWidth, height: window.innerHeight, online: navigator.onLine });
}

// ---- The puzzle on screen, for reports and for the speech log ---------------------------------------

export interface PuzzleWhere {
  practiceId: string;
  index: number; // 0-based in the practice
  count: number;
  puzzleId: string;
  type: string;
  speak: boolean;
  /** The puzzle's reducer state now. */
  state: () => unknown;
}

let where: PuzzleWhere | null = null;

/** The practice screen says which puzzle is on screen (PuzzleHost); null when none. */
export function setPuzzleWhere(w: PuzzleWhere | null): void {
  where = w;
}

/** Clears it only if `w` is still the one on screen (the next puzzle may have set its own). */
export function clearPuzzleWhere(w: PuzzleWhere): void {
  if (where === w) where = null;
}

export function puzzleWhere(): PuzzleWhere | null {
  return where;
}

// ---- Test seams -----------------------------------------------------------------------------------

/** Tests only: replace the sender (null: send nothing), and forget every event. */
export function setLogSenderForTests(s: LogSender | null): void {
  sender = s;
  ring = [];
  queue = [];
  consoleErrors = [];
  where = null;
}

/** Tests only: what console.error was given (installLogging wraps the console in the app). */
export const noteConsoleErrorForTests = noteConsoleError;
