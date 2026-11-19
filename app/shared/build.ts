// Build identity and the client compatibility rule, shared by the client and the Worker.
//
// A build id is `<UTC time>-<commit>`, e.g. `20261114T153000Z-2930ad2` (or `...-2930ad2+` when the
// tree had uncommitted changes). Vite writes it into the client (`__FRX_BUILD__`) and into
// `dist/build.json`, which the Worker reads, so a deploy's client and Worker always agree.
// Builds are ordered by their time. Anything else (`dev`, empty, malformed) is not comparable and
// never triggers an update or a refusal.

/** Header the client sends on API calls and the Worker sends on every response. */
export const BUILD_HEADER = 'x-frx-build';

/**
 * Clients built before this instant can no longer talk to the server: every API call answers
 * `409 client-outdated` and the client reloads at once. Raise it (to the build time of the release
 * that breaks compatibility, or simply to the time of the deploy) only when an API change would break
 * a running old client; leave it alone otherwise. Format: `YYYYMMDDTHHMMSSZ`, or '' for no minimum.
 */
export const MIN_CLIENT_BUILD = '20261115T055000Z'; // release 2.3: daily quests replaced stops and sittings (the API changed); 2.2 pages must reload. 2.4 and 2.5 kept it: their API changes only add

const BUILD_RE = /^(\d{8}T\d{6}Z)-[0-9a-f]{4,40}\+?$/;

/** The time part of a build id, or null when the id is not a real build. */
export function buildTime(id: string | null | undefined): string | null {
  if (!id) return null;
  const m = BUILD_RE.exec(id);
  return m ? m[1]! : null;
}

/** A build id for a time and commit. */
export function makeBuildId(date: Date, commit: string, dirty = false): string {
  const t = date.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  return `${t}-${commit || '0000000'}${dirty ? '+' : ''}`;
}

/** True when `server` is a later build than `client` (both real builds). */
export function isNewerBuild(server: string | null | undefined, client: string | null | undefined): boolean {
  const s = buildTime(server);
  const c = buildTime(client);
  return s !== null && c !== null && s > c;
}

/**
 * True when a client of this build must reload before talking to the server: it is a real build
 * whose time is before `min`. A client that sends no build (curl, a page from before builds were
 * stamped) or a dev build is let through.
 */
export function isClientTooOld(client: string | null | undefined, min: string = MIN_CLIENT_BUILD): boolean {
  const c = buildTime(client);
  if (c === null || !min) return false;
  const m = /^\d{8}T\d{6}Z$/.test(min) ? min : buildTime(min);
  return m !== null && c < m;
}

/** What GET /api/build answers. */
export interface BuildInfo {
  build: string; // the deployed build id ('dev' when not built)
  minClient: string; // MIN_CLIENT_BUILD in force
  content: string | null; // ContentIndex.version of the deployed bundle
}
