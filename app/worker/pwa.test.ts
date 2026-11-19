import { beforeEach, describe, expect, it } from 'vitest';
import { MIN_CLIENT_BUILD } from '../shared/build';
import { APP_PUBLIC_FILES } from './pwa';
import { Browser, freshWorld } from './testing';

beforeEach(freshWorld);

const OLD = '20260101T000000Z-aaaaaaa';
const NEW = '20261201T120000Z-bbbbbbb';

describe('install files before the gate', () => {
  it('serves exactly the allow-listed install files without the cookie', async () => {
    const b = new Browser();
    expect([...APP_PUBLIC_FILES.keys()].sort()).toEqual(
      ['/apple-touch-icon.png', '/favicon.ico', '/favicon.svg', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/maskable-192.png', '/icons/maskable-512.png', '/manifest.webmanifest'].sort(),
    );
    for (const [path, type] of APP_PUBLIC_FILES) {
      const res = await b.fetch('GET', path);
      // 200 when the client is built (dist/); 404 otherwise. Never the gate, never index.html.
      expect(res.status, path).not.toBe(401);
      expect([200, 404], path).toContain(res.status);
      if (res.status === 200) {
        expect(res.headers.get('content-type'), path).toBe(type);
        expect(res.headers.get('cache-control'), path).toMatch(path.endsWith('.webmanifest') ? /no-cache/ : /max-age/);
      } else expect(res.headers.get('content-type') ?? '', path).not.toContain('text/html');
    }
  });

  it('keeps everything else closed', async () => {
    const b = new Browser();
    for (const path of ['/icons/', '/icons/other.png', '/icons/icon-192.png.map', '/manifest.json', '/build.json', '/favicon.svg/../data/index.json', '/icons/%2e%2e/data/index.json', '/index.html', '/api/build', '/apple-touch-icon-precomposed.png']) {
      const res = await b.fetch('GET', path);
      expect(res.status, path).toBe(401);
    }
    expect((await b.fetch('POST', '/manifest.webmanifest')).status).toBe(401);
  });
});

describe('build id and updates', () => {
  it('stamps the deployed build on every response, gate page included', async () => {
    const b = new Browser();
    const gate = await b.fetch('GET', '/', undefined, { 'sec-fetch-mode': 'navigate' });
    expect(gate.headers.get('x-frx-build')).toBeTruthy();
    await b.start();
    const me = await b.fetch('GET', '/api/me');
    expect(me.headers.get('x-frx-build')).toBeTruthy();
    const over = await b.fetch('GET', '/api/me', undefined, { 'x-test-build': NEW });
    expect(over.headers.get('x-frx-build')).toBe(NEW);
  });

  it('answers GET /api/build behind the gate, without a session', async () => {
    const b = new Browser();
    expect((await b.json('GET', '/api/build')).status).toBe(401);
    await b.enter();
    const r = await b.fetch('GET', '/api/build', undefined, { 'x-test-build': NEW });
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    const body = (await r.json()) as { build: string; minClient: string; content: string | null };
    expect(body.build).toBe(NEW);
    expect(body.content).toBe('fixture');
  });

  it('refuses API calls from a client older than the minimum with 409 client-outdated', async () => {
    const b = new Browser();
    await b.start();
    const min = { 'x-test-min-build': '20260601T000000Z' };
    const old = await b.json('GET', '/api/me', undefined, { ...min, 'x-frx-build': OLD });
    expect(old.status).toBe(409);
    expect(old.body.error).toBe('client-outdated');
    // A newer client, a client that sends no build, and a dev build are let through.
    expect((await b.json('GET', '/api/me', undefined, { ...min, 'x-frx-build': NEW })).status).toBe(200);
    expect((await b.json('GET', '/api/me', undefined, min)).status).toBe(200);
    expect((await b.json('GET', '/api/me', undefined, { ...min, 'x-frx-build': 'dev' })).status).toBe(200);
    // The session endpoint too (the rule is for every API call), but not /api/build.
    expect((await b.json('POST', '/api/session', { timeZone: 'America/Toronto' }, { ...min, 'x-frx-build': OLD })).status).toBe(409);
    expect((await b.json('GET', '/api/build', undefined, { ...min, 'x-frx-build': OLD })).status).toBe(200);
    // Without the test header the minimum is MIN_CLIENT_BUILD (release 2.3's: older pages must reload).
    expect((await b.json('GET', '/api/me', undefined, { 'x-frx-build': OLD })).status).toBe(MIN_CLIENT_BUILD ? 409 : 200);
    expect((await b.json('GET', '/api/me', undefined, { 'x-frx-build': NEW })).status).toBe(200);
  });
});

describe('cache headers across versions', () => {
  it('caches ?v= data and media for a year only under the deployed content version', async () => {
    const b = new Browser();
    await b.enter();
    const stale = await b.fetch('GET', '/data/index.json?v=some-old-version');
    expect(stale.headers.get('cache-control')).toBe('no-store');
    const media = await b.fetch('GET', '/media/a/s01e04-0016-0017.m4a?v=some-old-version');
    expect(media.headers.get('cache-control')).toBe('no-store');
    const current = await b.fetch('GET', '/data/index.json?v=fixture');
    // The fixture version is the deployed one in tests; the file exists only when the client is built.
    if (current.status === 200) expect(current.headers.get('cache-control')).toContain('immutable');
    else expect(current.headers.get('cache-control')).toBe('no-store');
  });

  it('answers a missing hashed chunk with 404, not the app shell', async () => {
    const b = new Browser();
    await b.enter();
    const res = await b.fetch('GET', '/assets/Home-gone1234.js');
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type') ?? '').not.toContain('text/html');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});
