// The typed HTTP client: one function per endpoint of shared/api.ts. Import `api` from './index',
// not this file, so VITE_FIXTURES=1 can swap in the fixture client.
import type {
  ApiError,
  ChestOpenResponse,
  DailyResponse,
  EventsRequest,
  EventsResponse,
  FollowResponse,
  FriendsResponse,
  GiftRequest,
  GiftResponse,
  InboxResponse,
  KaraokeRemoveResponse,
  KaraokeSaveResponse,
  KaraokeTakeResponse,
  LeagueResponse,
  PracticeCompleteRequest,
  PracticeCompleteResponse,
  PracticeProgressRequest,
  PracticeProgressResponse,
  PracticeStartRequest,
  PracticeStartResponse,
  LoginRequest,
  LoginResponse,
  LogoutResponse,
  MePatchRequest,
  MePatchResponse,
  MeResponse,
  MoreResponse,
  SceneViewResponse,
  SessionRequest,
  SessionResponse,
  ShopBuyRequest,
  ShopBuyResponse,
  ShopResponse,
  SocialSearchResponse,
  SpeechQuery,
  SpeechResponse,
  UnlockResponse,
} from '../../../shared/api';
import { TAB_HEADER, type ReportRequest, type ReportResponse } from '../../../shared/activity';
import { log, TAB } from '../log';
import { BUILD, BUILD_HEADER, noteServerBuild, outdated, reloadOnce } from '../pwa/update';
import { ApiRequestError } from './errors';
import { COMPOSER_VERSION } from '../../../shared/practice/version';

export { ApiRequestError } from './errors';

/** How long any request may take before it fails as 'timeout' (speech has its own, longer limit). */
export const REQUEST_TIMEOUT_MS = 15_000;
/** POST /api/speech: the puzzle gives up after SPEECH_TIMEOUT_MS (speech/send.ts); this only frees the request. */
const SPEECH_REQUEST_TIMEOUT_MS = 30_000;
/** A karaoke take: up to 1.8 MB up on a school's Wi-Fi, then Whisper on up to a minute of audio (measured: 8 s for 54 s). */
export const KARAOKE_TAKE_TIMEOUT_MS = 45_000;

/** Called when the server no longer knows this browser's kid (401 no-session); the player store boots again. */
let onSessionLost: () => void = () => {};
export function setSessionLostHandler(fn: () => void): void {
  onSessionLost = fn;
}

export interface ApiClient {
  gate(password: string): Promise<void>;
  session(req: SessionRequest): Promise<SessionResponse>;
  login(req: LoginRequest): Promise<LoginResponse>;
  /** "New player": ends this browser's session; boot again afterwards. */
  logout(): Promise<LogoutResponse>;
  me(): Promise<MeResponse>;
  patchMe(req: MePatchRequest): Promise<MePatchResponse>;
  daily(): Promise<DailyResponse>;
  unlock(sceneId: string): Promise<UnlockResponse>;
  /** "Do more": a fresh draw of candidates and extra quests, once every quest is done. */
  more(): Promise<MoreResponse>;
  startPractice(req: PracticeStartRequest): Promise<PracticeStartResponse>;
  completePractice(practiceId: string, req: PracticeCompleteRequest): Promise<PracticeCompleteResponse>;
  practiceProgress(practiceId: string, req: PracticeProgressRequest): Promise<PracticeProgressResponse>;
  viewScene(sceneId: string): Promise<SceneViewResponse>;
  events(req: EventsRequest): Promise<EventsResponse>;
  /** opts.testTranscript: dev builds only, sent as x-test-transcript (honoured by a worker in TEST_MODE). */
  speech(query: SpeechQuery, wav: Blob, opts?: { testTranscript?: string }): Promise<SpeechResponse>;
  /** A karaoke take to check (docs/app-server.md, "Karaoke recordings"); opts.testTranscript as for speech. */
  karaokeTake(songId: string, wav: Blob, offsetMs: number, opts?: { testTranscript?: string; signal?: AbortSignal }): Promise<KaraokeTakeResponse>;
  /** The checked take becomes the song's recording. */
  karaokeSave(songId: string, takeId: string): Promise<KaraokeSaveResponse>;
  /** Drop the checked take, unsaved. */
  karaokeDrop(songId: string): Promise<void>;
  /** Remove the saved recording of the song. */
  karaokeRemove(songId: string): Promise<KaraokeRemoveResponse>;
  openChest(chestId: string): Promise<ChestOpenResponse>;
  shop(): Promise<ShopResponse>;
  buy(req: ShopBuyRequest): Promise<ShopBuyResponse>;
  search(q: string): Promise<SocialSearchResponse>;
  follow(userId: string): Promise<FollowResponse>;
  unfollow(userId: string): Promise<FollowResponse>;
  friends(): Promise<FriendsResponse>;
  gift(req: GiftRequest): Promise<GiftResponse>;
  inbox(): Promise<InboxResponse>;
  league(): Promise<LeagueResponse>;
  /** "Quelque chose ne va pas ?" (works without a session). */
  report(req: ReportRequest): Promise<ReportResponse>;
}

