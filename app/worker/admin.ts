// Local development and the admin cookie.
//
// LOCAL_DEV (passed on the command line only, by tools/dev.mjs; never in .dev.vars or wrangler.jsonc,
// and tools/deploy.sh refuses a config that sets it) turns every password off: no school gate, no
// admin sign-in. It only counts for requests to localhost, so even a leaked variable does nothing on
// the real domain.
//
// /dev in production: an admin password (ADMIN_PASSWORD) asked once per browser. The admin cookie is
// signed like the gate cookie, lasts as long, and also counts as the school gate. The user's words:
// not real security, "just against occasional kids trying to puzzle type the system a little bit".
import { GATE_MAX_AGE_S, failures, recordFailure } from './gate';
import { clientIp, cookieHeader, getCookie, hmac, nowMs, safeEqual, sleep, testMode, type Ctx } from './util';

export const ADMIN_COOKIE = 'fx_admin';
const ADMIN_FAIL_LIMIT = 10; // failed tries per address per window, as the gate
const ADMIN_WINDOW_MS = 15 * 60_000;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** Running under wrangler dev with LOCAL_DEV set, on a localhost address. */
export function isLocalDev(c: Ctx): boolean {
  if (!c.env.LOCAL_DEV) return false;
  return LOCAL_HOSTS.has(new URL(c.req.url).hostname);
}

async function adminToken(c: Ctx, issued: number): Promise<string> {
  return `v1.${issued}.${await hmac(c.env.SESSION_SECRET, `admin|${(c.env.ADMIN_PASSWORD ?? '').trim()}|${issued}`)}`;
}

export async function hasAdminCookie(c: Ctx): Promise<boolean> {
  const v = getCookie(c, ADMIN_COOKIE);
  if (!v || !c.env.ADMIN_PASSWORD) return false;
  const m = /^v1\.(\d{1,15})\.([\w-]+)$/.exec(v);
  if (!m) return false;
  return safeEqual(v, await adminToken(c, Number(m[1])));
}

/** An admin: locally anyone, in production a browser with the admin cookie. */
export async function isAdmin(c: Ctx): Promise<boolean> {
  return isLocalDev(c) || (await hasAdminCookie(c));
}

export const isDevPath = (path: string) => path === '/dev' || path.startsWith('/dev/');

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

function safeNext(v: unknown): string {
  return typeof v === 'string' && isDevPath(v.split('?')[0]!) && v.length < 512 ? v : '/dev';
}

/** The admin sign-in page: the gate's comic look, one field, one button. Plain English (adults only). */
export function adminPage(next: string, error: 'bad' | 'limited' | null): Response {
  const status = error === 'limited' ? 429 : error ? 401 : 200;
  const msg = error === 'limited' ? 'Too many tries. Wait a few minutes.' : error ? 'Not that one. Try again.' : 'Admin password, please.';
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<title>Frenchirix admin</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style>
@font-face{font-family:Bangers;src:url(/gate/bangers.woff2) format("woff2");font-display:swap}
:root{--blue:#2F7FA8;--yellow:#FFD21F;--paper:#FFF3D0;--ink:#111;--red:#E8303A;--d:"Bangers",Impact,"Arial Narrow",sans-serif}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;min-height:100dvh;display:grid;place-items:center;padding:16px;color:var(--ink);font:700 18px/1.3 "Comic Sans MS","Chalkboard SE",system-ui,sans-serif;
background-color:var(--blue);background-image:radial-gradient(circle,rgba(0,0,0,.18) 1.6px,transparent 2.1px),repeating-conic-gradient(from 0deg at 50% 40%,rgba(255,255,255,.18) 0 3deg,transparent 3deg 14deg);background-size:9px 9px,100% 100%}
main{width:100%;max-width:400px;background:var(--paper);border:5px solid var(--ink);box-shadow:8px 8px 0 var(--ink);padding:18px 18px 22px;transform:rotate(-1deg)}
h1{margin:0 0 12px;font:400 44px/1 var(--d);letter-spacing:2px;color:var(--yellow);-webkit-text-stroke:2.5px var(--ink);paint-order:stroke fill;text-shadow:4px 4px 0 var(--ink);transform:rotate(-3deg) skewX(-8deg)}
p{margin:0 0 14px;display:inline-block;background:var(--yellow);border:3px solid var(--ink);padding:5px 10px;text-transform:uppercase;font-size:15px}
p.bad{background:var(--red);color:#fff}
p.bad::before{content:"OUPS ! ";font:400 18px/1 var(--d);letter-spacing:1px}
input{display:block;width:100%;height:56px;border:3px solid var(--ink);background:#fff;font:700 22px/1 system-ui,sans-serif;padding:0 12px;outline:none}
input:focus{outline:4px dashed var(--yellow);outline-offset:3px}
button{margin-top:16px;width:100%;height:58px;border:3px solid var(--ink);background:var(--yellow);font:400 32px/1 var(--d);letter-spacing:3px;text-transform:uppercase;box-shadow:5px 5px 0 var(--ink);cursor:pointer}
button:active{transform:translate(5px,5px);box-shadow:none}
</style></head>
<body><main>
<h1>Admin</h1>
<p class="${error ? 'bad' : ''}" role="status">${esc(msg)}</p>
<form method="post" action="/dev/login">
<input type="hidden" name="next" value="${esc(next)}">
<input name="password" type="password" autocomplete="current-password" aria-label="Admin password" autofocus required>
<button type="submit">Enter</button>
</form>
</main></body></html>`;
  return new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}

/** POST /dev/login (form, or JSON answering 204/401). */
export async function postAdminLogin(c: Ctx): Promise<Response> {
  const isForm = !(c.req.header('content-type') ?? '').includes('json');
  let password = '';
  let next = '/dev';
  if (isForm) {
    const form = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
    password = typeof form.password === 'string' ? form.password : '';
    next = safeNext(form.next);
  } else {
    const body = (await c.req.json().catch(() => ({}))) as { password?: unknown };
    password = typeof body.password === 'string' ? body.password : '';
  }
  const now = nowMs(c);
  const key = `adm:${clientIp(c)}`;
  const f = await failures(c.env.DB, key, now, ADMIN_WINDOW_MS);
  if (f.n >= ADMIN_FAIL_LIMIT) {
    const retryAfterS = Math.max(1, Math.ceil(((f.oldest ?? now) + ADMIN_WINDOW_MS - now) / 1000));
    if (isForm) return adminPage(next, 'limited');
    return c.json({ error: 'rate-limited', retryAfterS }, 429, { 'retry-after': String(retryAfterS) });
  }
  const expected = (c.env.ADMIN_PASSWORD ?? '').trim();
  if (!expected || !(await safeEqual(password.trim(), expected))) {
    await recordFailure(c.env.DB, [key], now);
    if (!testMode(c.env)) await sleep(400);
    if (isForm) return adminPage(next, 'bad');
    return c.json({ error: 'bad-password' }, 401);
  }
  const cookie = cookieHeader(c, ADMIN_COOKIE, await adminToken(c, now), GATE_MAX_AGE_S);
  if (isForm) return new Response(null, { status: 303, headers: { location: next, 'set-cookie': cookie, 'cache-control': 'no-store' } });
  return new Response(null, { status: 204, headers: { 'set-cookie': cookie } });
}
