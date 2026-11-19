// Accounts without registration: POST /api/session creates a kid on first open, POST /api/login moves a
// kid to another browser with name + PIN. The session cookie holds a random token; D1 holds
// its SHA-256. requireSession loads the kid for every other /api route.
import { Hono, type MiddlewareHandler } from 'hono';
import type { LoginRequest, LoginResponse, LogoutResponse, SessionRequest, SessionResponse } from '../shared/api';
import { DEFAULT_AVATAR } from '../shared/catalog';
import { nameKey } from '../shared/catalog/badwords';
import { randomName } from '../shared/catalog/names';
import { SKILL_START, PIN_RE, kidDay } from '../shared/rules';
import type { AppEnv } from './env';
import { failures, recordFailure } from './gate';
import { fullState } from './state';
import { StaleError, UserTx, loadUserRow, zoneOrDefault, type UserRow } from './tx';
import { clientIp, cookieHeader, cryptoRandom, fail, getCookie, jsonBody, nowMs, randomId, randomPin, randomToken, sha256Hex, testMode, type Ctx } from './util';

export const SESSION_COOKIE = 'fx_sid';
export const SESSION_MAX_AGE_S = 400 * 86400;
const SESSION_REFRESH_MS = 86_400_000; // refresh the cookie and seen_at at most once a day
const LOGIN_WINDOW_MS = 15 * 60_000;
/** A typed classmate's name locks only that account; a classroom behind one address cannot lock itself out. */
export const LOGIN_FAILS_PER_ACCOUNT = 5;
export const LOGIN_FAILS_PER_ADDRESS = 200;

const userRows = new WeakMap<Request, UserRow>();

interface SessionHit {
  row: UserRow;
  tokenHash: string;
  seenAt: number;
}

async function findSession(c: Ctx): Promise<SessionHit | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token || token.length > 100) return null;
  const tokenHash = await sha256Hex(token);
  const r = await c.env.DB.prepare(
    'SELECT s.seen_at AS s_seen_at, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?',
  )
    .bind(tokenHash)
    .first<UserRow & { s_seen_at: number }>();
  if (!r) return null;
  if (nowMs(c) - r.s_seen_at > SESSION_MAX_AGE_S * 1000) return null;
  const { s_seen_at, ...row } = r;
  return { row: row as UserRow, tokenHash, seenAt: s_seen_at };
}

async function startSession(c: Ctx, userId: string): Promise<void> {
  const token = randomToken();
  const now = nowMs(c);
  await c.env.DB.prepare('INSERT INTO sessions (token_hash, user_id, created_at, seen_at) VALUES (?, ?, ?, ?)')
    .bind(await sha256Hex(token), userId, now, now)
    .run();
  c.header('set-cookie', cookieHeader(c, SESSION_COOKIE, token, SESSION_MAX_AGE_S), { append: true });
}

/** Loads the kid of the session cookie, or 401 no-session. Refreshes the session about once a day. */
export const requireSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  const hit = await findSession(c);
  if (!hit) return c.json({ error: 'no-session' }, 401);
  const now = nowMs(c);
  if (now - hit.seenAt > SESSION_REFRESH_MS) {
    await c.env.DB.prepare('UPDATE sessions SET seen_at = ? WHERE token_hash = ?').bind(now, hit.tokenHash).run();
    c.header('set-cookie', cookieHeader(c, SESSION_COOKIE, getCookie(c, SESSION_COOKIE)!, SESSION_MAX_AGE_S), { append: true });
  }
  c.set('userId', hit.row.id);
  userRows.set(c.req.raw, hit.row);
  await next();
};

/** The signed-in kid's row when the request carries a valid session, else null (routes that work without one: the log, reports). */
export async function sessionUser(c: Ctx): Promise<UserRow | null> {
  return userRows.get(c.req.raw) ?? (await findSession(c))?.row ?? null;
}

/**
 * Run a handler against the signed-in kid. The handler changes `tx` and calls tx.commit(); when another
 * request of the same kid committed in between, the handler is replayed on a fresh read.
 */
export async function runTx<T>(c: Ctx, fn: (tx: UserTx) => Promise<T>): Promise<T> {
  let row = userRows.get(c.req.raw) ?? (await loadUserRow(c.env.DB, c.get('userId')));
  for (let attempt = 0; ; attempt++) {
    if (!row) return fail(401, 'no-session');
    try {
      return await fn(Object.assign(new UserTx(c.env, row, nowMs(c)), { ctx: c }));
    } catch (e) {
      if (!(e instanceof StaleError) || attempt >= 4) throw e;
      row = await loadUserRow(c.env.DB, row.id);
    }
  }
}

