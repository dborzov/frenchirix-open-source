// The gate: one shared password in front of everything. The Worker runs first on every request; without
// a valid gate cookie a page navigation gets the small self-contained page below and anything else 401.
import type { Language } from '../shared/api';
import { translate, type TKey } from '../shared/i18n';
import type { Env } from './env';
import { clientIp, cookieHeader, getCookie, hmac, safeEqual, sleep, testMode, nowMs, type Ctx } from './util';

export const GATE_COOKIE = 'fx_gate';
export const GATE_MAX_AGE_S = 400 * 86400;
// Failed tries per address per window. High on purpose: a whole classroom shares one address, and the
// password is a word the teacher says out loud, not a secret worth guarding against guessing.
export const GATE_FAIL_LIMIT = 200;
const GATE_WINDOW_MS = 15 * 60_000;

/** The cookie value: issue time and an HMAC that also covers the password (changing it logs everyone out). */
async function gateToken(env: Env, issued: number): Promise<string> {
  return `v1.${issued}.${await hmac(env.SESSION_SECRET, `gate|${env.GATE_PASSWORD.toLowerCase()}|${issued}`)}`;
}

export async function hasGate(c: Ctx): Promise<boolean> {
  const v = getCookie(c, GATE_COOKIE);
  if (!v) return false;
  const m = /^v1\.(\d{1,15})\.([\w-]+)$/.exec(v);
  if (!m) return false;
  return safeEqual(v, await gateToken(c.env, Number(m[1])));
}

export function isNavigation(c: Ctx): boolean {
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') return false;
  const mode = c.req.header('sec-fetch-mode');
  if (mode) return mode === 'navigate';
  return (c.req.header('accept') ?? '').includes('text/html');
}

/**
 * The gate is always in English, like a new account's interface (docs/intent.md, "Language": French
 * first was too intimidating). Nobody has a profile yet, and the browser's language is not followed.
 */
function pageLanguage(_c: Ctx): Language {
  return 'en';
}

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

/**
 * Files the gate page needs, served without the gate cookie. Exact paths only (from public/gate/):
 * nothing under /data, /media, /api or /assets is reachable this way.
 */
export const GATE_PUBLIC_FILES: ReadonlyMap<string, string> = new Map([
  ['/gate/cover.webp', 'image/webp'],
  ['/gate/bangers.woff2', 'font/woff2'],
  ['/gate/comic-neue-700.woff2', 'font/woff2'],
]);

/** Serves one allow-listed gate file through ASSETS, or null when the path is not on the list. */
export async function gatePublicFile(c: Ctx): Promise<Response | null> {
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') return null;
  const url = new URL(c.req.url);
  const type = GATE_PUBLIC_FILES.get(url.pathname);
  if (!type) return null;
  const res = await c.env.ASSETS.fetch(new Request(new URL(url.pathname, url.origin), { method: c.req.method }));
  if (!res.ok) return new Response('not found', { status: 404, headers: { 'cache-control': 'no-store' } });
  const out = new Response(res.body, res);
  out.headers.set('content-type', type);
  out.headers.set('cache-control', 'public, max-age=604800');
  return out;
}

/** A jagged starburst polygon in a 100 x 100 box (deterministic). */
function burst(points: number, seed: number, depth = 0.3): string {
  let a = seed >>> 0 || 1;
  const rnd = () => {
    a = (Math.imul(a ^ (a >>> 15), 2246822507) + 0x6d2b79f5) >>> 0;
    return (a % 1000) / 1000;
  };
  const out: string[] = [];
  const n = points * 2;
  for (let i = 0; i < n; i++) {
    const angle = (i / n) * Math.PI * 2 - Math.PI / 2 + (rnd() - 0.5) * 0.12;
    const r = i % 2 === 0 ? 48 - rnd() * 6 : 48 * (1 - depth) - rnd() * 8;
    out.push(`${(50 + Math.cos(angle) * r).toFixed(1)},${(50 + Math.sin(angle) * r).toFixed(1)}`);
  }
  return out.join(' ');
}

