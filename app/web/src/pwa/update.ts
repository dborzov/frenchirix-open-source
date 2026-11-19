// Noticing a new build and switching to it at a safe moment (docs/app-release.md, "Updates").
//
// - Every API response carries the deployed build (x-frx-build); the HTTP client reports it here
//   (noteServerBuild). When the app comes back to the foreground or regains the network, one
//   GET /api/build asks again. Nothing polls in the background.
// - A newer build is "pending". It is applied (a NOUVEAU ! burst, then a reload) only on an idle
//   screen: never in a practice, a chest, karaoke, the login or the avatar editor. Leaving such a screen
//   for an idle one, or resuming the app on one, applies it.
// - A client older than the server's minimum gets 409 client-outdated on every API call: the HTTP
//   client calls outdated(), which reloads at once (whatever the screen: the server will not talk to
//   this page any more; finished practices are safe in localStorage and are resent after the reload).
// - A code-split chunk that fails to load (the page asks for a file a deploy removed) reloads the
//   app once instead of leaving a blank screen.
// Reloads are guarded in sessionStorage so a page that keeps getting an old copy cannot loop.
import { BUILD_HEADER, isClientTooOld, isNewerBuild, type BuildInfo } from '../../../shared/build';

declare const __FRX_BUILD__: string | undefined;

/** This client's build id ('dev' under the dev server and in unit tests). */
export const BUILD: string = typeof __FRX_BUILD__ === 'string' && __FRX_BUILD__ ? __FRX_BUILD__ : 'dev';
export { BUILD_HEADER };

export type UpdatePhase =
  | 'none' // nothing to do
  | 'pending' // a newer build is deployed; waiting for an idle moment
  | 'applying' // the NOUVEAU ! burst is showing; the reload follows
  | 'stuck'; // a reload did not help (or is not allowed again yet): offer a button

export interface UpdateState {
  phase: UpdatePhase;
  serverBuild: string | null;
  reason: 'update' | 'outdated' | 'chunk' | null;
}

let state: UpdateState = { phase: 'none', serverBuild: null, reason: null };
const listeners = new Set<() => void>();