export interface RequestOptions extends RequestInit {
  /** Fail as 'timeout' after this long (default REQUEST_TIMEOUT_MS). */
  timeoutMs?: number;
}

/** A request the caller abandoned (RequestOptions.signal): not a failure, never logged. */
export class RequestAbandoned extends Error {
  constructor() {
    super('abandoned');
    this.name = 'RequestAbandoned';
  }
}

/**
 * One request. Every failure becomes an ApiRequestError (api/errors.ts) naming the request; two are
 * handled here for every caller, and their promise never settles: 409 client-outdated reloads into
 * the new build, 401 gate reloads so the gate page shows. 401 no-session also boots the app again.
 */
export async function request<T>(method: string, path: string, body?: unknown, init: RequestOptions = {}): Promise<T> {
  const { timeoutMs = REQUEST_TIMEOUT_MS, signal: callerSignal, ...rest } = init;
  const where = { method, path };
  const t0 = performance.now();
  // Every failed call goes to the activity log (web/src/log).
  const failed = (e: ApiRequestError): ApiRequestError => {
    log('api-fail', { kind: e.kind, code: e.code, status: e.status, method, path: path.slice(0, 200), ms: Math.round(performance.now() - t0), ...(e.kind === 'server' || e.kind === 'offline' ? { message: e.message.slice(0, 200) } : {}) });
    return e;
  };
  const abort = new AbortController();
  // The caller may abandon the request (karaoke: the kid throws their singing away while it is checked).
  if (callerSignal?.aborted) throw new RequestAbandoned();
  callerSignal?.addEventListener('abort', () => abort.abort(), { once: true });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    abort.abort();
  }, timeoutMs);
  let res: Response;
  let text: string;
  try {
    try {
      // Every call says which build this page runs (the server refuses builds that are too old).
      const headers: Record<string, string> = { [BUILD_HEADER]: BUILD, [TAB_HEADER]: TAB, ...(body !== undefined && !(body instanceof Blob) ? { 'content-type': 'application/json' } : {}), ...(rest.headers as Record<string, string> | undefined) };
      res = await fetch(path, {
        method,
        credentials: 'same-origin',
        body: body === undefined ? undefined : body instanceof Blob ? body : JSON.stringify(body),
        ...rest,
        headers,
        signal: abort.signal,
      });
      // A newer build is deployed: the update module switches at the next idle moment (pwa/update.ts).
      noteServerBuild(res.headers.get(BUILD_HEADER));
      text = res.status === 204 ? '' : await res.text();
    } catch (e) {
      if (callerSignal?.aborted) throw new RequestAbandoned();
      if (timedOut) throw failed(new ApiRequestError(0, 'timeout', `no answer in ${timeoutMs} ms`, undefined, where));
      throw failed(new ApiRequestError(0, 'offline', e instanceof Error ? e.message : String(e), undefined, where));
    }
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 204) return undefined as T;
  let data: unknown = undefined;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    // An HTML page (gate page, SPA fallback, a proxy's error page) where JSON was expected.
  }
  if (!res.ok) {
    const err = (data && typeof data === 'object' ? data : {}) as Partial<ApiError>;
    if (res.status === 409 && err.error === 'client-outdated') {
      failed(new ApiRequestError(res.status, 'client-outdated', undefined, undefined, where));
      // Always handled the same way: reload into the new build. The promise never settles, so no
      // caller treats it as a failure (progress is saved after every puzzle; the practice resumes).
      outdated(res.headers.get(BUILD_HEADER));
      return new Promise<T>(() => {});
    }
    const code = err.error ?? (res.status === 401 ? 'no-session' : res.status === 404 ? 'not-found' : res.status >= 500 ? 'internal' : 'bad-request');
    const failure = failed(new ApiRequestError(res.status, code, err.message ?? (data === undefined && text ? `not JSON (${res.headers.get('content-type') ?? '?'})` : undefined), err.retryAfterS, where));
    // The school password cookie is gone: the reload shows the gate page, then this screen again.
    if (failure.kind === 'gate' && reloadOnce('gate', BUILD)) return new Promise<T>(() => {});
    if (failure.kind === 'session') onSessionLost();
    throw failure;
  }
  if (data === undefined) throw failed(new ApiRequestError(res.status, 'internal', `not JSON (${res.headers.get('content-type') ?? '?'})`, undefined, where));
  return data as T;
}

