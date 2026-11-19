import { beforeEach, describe, expect, it } from 'vitest';
import { checkName } from '../shared/catalog/badwords';
import { DAILY_CANDIDATES } from '../shared/rules';
import { LOGIN_FAILS_PER_ADDRESS } from './session';
import { Browser, db, freshWorld, playPractice, unlockSome } from './testing';

beforeEach(freshWorld);

describe('session', () => {
  it('creates a kid with a funny name and a PIN, then returns the same kid', async () => {
    const b = new Browser();
    await b.enter();
    const first = await b.json('POST', '/api/session', { timeZone: 'Europe/Paris', language: 'en' });
    expect(first.status).toBe(200);
    expect(first.body.created).toBe(true);
    const s = first.body.state;
    expect(s.profile.name).toMatch(/^[\p{L}]+-[\p{L}]+$/u);
    expect(checkName(s.profile.name)).toEqual({ ok: true });
    expect(s.profile.pin).toMatch(/^\d{3}$/);
    expect(s.profile.language).toBe('en');
    expect(s.profile.timeZone).toBe('Europe/Paris');
    expect(s.profile.nameChosen).toBe(false);
    expect(s.today).toBe('2026-11-13');
    expect(s.daily.candidates).toHaveLength(DAILY_CANDIDATES);
    expect(s.daily.unlocksLeft).toBe(3);
    expect(s.daily.quests.map((q: any) => q.kind)).toEqual(['choose', 'practice', 'practice', 'practice']);
    expect(s.practices).toEqual({});
    expect(s.streak).toMatchObject({ count: 0, best: 0, lastDay: null, doneToday: false, fullToday: false });
    expect(s.streak.week).toHaveLength(7);
    expect(b.cookies.get('fx_sid')).toBeTruthy();

    const again = await b.json('POST', '/api/session', { timeZone: 'Asia/Tokyo' });
    expect(again.body.created).toBe(false);
    expect(again.body.state.profile.timeZone).toBe('Europe/Paris'); // set once, at creation
    expect(again.body.state.profile.id).toBe(s.profile.id);
    expect(again.body.state.daily.candidates).toEqual(s.daily.candidates);
    // Only the hash of the token is stored.
    const row = await db().prepare('SELECT token_hash FROM sessions').first<{ token_hash: string }>();
    expect(row!.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row!.token_hash).not.toBe(b.cookies.get('fx_sid'));
  });

  it('starts a new kid in English unless the client asks for French', async () => {
    const a = new Browser();
    await a.enter();
    expect((await a.json('POST', '/api/session', { timeZone: 'America/Toronto' })).body.state.profile.language).toBe('en');
    const b = new Browser();
    await b.enter();
    expect((await b.json('POST', '/api/session', { timeZone: 'America/Toronto', language: 'fr' })).body.state.profile.language).toBe('fr');
  });

  it('day one candidates easy, funny scenes', async () => {
    const b = new Browser();
    const s = await b.start();
    const { FIXTURE_INDEX } = await import('../shared/fixtures');
    for (const o of s.daily.candidates) {
      const sc = FIXTURE_INDEX.scenes.find((x) => x.id === o.sceneId)!;
      expect(sc.difficulty).toBeLessThanOrEqual(2);
      expect(sc.score).toBeGreaterThanOrEqual(4);
    }
  });

  it('falls back to Toronto for an invalid zone and 401s other routes without a session', async () => {
    const b = new Browser();
    await b.enter();
    expect((await b.json('GET', '/api/me')).body).toEqual({ error: 'no-session' });
    const r = await b.json('POST', '/api/session', { timeZone: 'Mars/Olympus' });
    expect(r.body.state.profile.timeZone).toBe('America/Toronto');
  });

  it('uses the kid’s zone for today', async () => {
    const b = new Browser();
    b.now = '2026-11-14T03:00:00Z'; // still the 13th in Toronto, the 14th in Paris
    await b.enter();
    expect((await b.json('POST', '/api/session', { timeZone: 'America/Toronto' })).body.state.today).toBe('2026-11-13');
    await b.ok('PATCH', '/api/me', { timeZone: 'Europe/Paris' });
    expect((await b.ok('GET', '/api/me')).state.today).toBe('2026-11-14');
  });
});

