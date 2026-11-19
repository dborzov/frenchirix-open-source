// One way to fail a request (docs/app-architecture.md, "Errors"). Every failed call is an
// ApiRequestError with a small set of kinds, each with one plain message for the kid (both languages,
// shared/i18n) and one copyable line for the admin:
//   FRX-ERR server 500 POST /api/practices/p_x/progress code=internal build=20261114T… at=2026-11-14T20:31:05Z
// What a screen does with each kind is in state/recover.ts.
import type { ApiErrorCode } from '../../../shared/api';
import { isTKey, t, type TKey } from '../../../shared/i18n';
import { MediaLoadError } from '../media/fetchMedia';
import { BUILD } from '../pwa/update';

/**
 * - offline: the request never got an answer (fetch threw);
 * - timeout: no answer within the request's time limit;
 * - server: a 5xx, or an answer that is not the JSON the app expected;
 * - session: 401 no-session (the browser lost its kid);
 * - gate: 401 gate (the school password cookie is gone);
 * - outdated: 409 client-outdated (handled by reloading; callers never see it);
 * - stale: the screen showed something the server no longer agrees with (a practice finished elsewhere,
 *   a scene already chosen, an item already bought…);
 * - client: any other refusal (a taken name, a wrong PIN, too many tries…), with its own message.
 */
export type ErrorKind = 'offline' | 'timeout' | 'server' | 'session' | 'gate' | 'outdated' | 'stale' | 'client';

/** A code only the client produces. */
export type ClientErrorCode = 'offline' | 'timeout';

/** Answers that mean "what you see is out of date": refresh the state, show the fresh screen. */
export const STALE_CODES: ReadonlySet<string> = new Set<ApiErrorCode>([
  'practice-closed',
  'not-found',
  'already-unlocked',
  'no-unlocks-left',
  'not-offered',
  'choose-locked',
  'more-unavailable',
  'scene-locked',
  'not-enough-sesterces',
  'already-owned',
  'not-owned',
  'potions-full',
]);

export function errorKind(status: number, code: string): ErrorKind {
  if (code === 'offline') return 'offline';
  if (code === 'timeout') return 'timeout';
  if (status === 409 && code === 'client-outdated') return 'outdated';
  if (code === 'gate') return 'gate';
  if (code === 'no-session') return 'session'; // a 401 like a wrong PIN (bad-credentials) is a plain refusal
  if (status >= 500 || status === 0 || code === 'internal') return 'server';
  if (STALE_CODES.has(code)) return 'stale';
  return 'client';
}

/** A failed call: `code` is the server's ApiErrorCode, or one of the client's own ('offline', 'timeout'). */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode | ClientErrorCode;
  readonly retryAfterS?: number;
  readonly kind: ErrorKind;
  /** The request, for the admin's detail line. */
  readonly method: string;
  readonly path: string;
  readonly at: number;
  constructor(status: number, code: ApiErrorCode | ClientErrorCode, message?: string, retryAfterS?: number, where?: { method?: string; path?: string }) {
    super(message ?? code);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
    this.retryAfterS = retryAfterS;
    this.kind = errorKind(status, code);
    this.method = where?.method ?? '';
    this.path = where?.path ?? '';
    this.at = Date.now();
  }
}

/**
 * The kind of any error: a crash in the code is 'server'-like for the kid, but has its own detail. A
 * media file that did not load (media/fetchMedia.ts) is a timeout, offline, or 'server' (an HTTP error
 * or a file that cannot be decoded).
 */
export function kindOf(e: unknown): ErrorKind | 'crash' {
  if (e instanceof ApiRequestError) return e.kind;
  if (e instanceof MediaLoadError) return e.reason === 'timeout' ? 'timeout' : e.reason === 'offline' ? 'offline' : 'server';
  return 'crash';
}

const oneLine = (s: string, max: number) => s.replace(/\s+/g, ' ').trim().slice(0, max);
const isoSeconds = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

/**
 * The one-line detail for the admin. `where` names the screen for an error that is not a request
 * (a crash caught by an error boundary).
 */
export function errorDetail(e: unknown, where?: string): string {
  if (e instanceof MediaLoadError) {
    // FRX-ERR media timeout 0 GET /media/a/s01e01-0067-0071.m4a?v=… msg="no data for 25 s" build=… at=…
    return `FRX-ERR media ${e.reason} ${e.status} GET ${oneLine(e.src, 160)} msg="${oneLine(e.message, 80)}" build=${BUILD} at=${isoSeconds(e.at)}`;
  }
  if (e instanceof ApiRequestError) {
    const code = e.code !== e.kind ? ` code=${e.code}` : '';
    const msg = e.kind === 'offline' || e.kind === 'server' ? (e.message && e.message !== e.code ? ` msg="${oneLine(e.message, 80)}"` : '') : '';
    return `FRX-ERR ${e.kind} ${e.status} ${e.method || '?'} ${oneLine(e.path, 160) || '?'}${code}${msg} build=${BUILD} at=${isoSeconds(e.at)}`;
  }
  const err = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  const path = where ?? (typeof location !== 'undefined' ? location.pathname : '?');
  return `FRX-ERR crash ${oneLine(path, 160)} "${oneLine(err, 160)}" build=${BUILD} at=${isoSeconds(Date.now())}`;
}

/**
 * The plain message for the kid. A refusal with a message of its own (a taken name, "already
 * chosen", too many tries) keeps it; everything else says what kind of trouble it is.
 */
export function errorMessage(e: unknown): string {
  if (e instanceof MediaLoadError) return t(e.reason === 'timeout' ? 'common.fail.timeout' : e.reason === 'offline' ? 'common.fail.offline' : 'common.fail.media');
  if (!(e instanceof ApiRequestError)) return t('common.fail.crash');
  if (e.kind === 'client' || e.kind === 'stale') {
    const own = `common.error.${e.code}`;
    if (isTKey(own)) return e.kind === 'stale' ? `${t(own)} ${t('common.fail.updated')}` : t(own);
    return t(e.kind === 'stale' ? 'common.fail.stale' : 'common.fail.client');
  }
  return t(`common.fail.${e.kind}` as TKey);
}
