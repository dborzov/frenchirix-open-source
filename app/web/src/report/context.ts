// What a "Quelque chose ne va pas ?" report carries besides the kid's words (docs/app-architecture.md,
// "Activity log and reports"): taken when the button is pressed, before the form covers the screen.
// The route and practice, the puzzle on screen (index, type, id, its reducer state as truncated JSON),
// the state attributes visible in the puzzle pane (data-step, data-phase…) and its enabled controls, the
// last logged events and console errors, the build, the layout, speaking and sound, the network.
// fitContext keeps the whole under CONTEXT_MAX characters of JSON (the server keeps REPORT_MAX_CONTEXT_CHARS).
import { REPORT_MAX_CONTEXT_CHARS } from '../../../shared/activity';
import { getLanguage } from '../../../shared/i18n';
import { errorDetail } from '../api/errors';
import { audio } from '../audio';
import { TAB, puzzleWhere, recentConsoleErrors, recentEvents } from '../log';
import { BUILD } from '../pwa/update';
import { usePlayer } from '../state/player';

export const CONTEXT_MAX = REPORT_MAX_CONTEXT_CHARS - 16_000;
export const STATE_MAX = 6_000;
export const EVENTS_KEPT = 50;

/** The views' state attributes (the same ones the liveness check reads) and flags. */
const STATE_ATTRS = ['data-step', 'data-phase', 'data-status', 'data-stage', 'data-mode', 'data-chain-status', 'data-speak', 'data-record', 'data-mic-denied', 'data-speak-note'];
const STATE_FLAGS = ['data-mic-intro', 'data-listen-back', 'data-chain-end'];
/** Marks of the practice screen around the puzzle. */
const SCREEN_MARKS: [string, string][] = [
  ['[data-continue]', 'continue-bar'],
  ['[data-save-failed]', 'save-failed'],
  ['[data-practice-finishing]', 'finishing'],
];

/** JSON of a value, cut to `max` characters (a string; '…' marks the cut). */
export function clipJson(v: unknown, max: number): string {
  let s: string;
  try {
    s = JSON.stringify(v) ?? 'undefined';
  } catch (e) {
    s = `unserialisable: ${String(e)}`;
  }
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** `step=back speak=idle …` of the puzzle pane, and the marks of the screen around it. */
export function paneState(root: ParentNode = document): { pane: string; screen: string[]; controls: string[] } {
  const parts = new Set<string>();
  const controls: string[] = [];
  const pane = root.querySelector('[data-puzzle-pane]');
  if (pane) {
    for (const el of [pane, ...pane.querySelectorAll('*')]) {
      for (const a of STATE_ATTRS) {
        const v = el.getAttribute(a);
        if (v !== null) parts.add(`${a.slice(5)}=${v.slice(0, 40)}`);
      }
      for (const a of STATE_FLAGS) if (el.hasAttribute(a)) parts.add(a.slice(5));
    }
    for (const b of pane.querySelectorAll<HTMLButtonElement>('button')) {
      if (b.disabled || b.getAttribute('aria-disabled') === 'true' || controls.length >= 20) continue;
      const data = b.getAttributeNames().find((n) => n.startsWith('data-'));
      controls.push((data ? data.slice(5) : (b.getAttribute('aria-label') ?? b.textContent ?? 'button')).trim().slice(0, 30));
    }
  }
  const screen = SCREEN_MARKS.filter(([sel]) => root.querySelector(sel)).map(([, name]) => name);
  for (const p of root.querySelectorAll('[data-error-panel]')) screen.push(`error-panel=${p.getAttribute('data-error-kind') ?? '?'}`);
  return { pane: pane ? [...parts].sort().join(' ') || '-' : '(no puzzle pane)', screen, controls };
}

const practiceIdOfRoute = (path: string): string | null => /^\/practice\/([^/?#]+)/.exec(path)?.[1] ?? null;

/** Everything the report carries, taken now. `error`: the error of the panel the button is on. */
export function captureContext(opts: { error?: unknown } = {}): Record<string, unknown> {
  const w = puzzleWhere();
  const player = usePlayer.getState().state;
  const path = location.pathname;
  const ctx: Record<string, unknown> = {
    route: path + location.search,
    at: new Date().toISOString(),
    build: BUILD,
    tab: TAB,
    practiceId: w?.practiceId ?? practiceIdOfRoute(path),
  };
  if (w) {
    ctx.puzzle = { index: w.index, count: w.count, type: w.type, id: w.puzzleId };
    ctx.puzzleState = clipJson(safe(w.state), STATE_MAX);
  }
  try {
    Object.assign(ctx, paneState());
  } catch {
    // no DOM
  }
  if (opts.error !== undefined) ctx.error = errorDetail(opts.error);
  Object.assign(ctx, {
    layout: window.matchMedia?.('(min-width: 768px)').matches ? 'tablet' : 'phone',
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    standalone: window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true,
    speak: w?.speak ?? player?.profile.speak ?? null,
    muted: safe(() => audio.isMuted()),
    language: getLanguage(),
    online: navigator.onLine,
    kid: player ? { id: player.profile.id, name: player.profile.name } : null,
    consoleErrors: recentConsoleErrors(),
    events: recentEvents(EVENTS_KEPT),
  });
  return fitContext(ctx);
}

function safe<T>(f: () => T): T | null {
  try {
    return f();
  } catch {
    return null;
  }
}

const size = (v: unknown): number => {
  try {
    return JSON.stringify(v).length;
  } catch {
    return Infinity;
  }
};

/** Under `max` characters of JSON: the puzzle state shortened first, then fewer events, then their data. */
export function fitContext(ctx: Record<string, unknown>, max = CONTEXT_MAX): Record<string, unknown> {
  const out = { ...ctx };
  if (size(out) <= max) return out;
  if (typeof out.puzzleState === 'string' && out.puzzleState.length > 1500) out.puzzleState = `${out.puzzleState.slice(0, 1500)}…`;
  let events = Array.isArray(out.events) ? [...(out.events as unknown[])] : [];
  while (size(out) > max && events.length > 10) {
    events = events.slice(Math.ceil(events.length / 2));
    out.events = events;
  }
  if (size(out) > max) out.events = events.map((e) => ({ ...(e as object), data: { dropped: true } }));
  if (size(out) > max) delete out.puzzleState;
  if (size(out) > max) out.consoleErrors = [];
  if (size(out) > max) return { route: out.route, build: out.build, practiceId: out.practiceId, puzzle: out.puzzle, error: out.error, truncated: true };
  return out;
}
