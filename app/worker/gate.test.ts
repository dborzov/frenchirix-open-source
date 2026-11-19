import { beforeEach, describe, expect, it } from 'vitest';
import { GATE_FAIL_LIMIT } from './gate';
import { Browser, db, freshWorld, GATE_PASSWORD } from './testing';

beforeEach(freshWorld);

describe('gate', () => {
  it('shows the gate page to a navigation and 401 to anything else', async () => {
    const b = new Browser();
    const page = await b.fetch('GET', '/', undefined, { 'sec-fetch-mode': 'navigate', accept: 'text/html', 'accept-language': 'fr-CA,fr;q=0.9' });
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('<form method="post" action="/gate"');
    expect(html).toMatch(/<input name="password"[^>]*autocapitalize="characters"[^>]*autocomplete="off"|<input name="password"[^>]*autocomplete="off"/);
    expect(html).toContain('<button type="submit"');
    // In English, like a new account (docs/intent.md, "Language"), whatever the browser asks for.
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('The magic word');
    expect(html.match(/<button/g)).toHaveLength(1);
    // Nothing gives the password or its length away.
    expect(html.toLowerCase()).not.toContain(GATE_PASSWORD.toLowerCase());
    expect(html).not.toMatch(/maxlength|minlength|pattern=/);
    // Only allow-listed assets: no app scripts, no /assets, /data or /media.
    expect(html).not.toMatch(/src="\/(assets|data|media)\//);
    expect(html).toContain('/gate/cover.webp');
    const api = await b.json('GET', '/api/me');
    expect(api.status).toBe(401);
    expect(api.body).toEqual({ error: 'gate' });
    const data = await b.fetch('GET', '/data/index.json');
    expect(data.status).toBe(401);
  });

  it('accepts the password in any case, sets a signed cookie', async () => {
    const b = new Browser();
    const bad = await b.json('POST', '/gate', { password: 'rome' });
    expect(bad.status).toBe(401);
    expect(bad.body.error).toBe('bad-password');
    const res = await b.fetch('POST', '/gate', { password: ` ${GATE_PASSWORD[0]!.toUpperCase()}${GATE_PASSWORD.slice(1)} ` });
    expect(res.status).toBe(204);
    const cookie = res.headers.get('set-cookie')!;
    expect(cookie).toMatch(/fx_gate=v1\./);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).not.toContain('Secure'); // http in tests
    expect((await b.json('POST', '/api/session', { timeZone: 'Europe/Paris' })).status).toBe(200);
  });

  it('rejects a forged cookie', async () => {
    const b = new Browser();
    b.cookies.set('fx_gate', 'v1.123.forged');
    expect((await b.json('GET', '/api/me')).body.error).toBe('gate');
  });

  it('works as a plain form, redirecting back, and answers a wrong password with a retry page', async () => {
    const b = new Browser();
    const form = (pw: string) =>
      b.fetch('POST', '/gate', `password=${pw}&next=%2Fepisodes`, { 'content-type': 'application/x-www-form-urlencoded' });
    const wrong = await form('nope');
    expect(wrong.status).toBe(401);
    expect(await wrong.text()).toContain('No, no and no!');
    const ok = await form(GATE_PASSWORD.toUpperCase());
    expect(ok.status).toBe(303);
    expect(ok.headers.get('location')).toBe('/episodes');
  });

  it('rate-limits wrong passwords per address, high enough for a classroom behind one address', async () => {
    const b = new Browser();
    // A classroom's typos: well past the old limit of 10, the right word still opens.
    for (let i = 0; i < 25; i++) expect((await b.json('POST', '/gate', { password: 'x' })).status).toBe(401);
    expect((await b.fetch('POST', '/gate', { password: GATE_PASSWORD })).status).toBe(204);
    // The rest of the limit, written directly.
    const now = Date.parse(b.now);
    await db().batch(Array.from({ length: GATE_FAIL_LIMIT - 25 }, () => db().prepare('INSERT INTO login_attempts (key, at) VALUES (?, ?)').bind(`g:${b.ip}`, now)));
    const r = await b.json('POST', '/gate', { password: GATE_PASSWORD });
    expect(r.status).toBe(429);
    expect(r.body.retryAfterS).toBeGreaterThan(0);
    const other = new Browser();
    other.ip = '10.0.0.2';
    expect((await other.fetch('POST', '/gate', { password: GATE_PASSWORD })).status).toBe(204);
  });

  it('never redirects off-site', async () => {
    const b = new Browser();
    const ok = await b.fetch('POST', '/gate', `password=${GATE_PASSWORD}&next=%2F%2Fevil.example`, { 'content-type': 'application/x-www-form-urlencoded' });
    expect(ok.headers.get('location')).toBe('/');
  });

  it('serves only the allow-listed gate files without the cookie', async () => {
    const b = new Browser();
    for (const path of ['/gate/cover.webp', '/gate/bangers.woff2', '/gate/comic-neue-700.woff2']) {
      const res = await b.fetch('GET', path);
      // 200 when the client is built (dist/); 404 otherwise. Never the gate.
      expect(res.status, path).not.toBe(401);
      expect([200, 404], path).toContain(res.status);
      if (res.status === 200) expect(res.headers.get('cache-control')).toContain('max-age');
    }
    for (const path of ['/data/index.json', '/media/a/s01e04-0016-0017.m4a', '/api/me', '/gate/', '/gate/x.webp', '/gate/cover.webp/../../data/index.json', '/gate/%2e%2e/data/index.json', '/assets/index.js', '/gate/cover.webp.map']) {
      const res = await b.fetch('GET', path);
      expect(res.status, path).toBe(401);
    }
    expect((await b.fetch('POST', '/gate/cover.webp')).status).toBe(401);
  });
});