const burstSvg = (cls: string, fill: string, seed: number, word: string) =>
  `<div class="${cls}" aria-hidden="true"><svg viewBox="0 0 100 100" preserveAspectRatio="none"><polygon points="${burst(14, seed)}" fill="${fill}" stroke="#111" stroke-width="3.5" vector-effect="non-scaling-stroke" stroke-linejoin="miter"/></svg><b>${word}</b></div>`;

/**
 * The gate page: the front cover of a 1950s comic. The talking TV of the cover art (public/gate/cover.webp)
 * asks for the magic word in a balloon;
 * the kid answers in a big reply balloon. Works as a plain form post with no script; the inline
 * script adds the fun (OUPS ! and a shake on a wrong word, PAF ! and the cover opening on the right one).
 */
export function gatePage(c: Ctx, next: string, error: 'bad' | 'limited' | null): Response {
  const lang = pageLanguage(c);
  const t = (k: string) => esc(translate(lang, k as TKey));
  const status = error === 'limited' ? 429 : error ? 401 : 200;
  const balloon = error === 'limited' ? t('gate.limited') : error ? t('gate.wrong') : t('gate.prompt');
  const html = `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<meta name="theme-color" content="#E8303A">
<title>Frenchirix</title>
<link rel="preload" href="/gate/bangers.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/gate/cover.webp" as="image" type="image/webp">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/manifest.webmanifest">
<meta name="apple-mobile-web-app-title" content="Frenchirix">
<style>
@font-face{font-family:Bangers;src:url(/gate/bangers.woff2) format("woff2");font-display:swap}
@font-face{font-family:"Comic Neue";font-weight:700;src:url(/gate/comic-neue-700.woff2) format("woff2");font-display:swap}
:root{--pt:max(8px,env(safe-area-inset-top));--pr:max(8px,env(safe-area-inset-right));--pb:max(8px,env(safe-area-inset-bottom));--pl:max(8px,env(safe-area-inset-left));--red:#E8303A;--yellow:#FFD21F;--paper:#FFF3D0;--ink:#111;--blue:#1E88E5;--white:#fff;--d:"Bangers",Impact,"Arial Narrow",sans-serif;--t:"Comic Neue","Comic Sans MS","Chalkboard SE",system-ui,sans-serif}
*{box-sizing:border-box}
html{background:var(--paper)}
body{margin:0;color:var(--ink);font:700 18px/1.3 var(--t);overflow-x:hidden;background:var(--paper);padding:var(--pt) var(--pr) var(--pb) var(--pl)}
.cover{--w:min(calc(100vw - var(--pl) - var(--pr)),900px);--ai:calc(var(--w) - 45px);position:relative;margin:0 auto;max-width:900px;min-height:calc(100vh - var(--pt) - var(--pb));min-height:calc(100dvh - var(--pt) - var(--pb));display:flex;flex-direction:column;gap:12px;
border:5px solid var(--ink);padding:8px 14px 14px;transform-origin:left center;overflow:hidden;
background-color:var(--red);background-image:radial-gradient(circle,rgba(0,0,0,.16) 1.6px,transparent 2.1px),repeating-conic-gradient(from 0deg at 50% 32%,rgba(255,255,255,.3) 0 2.6deg,transparent 2.6deg 13deg);background-size:9px 9px,100% 100%}
.foot{grid-area:foot;flex:none;margin-top:auto;display:flex;justify-content:space-between;align-items:flex-end;gap:10px;font:400 14px/1 var(--d);letter-spacing:1px;color:var(--white);-webkit-text-stroke:.5px var(--ink);text-shadow:1.5px 1.5px 0 var(--ink)}
.foot svg{width:54px;height:54px;filter:drop-shadow(3px 3px 0 #111)}
.mast{grid-area:mast;flex:none;position:relative;display:flex;align-items:center;justify-content:center;height:78px}
h1{margin:0;font:400 min(50px,12.5vw)/1 var(--d);letter-spacing:2px;color:var(--yellow);-webkit-text-stroke:3px var(--ink);paint-order:stroke fill;text-shadow:4px 4px 0 var(--ink),7px 7px 0 var(--blue);transform:rotate(-4deg) skewX(-8deg);white-space:nowrap}
.vol{position:absolute;left:0;top:2px;font:400 15px/1 var(--d);letter-spacing:1px;color:var(--white);-webkit-text-stroke:.6px var(--ink);text-shadow:1.5px 1.5px 0 var(--ink)}
.price{position:absolute;right:0;top:22px;width:56px;height:56px;border-radius:50%;background:var(--yellow);border:3px solid var(--ink);box-shadow:3px 3px 0 var(--ink);display:grid;place-items:center;text-align:center;font:400 10.5px/1 var(--d);letter-spacing:.5px;transform:rotate(12deg);padding:4px}
.price b{display:block;font-size:24px;font-weight:400}
.art{grid-area:art;flex:1 1 0;min-height:calc(var(--ai) * .5625);max-height:calc(var(--ai) * 1.2);position:relative;border:5px solid var(--ink);background:#f6a6b0;box-shadow:7px 7px 0 var(--ink);margin-right:7px}
.art img{position:absolute;inset:0;display:block;width:100%;height:100%;object-fit:cover;object-position:45% 40%}
.art::after{content:"";position:absolute;inset:0;pointer-events:none;background-image:radial-gradient(circle,rgba(0,0,0,.12) 1px,transparent 1.5px);background-size:5px 5px;mix-blend-mode:multiply}
.caption{position:absolute;left:-8px;bottom:-14px;max-width:62%;margin:0;background:var(--yellow);border:3px solid var(--ink);box-shadow:3px 3px 0 var(--ink);padding:5px 9px 4px;font:700 12px/1.15 var(--t);text-transform:uppercase;letter-spacing:.3px;transform:rotate(-1.5deg);z-index:2}
.say{position:absolute;right:2%;top:4%;width:35%;display:grid;place-items:center;background:var(--white);border:3px solid var(--ink);border-radius:46%/50%;padding:12px 16px;text-align:center;font:400 15px/1.05 var(--d);letter-spacing:.6px;filter:drop-shadow(3px 3px 0 var(--ink));z-index:2;overflow-wrap:break-word;min-width:112px}
.say svg{position:absolute;left:10%;top:calc(100% - 4px);width:30px;height:34px;overflow:visible}
.stamp{position:absolute;left:-8px;top:-12px;background:var(--white);border:3px solid var(--ink);padding:4px 7px 2px;font:400 12px/1 var(--d);letter-spacing:1px;color:var(--red);transform:rotate(-5deg);box-shadow:3px 3px 0 var(--ink);z-index:2}
form{grid-area:form;flex:none;position:relative;display:grid;gap:14px;margin-top:6px}
.reply{position:relative;display:block;background:var(--white);border:4px solid var(--ink);border-radius:28px;padding:8px 14px;filter:drop-shadow(4px 4px 0 var(--ink))}
.reply svg{position:absolute;right:18%;top:calc(100% - 4px);width:38px;height:36px;overflow:visible}
.reply small{display:block;font:700 13px/1 var(--t);text-transform:uppercase;letter-spacing:.5px;color:#555;margin:2px 0 0 4px}
input{display:block;width:100%;height:62px;border:0;background:transparent;outline:none;color:var(--ink);font:400 40px/1 var(--d);letter-spacing:5px;text-transform:uppercase;padding:4px 4px 0;text-align:center}
input::placeholder{color:#b9b0a0;letter-spacing:2px;font-size:30px}
.reply:focus-within{outline:4px dashed var(--yellow);outline-offset:5px}
button{height:64px;margin-right:6px;border:4px solid var(--ink);background:var(--yellow);color:var(--ink);font:400 34px/1 var(--d);letter-spacing:3px;text-transform:uppercase;box-shadow:6px 6px 0 var(--ink);cursor:pointer;transform:rotate(-1deg);transition:transform .07s,box-shadow .07s;touch-action:manipulation}
button:active{transform:rotate(-1deg) translate(6px,6px);box-shadow:0 0 0 var(--ink)}
.oups,.paf{position:absolute;display:grid;place-items:center;pointer-events:none}
.oups svg,.paf svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible;filter:drop-shadow(4px 4px 0 #111)}
.oups b,.paf b{position:relative;font:400 30px/1 var(--d);letter-spacing:1px;color:var(--white);-webkit-text-stroke:1.6px var(--ink);paint-order:stroke fill;text-shadow:3px 3px 0 var(--ink);transform:skewX(-8deg)}
.oups{right:2px;top:-88px;width:124px;height:86px;transform:rotate(10deg);z-index:3;display:none}
.wrong .oups{display:grid;animation:pop .4s cubic-bezier(.2,1.7,.4,1) both}
.wrong form .reply,.wrong .say{animation:shake .42s}
.paf{position:fixed;left:50%;top:38%;width:min(80vw,420px);height:min(58vw,300px);transform:translate(-50%,-50%);z-index:9;display:none}
.paf b{font-size:clamp(64px,16vw,120px);color:var(--ink);-webkit-text-stroke:0;text-shadow:none}
.open .paf{display:grid;animation:slam .45s cubic-bezier(.2,1.7,.4,1) both}
.open .cover{animation:turn .7s .25s cubic-bezier(.6,0,.8,.4) both}
@keyframes pop{from{transform:rotate(-20deg) scale(.2)}to{transform:rotate(10deg) scale(1)}}
@keyframes slam{from{transform:translate(-50%,-50%) rotate(-30deg) scale(.1)}to{transform:translate(-50%,-50%) rotate(-6deg) scale(1)}}
@keyframes shake{15%{transform:translateX(-12px) rotate(-2deg)}45%{transform:translateX(10px) rotate(2deg)}75%{transform:translateX(-6px)}}
@keyframes turn{to{transform:rotateY(-95deg);opacity:.2}}
@media (min-width:700px) and (max-aspect-ratio:5/4){.cover{--ai:calc(var(--w) - 69px)}.art{max-height:calc(var(--ai) * 1.1)}.cover{gap:18px;padding:12px 26px 22px}h1{font-size:84px}.mast{height:110px}.vol{font-size:18px}.price{width:76px;height:76px;font-size:15px}.price b{font-size:32px}.say{font-size:24px;padding:16px 22px;width:33%}.caption{font-size:15px}.stamp{font-size:15px}input{height:80px;font-size:54px}input::placeholder{font-size:40px}button{height:80px;font-size:44px}.oups{width:150px;height:104px;top:-104px}.oups b{font-size:36px}}
@media (min-aspect-ratio:501/400){.cover{--w:min(calc(100vw - var(--pl) - var(--pr)),1300px);max-width:1300px;display:grid;grid-template-columns:auto minmax(0,1fr);grid-template-areas:"mast mast" "art form" "foot foot";grid-template-rows:auto 1fr auto;column-gap:var(--cg);row-gap:var(--rg);padding:var(--py) var(--px) var(--pz)}.mast{height:var(--mast)}h1{font-size:calc(var(--mast) * .84)}.art{flex:none;align-self:center;min-height:0;max-height:none;aspect-ratio:4/3;width:max(150px,min(calc((100vh - var(--fv)) * 4 / 3),calc(var(--w) - var(--fh))));width:max(150px,min(calc((100dvh - var(--fv)) * 4 / 3),calc(var(--w) - var(--fh))))}.art img{object-position:50% 40%}form{align-self:center;margin-top:0}}
@media (min-aspect-ratio:501/400) and (min-height:521px){.cover{--mast:clamp(80px,13vh,120px);--py:10px;--px:30px;--pz:18px;--cg:36px;--rg:16px;--fv:calc(var(--pt) + var(--pb) + 148px + var(--mast));--fh:calc(var(--px) * 2 + var(--cg) + 317px)}.vol{top:8px;font-size:20px}.price{right:6px;top:12px;width:88px;height:88px;font-size:15px}.price b{font-size:32px}.say{font-size:clamp(20px,3.2vh,28px);padding:16px 22px;width:33%}.caption{font-size:15px}.stamp{font-size:15px}form{gap:22px}input{height:80px;font-size:54px}input::placeholder{font-size:40px}button{height:80px;font-size:44px}.oups{width:150px;height:104px;top:-104px}.oups b{font-size:36px}}
@media (min-aspect-ratio:501/400) and (max-height:520px){.cover{--mast:clamp(42px,13vh,60px);--py:6px;--px:16px;--pz:10px;--cg:20px;--rg:6px;--fv:calc(var(--pt) + var(--pb) + 48px + var(--mast));--fh:calc(var(--px) * 2 + var(--cg) + 277px)}.vol{font-size:13px;top:0}.price{top:2px;width:46px;height:46px;font-size:9px}.price b{font-size:19px}.foot{display:none}.say{font-size:15px;padding:8px 12px;width:36%}.caption{font-size:11px;bottom:-10px}form{gap:12px}.reply{padding:4px 12px}input{height:50px;font-size:34px}input::placeholder{font-size:26px}button{height:54px;font-size:30px}.oups{width:104px;height:72px;top:-62px}.oups b{font-size:24px}}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
</style></head>
<body class="${error ? 'wrong' : ''}">
<main class="cover">
<header class="mast"><span class="vol">${t('gate.issue')}</span><h1>Frenchirix</h1><span class="price"><span><b>1</b>${esc(translate(lang, 'gate.price' as TKey).replace(/^1\s*/, ''))}</span></span></header>
<section class="art">
<img src="/gate/cover.webp" width="800" height="450" alt="" decoding="async" fetchpriority="high">
<p class="caption">${t('gate.caption')}</p>
<div class="say" id="say" role="status" aria-live="polite" data-wrong="${t('gate.wrong')}" data-limited="${t('gate.limited')}">${balloon}<svg viewBox="0 0 34 40" aria-hidden="true"><path d="M2 0 L4 38 L26 0" fill="#fff" stroke="#111" stroke-width="3" stroke-linejoin="miter"/><rect x="0" y="-4" width="34" height="5.5" fill="#fff"/></svg></div>
<span class="stamp">${t('gate.stamp')}</span>
</section>
<form method="post" action="/gate" id="gate">
<input type="hidden" name="next" value="${esc(next)}">
${burstSvg('oups', '#E8303A', 5, t('gate.oups'))}
<label class="reply"><small>${t('gate.label')}</small><input name="password" type="text" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" enterkeyhint="go" aria-label="${t('gate.label')}" placeholder="${t('gate.placeholder')}" autofocus required><svg viewBox="0 0 38 36" aria-hidden="true"><path d="M30 0 L36 34 L6 0" fill="#fff" stroke="#111" stroke-width="3.5" stroke-linejoin="miter"/><rect x="0" y="-5" width="38" height="6.5" fill="#fff"/></svg></label>
<button type="submit">${t('gate.enter')}</button>
</form>
<footer class="foot" aria-hidden="true"><span>${t('gate.printed')}</span><svg viewBox="0 0 100 100"><polygon points="50,3 62,36 97,37 69,58 79,93 50,72 21,93 31,58 3,37 38,36" fill="#FFD21F" stroke="#111" stroke-width="5" stroke-linejoin="miter"/></svg></footer>
</main>
${burstSvg('paf', '#FFD21F', 9, t('gate.paf'))}
<script>
(function(){
var f=document.getElementById('gate'),say=document.getElementById('say'),inp=f.elements.password,busy=false;
var reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
// The on-screen keyboard covers the bottom of the screen without resizing the page (iOS, Android
// Chrome): once it is up, bring the field back into the visible part if the browser left it hidden.
inp.addEventListener('focus',function(){setTimeout(function(){var v=window.visualViewport,r=inp.getBoundingClientRect(),top=v?v.offsetTop:0,h=v?v.height:innerHeight;if(r.top<top||r.bottom>top+h)inp.scrollIntoView({block:'center',behavior:'smooth'})},350)});
f.addEventListener('submit',function(e){
  if(!window.fetch)return;
  e.preventDefault();if(busy)return;busy=true;
  fetch('/gate',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({password:inp.value})}).then(function(r){
    if(r.status===204){document.body.className='open';setTimeout(function(){location.replace(f.elements.next.value||'/')},reduce?0:900);return}
    document.body.className='';void document.body.offsetWidth;document.body.className='wrong';
    say.firstChild.nodeValue=r.status===429?say.getAttribute('data-limited'):say.getAttribute('data-wrong');
    inp.value='';inp.focus();busy=false;
  }).catch(function(){busy=false;f.submit()});
});
})();
</script>
</body></html>`;
  return new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}