describe('login', () => {
  async function kidWithName(name: string) {
    const b = new Browser();
    const s = await b.start();
    await b.ok('PATCH', '/api/me', { name });
    return { b, pin: s.profile.pin as string, id: s.profile.id as string };
  }

  it('logs in from a fresh browser by name, any case, and deletes the empty auto account', async () => {
    const { pin, id } = await kidWithName('Zoé-la-Gauloise');
    const other = new Browser();
    const fresh = await other.start();
    const r = await other.json('POST', '/api/login', { name: 'zoe-LA-gauloise', pin, timeZone: 'America/Toronto' });
    expect(r.status).toBe(200);
    expect(r.body.state.profile.id).toBe(id);
    // The answer says so: the device forgets the deleted account (web/src/state/accounts.ts).
    expect(r.body.previousDeleted).toBe(true);
    expect(await db().prepare('SELECT id FROM users WHERE id = ?').bind(fresh.profile.id).first()).toBeNull();
    expect((await other.ok('GET', '/api/me')).state.profile.id).toBe(id);

  });

  it('keeps an auto account that has progress', async () => {
    const { pin } = await kidWithName('Astérix-junior');
    const other = new Browser();
    const fresh = await other.start();
    await unlockSome(other, 1);
    expect((await other.ok('POST', '/api/login', { name: 'asterix-junior', pin, timeZone: 'America/Toronto' })).previousDeleted).toBe(false);
    expect(await db().prepare('SELECT id FROM users WHERE id = ?').bind(fresh.profile.id).first()).not.toBeNull();
  });

  it('rate-limits wrong PINs per account', async () => {
    const { pin } = await kidWithName('Obélix-junior');
    const wrong = String((Number(pin) + 1) % 1000).padStart(3, '0');
    const atk = new Browser();
    await atk.enter();
    for (let i = 0; i < 5; i++) {
      atk.ip = `10.1.0.${i}`;
      expect((await atk.json('POST', '/api/login', { name: 'obelix-junior', pin: wrong, timeZone: 'UTC' })).body.error).toBe('bad-credentials');
    }
    atk.ip = '10.1.0.99';
    const r = await atk.json('POST', '/api/login', { name: 'obelix-junior', pin, timeZone: 'UTC' });
    expect(r.status).toBe(429);
    expect(r.body.error).toBe('rate-limited');
    // After the window it works again.
    atk.now = '2026-11-13T15:20:00Z';
    expect((await atk.json('POST', '/api/login', { name: 'obelix-junior', pin, timeZone: 'UTC' })).status).toBe(200);
  });

  it('rate-limits per address, high enough for a classroom behind one address', async () => {
    const atk = new Browser();
    await atk.enter();
    // A classroom's typos: well past the old limit of 20, nobody is locked out.
    for (let i = 0; i < 30; i++) expect((await atk.json('POST', '/api/login', { name: `nobody-${i}`, pin: '123', timeZone: 'UTC' })).status).toBe(401);
    // The rest of the limit, written directly (200 requests would only slow the test down).
    const now = Date.parse(atk.now);
    await db().batch(Array.from({ length: LOGIN_FAILS_PER_ADDRESS - 30 }, () => db().prepare('INSERT INTO login_attempts (key, at) VALUES (?, ?)').bind(`ip:${atk.ip}`, now)));
    const r = await atk.json('POST', '/api/login', { name: 'nobody-x', pin: '123', timeZone: 'UTC' });
    expect(r.status).toBe(429);
    expect(r.body.retryAfterS).toBeGreaterThan(60);
  });

  it('switches back and forth between two kids in one browser (a shared device)', async () => {
    const a = await kidWithName('Idefix-junior');
    await unlockSome(a.b, 1);
    const other = await kidWithName('Abraracourcix-junior');
    await unlockSome(other.b, 1);
    const toOther = await a.b.ok('POST', '/api/login', { name: 'abraracourcix-junior', pin: other.pin, timeZone: 'UTC' });
    expect(toOther.state.profile.id).toBe(other.id);
    expect(toOther.previousDeleted).toBe(false);
    const back = await a.b.ok('POST', '/api/login', { name: 'idefix-junior', pin: a.pin, timeZone: 'UTC' });
    expect(back.state.profile.id).toBe(a.id);
    expect(back.previousDeleted).toBe(false);
    expect((await a.b.ok('GET', '/api/me')).state.profile.id).toBe(a.id);
  });

  it('reads spaces in a typed name as hyphens', async () => {
    const { pin, id } = await kidWithName('Chinchilla-Farceur');
    const other = new Browser();
    await other.start();
    const r = await other.json('POST', '/api/login', { name: '  chinchilla  farceur ', pin, timeZone: 'America/Toronto' });
    expect(r.status).toBe(200);
    expect(r.body.state.profile.id).toBe(id);
  });
});

