// Client counters for POST /api/events (loops heard, songs sung), batched.
// The engine reports a loop heard each time a looping play reaches its second round; the practice
// shell flushes at the end of each puzzle, screens flush when they unmount, and the page flushes
// with a beacon when it is hidden or closed.
import type { ClientStat } from '../../../shared/api';
import { api } from '../api';
import { usePlayer } from '../state/player';
import { onLoopHeard } from './index';

type Key = string;
const pending = new Map<Key, { stat: ClientStat; n: number; ref?: string }>();
let flushing: Promise<void> | null = null;

/** Count one event (or n). ref: the unit, line or song id. */
export function countEvent(stat: ClientStat, ref?: string, n = 1): void {
  const k = `${stat}|${ref ?? ''}`;
  const e = pending.get(k);
  if (e) e.n += n;
  else pending.set(k, { stat, n, ...(ref ? { ref } : {}) });
}

export function pendingEvents(): { stat: ClientStat; n: number; ref?: string }[] {
  return [...pending.values()];
}

/** Send what is pending. Failures put the counts back for the next flush. */
export function flushEvents(): Promise<void> {
  if (flushing) return flushing;
  if (!pending.size) return Promise.resolve();
  const events = [...pending.values()];
  pending.clear();
  flushing = api
    .events({ events })
    .then((r) => usePlayer.getState().apply(r.patch))
    .catch(() => {
      for (const e of events) countEvent(e.stat, e.ref, e.n);
    })
    .finally(() => {
      flushing = null;
    });
  return flushing;
}

function beacon(): void {
  if (!pending.size || typeof navigator === 'undefined' || !navigator.sendBeacon) return;
  if (import.meta.env.VITE_FIXTURES === '1') return; // no server to receive it
  const body = new Blob([JSON.stringify({ events: [...pending.values()] })], { type: 'application/json' });
  if (navigator.sendBeacon('/api/events', body)) pending.clear();
}

let installed = false;
/** Wire the engine's loop counter and the page-hide beacon. Called once by main code paths that play audio. */
export function installEventCounters(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  onLoopHeard((tag) => {
    const ref = tag ? tag.slice(tag.indexOf(':') + 1) : undefined;
    countEvent('loopsHeard', ref);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) beacon();
  });
  window.addEventListener('pagehide', beacon);
}