/** A new kid with a unique funny name. */
async function createUser(c: Ctx, timeZone: string, language: 'fr' | 'en'): Promise<string> {
  const now = nowMs(c);
  const id = randomId('u');
  for (let attempt = 0; attempt < 12; attempt++) {
    let name = randomName(cryptoRandom);
    if (attempt >= 8) name = `${name.slice(0, 17)}${Math.floor(cryptoRandom() * 100)}`;
    const res = await c.env.DB.prepare(
      `INSERT OR IGNORE INTO users (id, name, name_key, pin, language, avatar, time_zone, created_day, created_at, skill_estimate)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(id, name, nameKey(name), randomPin(), language, JSON.stringify(DEFAULT_AVATAR), timeZone, kidDay(now, timeZone), now, SKILL_START)
      .run();
    if (res.meta.changes === 1) return id;
  }
  return fail(500, 'internal', 'could not find a free name');
}

/** True when a kid has nothing worth keeping (an auto-created account replaced by a login). */
async function isEmptyAccount(db: D1Database, row: UserRow): Promise<boolean> {
  if (row.xp > 0 || row.name_chosen) return false;
  const r = await db
    .prepare(
      `SELECT (SELECT count(*) FROM scene_progress WHERE user_id = ?1) + (SELECT count(*) FROM follows WHERE follower_id = ?1 OR followee_id = ?1)
        + (SELECT count(*) FROM inventory WHERE user_id = ?1) + (SELECT count(*) FROM gifts WHERE to_id = ?1)
        + (SELECT count(*) FROM recordings WHERE user_id = ?1 AND saved = 1) AS n`,
    )
    .bind(row.id)
    .first<{ n: number }>();
  return (r?.n ?? 0) === 0;
}

async function deleteUser(db: D1Database, id: string): Promise<void> {
  const tables = ['sessions', 'daily', 'practices', 'unit_stats', 'puzzle_type_stats', 'chests', 'achievements', 'days', 'feed', 'league_members', 'recordings'];
  await db.batch([
    ...tables.map((t) => db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).bind(id)),
    db.prepare('DELETE FROM users WHERE id = ?').bind(id),
  ]);
}

export const sessionRoutes = new Hono<AppEnv>();

sessionRoutes.post('/session', async (c) => {
  const body = await jsonBody<Partial<SessionRequest>>(c);
  const timeZone = zoneOrDefault(body.timeZone);
  const hit = await findSession(c);
  let created = false;
  let row: UserRow | null = hit?.row ?? null;
  if (!row) {
    // A new account starts in English unless the client asks for French (docs/intent.md, "Language").
    // In TEST_MODE, `x-test-language: fr` starts it in French (the e2e specs read the French interface).
    const asked = (testMode(c.env) && c.req.header('x-test-language')) || body.language;
    const id = await createUser(c, timeZone, asked === 'fr' ? 'fr' : 'en');
    await startSession(c, id);
    row = await loadUserRow(c.env.DB, id);
    created = true;
  } else if (nowMs(c) - hit!.seenAt > SESSION_REFRESH_MS) {
    await c.env.DB.prepare('UPDATE sessions SET seen_at = ? WHERE token_hash = ?').bind(nowMs(c), hit!.tokenHash).run();
    c.header('set-cookie', cookieHeader(c, SESSION_COOKIE, getCookie(c, SESSION_COOKIE)!, SESSION_MAX_AGE_S), { append: true });
  }
  c.set('userId', row!.id);
  userRows.set(c.req.raw, row!);
  // The time zone is set when the account is made and changes only through PATCH /api/me.
  const state = await runTx(c, async (tx) => fullState(tx));
  return c.json<SessionResponse>({ state, created });
});

sessionRoutes.post('/login', async (c) => {
  const body = await jsonBody<Partial<LoginRequest>>(c);
  // Names have no spaces (NAME_RE): a kid who types « chinchilla farceur » means « chinchilla-farceur ».
  const ident = typeof body.name === 'string' ? body.name.trim().replace(/\s+/g, '-') : '';
  const pin = typeof body.pin === 'string' ? body.pin.trim() : '';
  if (!ident || ident.length > 120 || !PIN_RE.test(pin)) return fail(400, 'bad-request', 'name and a three-digit pin');
  const db = c.env.DB;
  const now = nowMs(c);
  const accountKey = `a:${nameKey(ident)}`;
  const ipKey = `ip:${clientIp(c)}`;
  const [fa, fi] = await Promise.all([failures(db, accountKey, now, LOGIN_WINDOW_MS), failures(db, ipKey, now, LOGIN_WINDOW_MS)]);
  const limited = fa.n >= LOGIN_FAILS_PER_ACCOUNT ? fa : fi.n >= LOGIN_FAILS_PER_ADDRESS ? fi : null;
  if (limited) {
    const retryAfterS = Math.max(1, Math.ceil(((limited.oldest ?? now) + LOGIN_WINDOW_MS - now) / 1000));
    c.header('retry-after', String(retryAfterS));
    return fail(429, 'rate-limited', undefined, retryAfterS);
  }
  const target = await db.prepare('SELECT * FROM users WHERE name_key = ? AND pin = ?').bind(nameKey(ident), pin).first<UserRow>();
  if (!target) {
    await recordFailure(db, [accountKey, ipKey], now);
    return fail(401, 'bad-credentials');
  }
  // The browser's current account: drop its session, and the account itself when it holds nothing.
  const current = await findSession(c);
  let previousDeleted = false;
  if (current && current.row.id !== target.id) {
    await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(current.tokenHash).run();
    if (await isEmptyAccount(db, current.row)) {
      await deleteUser(db, current.row.id);
      previousDeleted = true;
    }
  } else if (current) {
    await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(current.tokenHash).run();
  }
  await startSession(c, target.id);
  c.set('userId', target.id);
  userRows.set(c.req.raw, target);
  // The account keeps its time zone (only PATCH /api/me changes it).
  const state = await runTx(c, async (tx) => fullState(tx));
  return c.json<LoginResponse>({ state, previousDeleted });
});

/**
 * POST /api/logout ("New player" on the player selection, for a shared device): deletes this browser's
 * session and expires its cookie; an account that holds nothing goes too (as at login), and the answer
 * says so (`deleted`), so the device forgets it. Without a session it does nothing. The client then
 * boots, which makes a new kid.
 */
sessionRoutes.post('/logout', async (c) => {
  const current = await findSession(c);
  let deleted = false;
  if (current) {
    await c.env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(current.tokenHash).run();
    if (await isEmptyAccount(c.env.DB, current.row)) {
      await deleteUser(c.env.DB, current.row.id);
      deleted = true;
    }
  }
  c.header('set-cookie', cookieHeader(c, SESSION_COOKIE, '', 0), { append: true });
  return c.json<LogoutResponse>({ deleted });
});