describe('logout', () => {
  it('ends this browser’s session only; the next start makes a new kid; the account stays for a login', async () => {
    const b = new Browser();
    const s = await b.start();
    await b.ok('PATCH', '/api/me', { name: 'Panoramix-junior' });
    const other = new Browser();
    await other.start();
    await other.ok('POST', '/api/login', { name: 'panoramix-junior', pin: s.profile.pin, timeZone: 'UTC' });
    const res = await b.fetch('POST', '/api/logout');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: false });
    expect(res.headers.getSetCookie().find((c) => c.startsWith('fx_sid='))).toMatch(/Max-Age=0/);
    expect((await b.json('GET', '/api/me')).body).toEqual({ error: 'no-session' });
    // The other browser is still signed in; the account is kept.
    expect((await other.ok('GET', '/api/me')).state.profile.id).toBe(s.profile.id);
    const again = await b.json('POST', '/api/session', { timeZone: 'UTC' });
    expect(again.body.created).toBe(true);
    expect(again.body.state.profile.id).not.toBe(s.profile.id);
    // Logging back in works.
    expect((await b.ok('POST', '/api/login', { name: 'panoramix-junior', pin: s.profile.pin, timeZone: 'UTC' })).state.profile.id).toBe(s.profile.id);
  });

  it('deletes an account that holds nothing, and does nothing without a session', async () => {
    const b = new Browser();
    const s = await b.start();
    expect(await b.ok('POST', '/api/logout')).toEqual({ deleted: true });
    expect(await db().prepare('SELECT id FROM users WHERE id = ?').bind(s.profile.id).first()).toBeNull();
    expect(await db().prepare('SELECT count(*) AS n FROM sessions').first<{ n: number }>()).toEqual({ n: 0 });
    expect(await b.ok('POST', '/api/logout')).toEqual({ deleted: false });
  });
});

describe('names', () => {
  it('accepts a good name, refuses rude, invalid and taken ones', async () => {
    const a = new Browser();
    await a.start();
    const b = new Browser();
    await b.start();
    expect((await a.ok('PATCH', '/api/me', { name: 'Idéfix_fan' })).patch.profile).toMatchObject({ name: 'Idéfix_fan', nameChosen: true });
    expect((await b.json('PATCH', '/api/me', { name: 'IDEFIX_FAN' })).body.error).toBe('name-taken');
    expect((await b.json('PATCH', '/api/me', { name: 'm3rde' })).body.error).toBe('name-rude');
    expect((await b.json('PATCH', '/api/me', { name: 'a b' })).body.error).toBe('name-invalid');
    expect((await b.json('PATCH', '/api/me', { name: 'xy' })).body.error).toBe('name-invalid');
    expect((await b.ok('PATCH', '/api/me', { name: 'assassin-du-38' })).patch.profile.name).toBe('assassin-du-38');
    // Renaming yourself to a different case of your own name is fine.
    expect((await a.ok('PATCH', '/api/me', { name: 'idéfix_FAN' })).patch.profile.name).toBe('idéfix_FAN');
  });

  it('validates language, speak and avatar', async () => {
    const a = new Browser();
    await a.start();
    const p = (await a.ok('PATCH', '/api/me', { language: 'en', speak: false })).patch.profile;
    expect(p).toMatchObject({ language: 'en', speak: false });
    expect((await a.json('PATCH', '/api/me', { avatar: { v: 1, base: {}, worn: { held: 'squeaky-lyre' } } })).body.error).toBe('avatar-invalid');
  });
});

describe('one kid never touches another', () => {
  it('cannot complete, open or read another kid’s things', async () => {
    const a = new Browser();
    await a.start();
    const [sceneId] = await unlockSome(a, 1);
    const { plan } = await a.ok('POST', '/api/practices/start', { kind: 'scene', sceneId });
    const b = new Browser();
    await b.start();
    const r = await b.json('POST', `/api/practices/${plan.id}/complete`, { outcomes: [], ms: 1 });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('practice-closed');
    const done = await a.ok('POST', `/api/practices/${plan.id}/complete`, { outcomes: [], ms: 1 });
    expect(done.chest).toBeTruthy();
    expect((await b.json('POST', `/api/chests/${done.chest.id}/open`)).status).toBe(404);
    expect((await b.json('POST', '/api/speech?scene=x&line=y', new Uint8Array(10))).status).toBe(403);
    expect((await b.json('POST', '/api/practices/start', { kind: 'scene', sceneId: plan.entries[0].sceneId })).body.error).toBe('scene-locked');
    await playPractice(a, { kind: 'scene', sceneId });
  });
});
