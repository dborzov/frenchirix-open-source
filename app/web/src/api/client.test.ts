// One way to fail a request (api/client.ts, api/errors.ts): the timeout, the kinds, the kid's message
// and the admin's detail line.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLanguage, translate } from '../../../shared/i18n';
import { env as updateEnv, resetUpdateForTests } from '../pwa/update';
import { request, setSessionLostHandler } from './client';
import { ApiRequestError, errorDetail, errorKind, errorMessage } from './errors';

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

async function failure(p: Promise<unknown>): Promise<ApiRequestError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ApiRequestError);
    return e as ApiRequestError;
  }
  throw new Error('expected a failure');
}

/** True when the promise is still pending after the microtasks run. */
async function pending(p: Promise<unknown>): Promise<boolean> {
  let settled = false;
  p.then(() => (settled = true), () => (settled = true));
  for (let i = 0; i < 5; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
  return !settled;
}

describe('a failed request', () => {
  const reload = vi.fn();
  const realReload = updateEnv.reload;
  beforeEach(() => {
    sessionStorage.clear();
    resetUpdateForTests();
    reload.mockReset();
    updateEnv.reload = reload;
    setLanguage('fr');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    updateEnv.reload = realReload;
    setSessionLostHandler(() => {});
  });

  it('times out: no answer within the limit is a timeout, and the request is aborted', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => {
      signal = init.signal ?? undefined;
      return new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
    }));
    const p = failure(request('POST', '/api/practices/p1/progress', { done: 1 }, { timeoutMs: 1000 }));
    await vi.advanceTimersByTimeAsync(999);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const e = await p;
    expect(signal?.aborted).toBe(true);
    expect(e).toMatchObject({ kind: 'timeout', code: 'timeout', status: 0, method: 'POST', path: '/api/practices/p1/progress' });
    expect(errorMessage(e)).toMatch(/trop de temps/);
  });

  it('has a default time limit on every request', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_u: string, init: RequestInit) => new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted'))))));
    const p = failure(request('GET', '/api/me'));
    await vi.advanceTimersByTimeAsync(15_000);
    expect((await p).kind).toBe('timeout');
  });

  it('offline: fetch threw', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }));
    const e = await failure(request('GET', '/api/shop'));
    expect(e).toMatchObject({ kind: 'offline', code: 'offline', status: 0 });
    expect(errorMessage(e)).toMatch(/internet/);
  });

  it('server: a 5xx, or an answer that is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(500, { error: 'internal', message: 'D1 hiccup' })));
    const e = await failure(request('POST', '/api/practices/p_9/progress', {}));
    expect(e).toMatchObject({ kind: 'server', status: 500, code: 'internal' });
    expect(errorMessage(e)).toMatch(/trébuché/);
    expect(errorDetail(e)).toMatch(/^FRX-ERR server 500 POST \/api\/practices\/p_9\/progress code=internal msg="D1 hiccup" build=dev at=\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);

    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>gate</html>', { status: 200, headers: { 'content-type': 'text/html' } })));
    const html = await failure(request('GET', '/api/daily'));
    expect(html.kind).toBe('server');
    expect(errorDetail(html)).toContain('not JSON (text/html)');

    vi.stubGlobal('fetch', vi.fn(async () => new Response('Bad gateway', { status: 502 })));
    expect((await failure(request('GET', '/api/daily'))).kind).toBe('server');
  });

  it('stale view: the screen showed something the server no longer agrees with', async () => {
    for (const [status, code] of [[409, 'practice-closed'], [404, 'not-found'], [400, 'already-unlocked'], [400, 'no-unlocks-left'], [409, 'not-enough-sesterces'], [409, 'already-owned']] as const) {
      vi.stubGlobal('fetch', vi.fn(async () => json(status, { error: code })));
      const e = await failure(request('POST', '/api/x', {}));
      expect(e.kind, code).toBe('stale');
    }
    expect(errorMessage(new ApiRequestError(409, 'already-owned'))).toBe('Tu l’as déjà\u00a0! L’écran est à jour.');
  });

  it('other refusals keep their own message; a wrong PIN is not a lost session', async () => {
    const lost = vi.fn();
    setSessionLostHandler(lost);
    vi.stubGlobal('fetch', vi.fn(async () => json(401, { error: 'bad-credentials' })));
    const e = await failure(request('POST', '/api/login', {}));
    expect(e.kind).toBe('client');
    expect(errorMessage(e)).toBe(translate('fr', 'common.error.bad-credentials'));
    vi.stubGlobal('fetch', vi.fn(async () => json(409, { error: 'name-taken' })));
    expect(errorMessage(await failure(request('PATCH', '/api/me', {})))).toBe('Ce nom est déjà pris.');
    expect(lost).not.toHaveBeenCalled();
  });

  it('session lost: 401 no-session fails and tells the player store to boot again', async () => {
    const lost = vi.fn();
    setSessionLostHandler(lost);
    vi.stubGlobal('fetch', vi.fn(async () => json(401, { error: 'no-session' })));
    const e = await failure(request('GET', '/api/me'));
    expect(e.kind).toBe('session');
    expect(lost).toHaveBeenCalledTimes(1);
  });

  it('gate lost: reloads (the gate page shows) and never settles; a second time within two minutes it fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(401, { error: 'gate' })));
    expect(await pending(request('GET', '/api/me'))).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    const e = await failure(request('GET', '/api/me'));
    expect(e.kind).toBe('gate');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('outdated: 409 client-outdated reloads into the new build and never settles', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(409, { error: 'client-outdated' })));
    expect(await pending(request('POST', '/api/practices/p1/complete', {}))).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('a 204 and a JSON answer go through', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })));
    expect(await request('POST', '/api/logout', {})).toBeUndefined();
    vi.stubGlobal('fetch', vi.fn(async () => json(200, { ok: true })));
    expect(await request('GET', '/api/health')).toEqual({ ok: true });
  });

  it('kinds by status and code, and a crash outside any request', () => {
    expect(errorKind(503, 'speech-unavailable')).toBe('server');
    expect(errorKind(400, 'bad-request')).toBe('client');
    expect(errorKind(429, 'rate-limited')).toBe('client');
    const crash = new TypeError('x is undefined');
    expect(errorMessage(crash)).toMatch(/cassé/);
    expect(errorDetail(crash, '/shop')).toMatch(/^FRX-ERR crash \/shop "TypeError: x is undefined" build=dev at=/);
    setLanguage('en');
    expect(errorMessage(new ApiRequestError(0, 'offline'))).toMatch(/No internet/);
  });
});
