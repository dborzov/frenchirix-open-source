import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN_PASSWORD, Browser, freshWorld, GATE_PASSWORD } from './testing';

beforeEach(freshWorld);
afterEach(() => {
  delete (env as { LOCAL_DEV?: string }).LOCAL_DEV;
});

const nav = { 'sec-fetch-mode': 'navigate', accept: 'text/html' };

describe('/dev in production', () => {
  it('asks for the admin password once per browser; the admin cookie also opens the school gate', async () => {
    const b = new Browser();
    const page = await b.fetch('GET', '/dev/speaking', undefined, nav);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('action="/dev/login"');
    expect(html).toContain('value="/dev/speaking"');
    expect((await b.fetch('GET', '/dev', undefined, {})).status).toBe(401);
    const wrong = await b.fetch('POST', '/dev/login', `password=${GATE_PASSWORD}&next=%2Fdev%2Fspeaking`, { 'content-type': 'application/x-www-form-urlencoded' });
    expect(wrong.status).toBe(401);
    expect(await wrong.text()).toContain('OUPS');
    const ok = await b.fetch('POST', '/dev/login', `password=${ADMIN_PASSWORD}&next=%2Fdev%2Fspeaking`, { 'content-type': 'application/x-www-form-urlencoded' });
    expect(ok.status).toBe(303);
    expect(ok.headers.get('location')).toBe('/dev/speaking');
    const cookie = ok.headers.get('set-cookie')!;
    expect(cookie).toMatch(/fx_admin=v1\./);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain(`Max-Age=${400 * 86400}`);
    // Remembered: no sign-in page any more, and no school password needed either.
    expect(await (await b.fetch('GET', '/dev/speaking', undefined, nav)).text()).not.toContain('/dev/login');
    expect((await b.json('POST', '/api/session', { timeZone: 'UTC' })).status).toBe(200);
  });

  it('the school gate alone does not open /dev; a forged admin cookie does nothing', async () => {
    const b = new Browser();
    await b.enter();
    expect(await (await b.fetch('GET', '/dev', undefined, nav)).text()).toContain('/dev/login');
    b.cookies.set('fx_admin', 'v1.1.forged');
    expect(await (await b.fetch('GET', '/dev', undefined, nav)).text()).toContain('/dev/login');
  });

  it('rate-limits wrong admin passwords and never redirects outside /dev', async () => {
    const b = new Browser();
    for (let i = 0; i < 10; i++) expect((await b.json('POST', '/dev/login', { password: 'x' })).status).toBe(401);
    expect((await b.json('POST', '/dev/login', { password: ADMIN_PASSWORD })).status).toBe(429);
    const c = new Browser();
    c.ip = '10.9.9.9';
    const r = await c.fetch('POST', '/dev/login', `password=${ADMIN_PASSWORD}&next=%2Fprofile`, { 'content-type': 'application/x-www-form-urlencoded' });
    expect(r.headers.get('location')).toBe('/dev');
  });
});

describe('local development', () => {
  it('with LOCAL_DEV unset the gate holds (the production setting)', async () => {
    expect((env as { LOCAL_DEV?: string }).LOCAL_DEV).toBeFalsy();
    const b = new Browser();
    expect((await b.json('POST', '/api/session', { timeZone: 'UTC' })).body).toEqual({ error: 'gate' });
  });

  it('with LOCAL_DEV, localhost needs no password at all; another host still does', async () => {
    (env as { LOCAL_DEV?: string }).LOCAL_DEV = '1';
    const b = new Browser();
    b.origin = 'http://localhost:8787';
    expect((await b.json('POST', '/api/session', { timeZone: 'UTC' })).status).toBe(200);
    expect(await (await b.fetch('GET', '/dev/speaking', undefined, nav)).text()).not.toContain('/dev/login');
    const remote = new Browser();
    expect((await remote.json('POST', '/api/session', { timeZone: 'UTC' })).body).toEqual({ error: 'gate' });
  });
});
