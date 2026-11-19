// The Worker: runs first on every request (run_worker_first). The gate comes first; then the JSON API;
// everything else falls through to the static assets (the client build plus the exported bundle).
// Areas: gate.ts, session.ts (accounts), me.ts, daily.ts, practices.ts, rewards.ts (chests, shop, views,
// counters), social.ts, league.ts, speech.ts, karaoke.ts (karaoke recordings), activity.ts (the activity
// log, reports, the daily purge).
// See docs/app-server.md.
import { Hono } from 'hono';
import { activityRoutes, logNow, purgeActivity } from './activity';
import { adminPage, hasAdminCookie, isDevPath, isLocalDev, postAdminLogin } from './admin';
import { dailyRoutes } from './daily';
import type { AppEnv, Env } from './env';
import { gatePage, gatePublicFile, hasGate, isNavigation, postGate } from './gate';
import { karaokeRoutes, purgeTakes } from './karaoke';
import { leagueRoutes } from './league';
import { practiceRoutes } from './practices';
import { meRoutes } from './me';
import { appPublicFile, buildInfo, isCurrentContentVersion, refuseOutdated, stampBuild } from './pwa';
import { rewardRoutes } from './rewards';
import { requireSession, sessionRoutes } from './session';
import { socialRoutes } from './social';
import { speechRoutes } from './speech';
import { HttpError, errorBody } from './util';

export type { Env, AppEnv } from './env';

const app = new Hono<AppEnv>();

// Every response says which build is deployed (x-frx-build): a running client notices a new release.
app.use('*', stampBuild);

// Every 5xx is also written to the activity log (worker/activity.ts).
app.onError(async (e, c) => {
  const where = { method: c.req.method, path: new URL(c.req.url).pathname };
  if (e instanceof HttpError) {
    if (e.retryAfterS !== undefined) c.header('retry-after', String(e.retryAfterS));
    if (e.status >= 500) await logNow(c, 'server-error', { status: e.status, code: e.code, message: e.message.slice(0, 300), ...where });
    return c.json(errorBody(e), e.status as 400);
  }
  console.error(e);
  const message = String((e as Error)?.message ?? e);
  await logNow(c, 'server-error', { status: 500, code: 'internal', message: message.slice(0, 300), ...where });
  return c.json({ error: 'internal', message }, 500);
});

// Outside the gate: a liveness probe.
app.get('/api/health', (c) => c.json({ ok: true, testMode: c.env.TEST_MODE !== '' }));
app.post('/gate', postGate);
// The gate page's own cover image and fonts: an exact allow-list (GATE_PUBLIC_FILES), nothing else.
app.use('/gate/*', async (c, next) => (await gatePublicFile(c)) ?? next());
// What the system fetches to install the app (manifest, icons, favicon): an exact allow-list (APP_PUBLIC_FILES).
app.use('*', async (c, next) => (await appPublicFile(c)) ?? next());

// /dev in production: the admin password, once per browser (worker/admin.ts). Locally: nothing.
app.post('/dev/login', postAdminLogin);
app.use('*', async (c, next) => {
  const url = new URL(c.req.url);
  if (!isDevPath(url.pathname) || isLocalDev(c) || (await hasAdminCookie(c))) return next();
  if (isNavigation(c)) return adminPage(url.pathname + url.search, null);
  return c.json({ error: 'gate', message: 'admin only' }, 401);
});

// The gate. Locally (LOCAL_DEV on localhost) and for an admin there is none.
app.use('*', async (c, next) => {
  if (isLocalDev(c) || (await hasGate(c)) || (await hasAdminCookie(c))) return next();
  if (isNavigation(c)) {
    const url = new URL(c.req.url);
    return gatePage(c, url.pathname + url.search, null);
  }
  return c.json({ error: 'gate' }, 401);
});

// What is deployed (no session needed), then the minimum-client rule for every other API call.
app.get('/api/build', buildInfo);
app.use('/api/*', refuseOutdated);

// The API.
const api = new Hono<AppEnv>();
api.route('/', sessionRoutes);
api.route('/', activityRoutes); // with or without a session
api.use('*', requireSession);
for (const r of [meRoutes, dailyRoutes, practiceRoutes, rewardRoutes, socialRoutes, leagueRoutes, speechRoutes, karaokeRoutes]) api.route('/', r);
app.route('/api', api);
app.all('/api/*', (c) => c.json({ error: 'not-found' }, 404));

// Static assets with cache headers: versioned data and media are immutable, the shell is revalidated.
app.all('*', async (c) => {
  const res = await c.env.ASSETS.fetch(c.req.raw);
  const url = new URL(c.req.url);
  const p = url.pathname;
  const type = res.headers.get('content-type') ?? '';
  let cache: string;
  // A hashed chunk that is gone (an old page after a deploy) must fail as a 404, not get index.html.
  if (p.startsWith('/assets/') && type.includes('text/html')) return new Response('not found', { status: 404, headers: { 'cache-control': 'no-store' } });
  if (!res.ok) cache = 'no-store';
  else if (type.includes('text/html')) cache = 'no-cache';
  else if (p.startsWith('/assets/')) cache = 'private, max-age=31536000, immutable'; // hashed by vite
  else if ((p.startsWith('/data/') || p.startsWith('/media/')) && url.searchParams.has('v'))
    // Immutable only under the deployed content version: an old page asking with its old version gets
    // today's file, which must not be cached under the old name.
    cache = (await isCurrentContentVersion(c.env, url.searchParams.get('v')!)) ? 'private, max-age=31536000, immutable' : 'no-store';
  else if (p === '/data/index.json') cache = 'no-cache';
  else if (p.startsWith('/data/') || p.startsWith('/media/')) cache = 'private, max-age=604800';
  else cache = 'private, max-age=3600';
  const out = new Response(res.body, res);
  out.headers.set('cache-control', cache);
  return out;
});

export { app };

export default {
  fetch: app.fetch,
  // The daily cron trigger (wrangler.jsonc): activity rows older than 180 days go, and karaoke takes
  // checked but never saved after a day; reports are kept.
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(
      Promise.all([purgeActivity(env, controller.scheduledTime), purgeTakes(env, controller.scheduledTime)]).then(([activity, takes]) => console.log(JSON.stringify({ purge: { activity, takes } }))),
    );
  },
} satisfies ExportedHandler<Env>;