export function getUpdateState(): UpdateState {
  return state;
}
export function subscribeUpdate(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function set(next: Partial<UpdateState>): void {
  state = { ...state, ...next };
  // Visible to tests and to anyone inspecting a device: <html data-frx-update="pending">.
  if (typeof document !== 'undefined') document.documentElement.dataset.frxUpdate = state.phase;
  for (const fn of listeners) fn();
}

// ---- where the kid is ----------------------------------------------------------------------------

/** Screens where a reload loses nothing: the lists and pages a kid browses between activities. */
const IDLE_ROUTES: RegExp[] = [/^\/$/, /^\/episodes(\/[^/]+)?$/, /^\/karaoke$/, /^\/profile$/, /^\/shop$/, /^\/friends$/, /^\/league$/, /^\/achievements$/, /^\/version$/];

/** True when the path is an idle screen (a practice, chest, karaoke song, login or editor is not). */
export function isIdlePath(path: string): boolean {
  const p = path.replace(/\/+$/, '') || '/';
  return IDLE_ROUTES.some((re) => re.test(p));
}

/** Extra holds (a component that must not be interrupted can hold updates while mounted). */
let holds = 0;
export function holdUpdates(): () => void {
  holds++;
  let done = false;
  return () => {
    if (done) return;
    done = true;
    holds--;
    maybeApply();
  };
}

function idleNow(): boolean {
  return holds === 0 && typeof location !== 'undefined' && isIdlePath(location.pathname);
}

// ---- reload guard --------------------------------------------------------------------------------

const GUARD_KEY = 'frx.pwa.reload';
const GUARD_MS = 2 * 60_000;

interface Guard {
  reason: string;
  target: string;
  at: number;
}

/**
 * May the page reload for this reason and target now? False when it already reloaded for the same
 * thing within two minutes (the reload did not bring the new build: an old copy is cached somewhere).
 */
export function mayReload(reason: string, target: string, now = Date.now(), store: Storage | undefined = safeSession()): boolean {
  try {
    const raw = store?.getItem(GUARD_KEY);
    const g = raw ? (JSON.parse(raw) as Guard) : null;
    return !(g && g.reason === reason && g.target === target && now - g.at < GUARD_MS);
  } catch {
    return true;
  }
}
function markReload(reason: string, target: string): void {
  try {
    safeSession()?.setItem(GUARD_KEY, JSON.stringify({ reason, target, at: Date.now() } satisfies Guard));
  } catch {
    // no storage: the guard is best effort
  }
}
function safeSession(): Storage | undefined {
  try {
    return typeof sessionStorage !== 'undefined' ? sessionStorage : undefined;
  } catch {
    return undefined;
  }
}

/** Overridable for tests. */
export const env = {
  /** This client's build (BUILD; tests set a real id). */
  build: BUILD,
  reload: () => location.reload(),
  /** How long the NOUVEAU ! burst shows before the reload. */
  burstMs: 1100,
};

/** Reload now (or say we are stuck). */
export function reloadNow(reason: 'update' | 'outdated' | 'chunk', target = state.serverBuild ?? ''): void {
  if (!mayReload(reason, target)) {
    set({ phase: 'stuck', reason });
    return;
  }
  markReload(reason, target);
  env.reload();
}

/**
 * Reload for another reason (the client lost the school gate): true when the reload is under way,
 * false when it already happened for the same thing within two minutes (then the caller shows the error).
 */
export function reloadOnce(reason: string, target: string): boolean {
  if (!mayReload(reason, target)) return false;
  markReload(reason, target);
  env.reload();
  return true;
}

/** Click handler of the "stuck" panel: the kid asked for it, so no guard. */
export function forceReload(): void {
  env.reload();
}

// ---- noticing ------------------------------------------------------------------------------------

/** Called with the x-frx-build header of every API response (and by checkNow). */
export function noteServerBuild(server: string | null | undefined): void {
  if (!server || !isNewerBuild(server, env.build)) return;
  if (state.phase === 'applying' || state.phase === 'stuck') return;
  if (state.serverBuild !== server || state.phase === 'none') set({ phase: 'pending', serverBuild: server, reason: 'update' });
  maybeApply();
}

/** The server refused this client (409 client-outdated): reload now, whatever the screen. */
export function outdated(server?: string | null): void {
  if (state.phase === 'applying') return;
  reloadNow('outdated', server ?? state.serverBuild ?? 'min');
}

let lastCheck = 0;
const CHECK_GAP_MS = 30_000;

/** Ask the server which build is deployed (on resume and when the network comes back). */
export async function checkNow(force = false): Promise<void> {
  if (env.build === 'dev' && !force) return;
  const now = Date.now();
  if (!force && now - lastCheck < CHECK_GAP_MS) {
    maybeApply();
    return;
  }
  lastCheck = now;
  try {
    const res = await fetch('/api/build', { credentials: 'same-origin', cache: 'no-store', headers: { [BUILD_HEADER]: env.build } });
    if (res.status === 409) return outdated(res.headers.get(BUILD_HEADER));
    const info = res.ok ? ((await res.json().catch(() => null)) as BuildInfo | null) : null;
    if (info && isClientTooOld(env.build, info.minClient)) return outdated(info.build);
    noteServerBuild(res.headers.get(BUILD_HEADER));
  } catch {
    // offline: try again on the next resume
  }
}

// ---- applying ------------------------------------------------------------------------------------

let applyTimer: ReturnType<typeof setTimeout> | null = null;

/** Apply a pending update if this is a safe moment. */
export function maybeApply(): void {
  if (state.phase !== 'pending' || !idleNow()) return;
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return; // on resume
  const target = state.serverBuild ?? '';
  if (!mayReload('update', target)) {
    // We already reloaded for this build and still run the old one: leave the kid alone.
    set({ phase: 'none' });
    return;
  }
  set({ phase: 'applying' });
  applyTimer = setTimeout(() => {
    applyTimer = null;
    // The kid may have tapped into a practice during the burst: then wait again.
    if (!idleNow()) {
      set({ phase: 'pending' });
      return;
    }
    reloadNow('update', target);
  }, env.burstMs);
}

// ---- chunk-load failures -------------------------------------------------------------------------

/** True for the errors browsers give when a dynamically imported module cannot be fetched. */
export function isChunkLoadError(e: unknown): boolean {
  const msg = e instanceof Error ? `${e.name} ${e.message}` : String(e ?? '');
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS|Expected a JavaScript(-or-Wasm)? module script|ChunkLoadError/i.test(msg);
}

/** A chunk failed to load: reload once; if that already happened, show the stuck panel. */
export function chunkFailed(): boolean {
  if (!mayReload('chunk', env.build)) {
    set({ phase: 'stuck', reason: 'chunk' });
    return false;
  }
  reloadNow('chunk', env.build);
  return true;
}

// ---- wiring --------------------------------------------------------------------------------------

let installed = false;

/** Install the listeners (once, from pwa/boot.ts). */
export function installUpdateWatch(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void checkNow();
  });
  window.addEventListener('pageshow', (e) => {
    if ((e as PageTransitionEvent).persisted) void checkNow(true);
  });
  window.addEventListener('online', () => void checkNow(true));
  window.addEventListener('focus', () => void checkNow());
  // wouter navigates with pushState/replaceState and dispatches events of those names.
  for (const ev of ['popstate', 'pushState', 'replaceState']) window.addEventListener(ev, () => setTimeout(maybeApply, 0));
  // Vite wraps every dynamic import and dispatches this when the chunk (or its CSS) fails to load.
  window.addEventListener('vite:preloadError', (e) => {
    if (chunkFailed()) e.preventDefault();
  });
  window.addEventListener('unhandledrejection', (e) => {
    if (isChunkLoadError(e.reason)) chunkFailed();
  });
}

/** Tests only. */
export function resetUpdateForTests(): void {
  state = { phase: 'none', serverBuild: null, reason: null };
  holds = 0;
  lastCheck = 0;
  if (applyTimer) clearTimeout(applyTimer);
  applyTimer = null;
  listeners.clear();
}