function safeNext(v: unknown): string {
  return typeof v === 'string' && v.startsWith('/') && !v.startsWith('//') && !v.startsWith('/\\') && v.length < 512 ? v : '/';
}

/** Failed tries of a rate-limit key in the window. */
export async function failures(db: D1Database, key: string, now: number, windowMs: number): Promise<{ n: number; oldest: number | null }> {
  const r = await db
    .prepare('SELECT count(*) AS n, min(at) AS oldest FROM login_attempts WHERE key = ? AND at > ?')
    .bind(key, now - windowMs)
    .first<{ n: number; oldest: number | null }>();
  return { n: r?.n ?? 0, oldest: r?.oldest ?? null };
}

export async function recordFailure(db: D1Database, keys: string[], now: number): Promise<void> {
  await db.batch([
    ...keys.map((k) => db.prepare('INSERT INTO login_attempts (key, at) VALUES (?, ?)').bind(k, now)),
    db.prepare('DELETE FROM login_attempts WHERE at < ?').bind(now - 86_400_000),
  ]);
}

/** POST /gate: a form post (the gate page) or JSON (the app). */
export async function postGate(c: Ctx): Promise<Response> {
  const type = c.req.header('content-type') ?? '';
  const isForm = !type.includes('json');
  let password = '';
  let next = '/';
  if (isForm) {
    const form = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
    password = typeof form.password === 'string' ? form.password : '';
    next = safeNext(form.next);
  } else {
    const body = (await c.req.json().catch(() => ({}))) as { password?: unknown };
    password = typeof body.password === 'string' ? body.password : '';
  }
  const now = nowMs(c);
  const key = `g:${clientIp(c)}`;
  const f = await failures(c.env.DB, key, now, GATE_WINDOW_MS);
  if (f.n >= GATE_FAIL_LIMIT) {
    const retryAfterS = Math.max(1, Math.ceil(((f.oldest ?? now) + GATE_WINDOW_MS - now) / 1000));
    if (isForm) return gatePage(c, next, 'limited');
    return c.json({ error: 'rate-limited', retryAfterS }, 429, { 'retry-after': String(retryAfterS) });
  }
  const ok = await safeEqual(password.trim().toLowerCase(), c.env.GATE_PASSWORD.toLowerCase());
  if (!ok) {
    await recordFailure(c.env.DB, [key], now);
    if (!testMode(c.env)) await sleep(400);
    if (isForm) return gatePage(c, next, 'bad');
    return c.json({ error: 'bad-password' }, 401);
  }
  const cookie = cookieHeader(c, GATE_COOKIE, await gateToken(c.env, now), GATE_MAX_AGE_S);
  if (isForm) return new Response(null, { status: 303, headers: { location: next, 'set-cookie': cookie, 'cache-control': 'no-store' } });
  return new Response(null, { status: 204, headers: { 'set-cookie': cookie } });
}