const enc = encodeURIComponent;

export const httpClient: ApiClient = {
  gate: (password) => request('POST', '/gate', { password }),
  session: (req) => request('POST', '/api/session', req),
  login: (req) => request('POST', '/api/login', req),
  logout: () => request('POST', '/api/logout', {}),
  me: () => request('GET', '/api/me'),
  patchMe: (req) => request('PATCH', '/api/me', req),
  daily: () => request('GET', '/api/daily'),
  unlock: (sceneId) => request('POST', '/api/daily/unlock', { sceneId }),
  more: () => request('POST', '/api/daily/more', {}),
  // Every start carries the version of the practice composer; the server stores it with a new practice.
  startPractice: (req) => request('POST', '/api/practices/start', { composerVersion: COMPOSER_VERSION, ...req }),
  completePractice: (id, req) => request('POST', `/api/practices/${enc(id)}/complete`, req),
  practiceProgress: (id, req) => request('POST', `/api/practices/${enc(id)}/progress`, req),
  viewScene: (id) => request('POST', `/api/scenes/${enc(id)}/view`, {}),
  events: (req) => request('POST', '/api/events', req),
  speech: (q, wav, opts) => {
    const params = new URLSearchParams({ scene: q.scene });
    if (q.line) params.set('line', q.line);
    else if (q.unit) params.set('unit', q.unit);
    else if (q.alt) params.set('alt', q.alt);
    else if (q.choice) params.set('choice', q.choice);
    if (q.hint) params.set('hint', q.hint);
    if (q.attempt) params.set('attempt', String(q.attempt));
    if (q.type) params.set('type', q.type);
    if (q.debug) params.set('debug', '1');
    const headers: Record<string, string> = { 'content-type': 'audio/wav' };
    if (import.meta.env.DEV && opts?.testTranscript !== undefined) headers['x-test-transcript'] = encodeURIComponent(opts.testTranscript);
    return request('POST', `/api/speech?${params}`, wav, { headers, timeoutMs: SPEECH_REQUEST_TIMEOUT_MS });
  },
  karaokeTake: (songId, wav, offsetMs, opts) => {
    const headers: Record<string, string> = { 'content-type': 'audio/wav' };
    if (import.meta.env.DEV && opts?.testTranscript !== undefined) headers['x-test-transcript'] = encodeURIComponent(opts.testTranscript);
    return request('POST', `/api/karaoke/${enc(songId)}/take?offset=${Math.max(0, Math.round(offsetMs))}`, wav, { headers, timeoutMs: KARAOKE_TAKE_TIMEOUT_MS, ...(opts?.signal ? { signal: opts.signal } : {}) });
  },
  karaokeSave: (songId, takeId) => request('POST', `/api/karaoke/${enc(songId)}/save`, { takeId }),
  karaokeDrop: (songId) => request('DELETE', `/api/karaoke/${enc(songId)}/take`),
  karaokeRemove: (songId) => request('DELETE', `/api/karaoke/${enc(songId)}/recording`),
  openChest: (id) => request('POST', `/api/chests/${enc(id)}/open`, {}),
  shop: () => request('GET', '/api/shop'),
  buy: (req) => request('POST', '/api/shop/buy', req),
  search: (q) => request('GET', `/api/social/search?q=${enc(q)}`),
  follow: (userId) => request('POST', '/api/social/follow', { userId }),
  unfollow: (userId) => request('DELETE', '/api/social/follow', { userId }),
  friends: () => request('GET', '/api/social/friends'),
  gift: (req) => request('POST', '/api/social/gift', req),
  inbox: () => request('GET', '/api/social/inbox'),
  league: () => request('GET', '/api/league'),
  report: (req) => request('POST', '/api/reports', req),
};
