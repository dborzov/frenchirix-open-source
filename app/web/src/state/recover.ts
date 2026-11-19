// What the app does when an API call fails (docs/app-architecture.md, "Errors"): the screen goes back
// to its last working state. A failed load shows the error panel in place (ui/ErrorPanel); a failed
// action leaves the screen as it was, says what happened in a toast with the admin's detail line, and
// its control works again (the caller resets its busy state). By kind (api/errors.ts):
//   outdated, gate   the client is reloading (api/client.ts); nothing to show
//   session          the app boots again (state/player.ts); the toast says so
//   stale            the screen showed something the server no longer agrees with: GET /api/me, then
//                    the fresh screen with a short "this changed" note
//   offline, timeout, server, client   the kid's message; « Réessayer » is the same control again
import { api, errorDetail, errorMessage, kindOf } from '../api';
import { toast } from '../ui';
import { usePlayer } from './player';

/** A resumed app refreshes a copy older than this (visibilitychange). */
export const STALE_AFTER_MS = 10 * 60_000;

let refreshing: Promise<boolean> | null = null;

/** Fetch the whole state again (GET /api/me) and show it. False when that failed too (the old copy stays). */
export function refreshState(): Promise<boolean> {
  refreshing ??= api
    .me()
    .then((res) => {
      usePlayer.getState().replace(res.state);
      return true;
    })
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

/** Refresh when the copy is older than `maxAgeMs` (the app came back to the foreground). */
export function refreshIfOld(maxAgeMs = STALE_AFTER_MS): void {
  const { status, syncedAt } = usePlayer.getState();
  if (status === 'ready' && Date.now() - syncedAt > maxAgeMs) void refreshState();
}

let watching = false;
/** Once, from App: when the app becomes visible again, refresh a copy older than STALE_AFTER_MS. */
export function installStaleWatch(): void {
  if (watching || typeof document === 'undefined') return;
  watching = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshIfOld();
  });
}

/**
 * The common side of any failure: refresh on a stale view. Returns false when there is nothing to show
 * (the page is reloading or booting again).
 */
export function recover(e: unknown): boolean {
  const kind = kindOf(e);
  if (kind === 'outdated' || kind === 'gate') return false;
  if (kind === 'stale') void refreshState();
  return true;
}

/** A failed action (unlock, start a practice, open a chest, buy, follow, rename…): see the top of this file. */
export function actionFailed(e: unknown): void {
  const kind = kindOf(e);
  if (kind === 'crash') console.error('[frx] action failed', e);
  if (!recover(e)) return;
  toast(errorMessage(e), { color: kind === 'stale' ? 'yellow' : kind === 'session' ? 'white' : 'tomato', icon: kind === 'stale' ? 'loop' : 'help', detail: errorDetail(e) });
}
