// Installing and updating (docs/app-release.md, "Installing" and "Updates"):
// - the files the operating system fetches to install the app, served without the gate cookie
//   (an exact allow-list, like GATE_PUBLIC_FILES): a browser fetches the manifest without cookies;
// - the build id: read from dist/build.json (written by the Vite build), sent on every response in
//   `x-frx-build`, and answered by GET /api/build;
// - the minimum client rule: an API call from a client built before MIN_CLIENT_BUILD gets
//   `409 client-outdated`, which the client always answers by reloading;
// - the content version: a /data or /media URL whose `?v=` is not the deployed content version is
//   served `no-store`, so an old client never caches new files under its old version (or the reverse).
//
// TEST_MODE only: `x-test-build` replaces the deployed build id and `x-test-min-build` the minimum,
// so the end-to-end tests can make the server look newer than the page.
import type { Context, Next } from 'hono';
import { BUILD_HEADER, MIN_CLIENT_BUILD, isClientTooOld, type BuildInfo } from '../shared/build';
import { getContent } from './content';
import type { AppEnv, Env } from './env';
import { testMode } from './util';

type Ctx = Context<AppEnv>;

/** Path -> content type. Exact paths only; nothing else is reachable without the gate. */
export const APP_PUBLIC_FILES: ReadonlyMap<string, string> = new Map([
  ['/manifest.webmanifest', 'application/manifest+json'],
  ['/favicon.svg', 'image/svg+xml'],
  ['/favicon.ico', 'image/x-icon'],
  ['/apple-touch-icon.png', 'image/png'],
  ['/icons/icon-192.png', 'image/png'],
  ['/icons/icon-512.png', 'image/png'],
  ['/icons/maskable-192.png', 'image/png'],
  ['/icons/maskable-512.png', 'image/png'],
]);

/** Serves one allow-listed install file through ASSETS, or null when the path is not on the list. */
export async function appPublicFile(c: Ctx): Promise<Response | null> {
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') return null;
  const url = new URL(c.req.url);
  const type = APP_PUBLIC_FILES.get(url.pathname);
  if (!type) return null;
  const res = await c.env.ASSETS.fetch(new Request(new URL(url.pathname, url.origin), { method: c.req.method }));
  // The SPA fallback answers a missing file with index.html: that is a 404 here.
  if (!res.ok || (res.headers.get('content-type') ?? '').includes('text/html')) {
    return new Response('not found', { status: 404, headers: { 'cache-control': 'no-store' } });
  }
  const out = new Response(res.body, res);
  out.headers.set('content-type', type);
  // The manifest is revalidated so a change reaches installed apps; icons may be kept a day.
  out.headers.set('cache-control', url.pathname === '/manifest.webmanifest' ? 'no-cache' : 'public, max-age=86400');
  return out;
}

// ---- build id ------------------------------------------------------------------------------------

let deployed: Promise<string> | null = null;

/** The deployed build id, from dist/build.json (once per isolate); 'dev' when there is none. */
export function deployedBuild(env: Env): Promise<string> {
  deployed ??= env.ASSETS.fetch(new Request('https://assets.local/build.json'))
    .then(async (res) => {
      if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return 'dev';
      const j = (await res.json()) as { build?: unknown };
      return typeof j.build === 'string' && j.build ? j.build : 'dev';
    })
    .catch(() => 'dev');
  return deployed;
}

/** The server's build id for this request (TEST_MODE may override it per request). */
export async function serverBuild(c: Ctx): Promise<string> {
  if (testMode(c.env)) {
    const t = c.req.header('x-test-build');
    if (t) return t;
  }
  return deployedBuild(c.env);
}

function minClientBuild(c: Ctx): string {
  if (testMode(c.env)) {
    const t = c.req.header('x-test-min-build');
    if (t !== undefined) return t;
  }
  return MIN_CLIENT_BUILD;
}

/** Middleware for every request: stamps the build id on the response. */
export async function stampBuild(c: Ctx, next: Next): Promise<void> {
  await next();
  try {
    c.res.headers.set(BUILD_HEADER, await serverBuild(c));
  } catch {
    // immutable headers (a passed-through response): rebuild it
    const res = new Response(c.res.body, c.res);
    res.headers.set(BUILD_HEADER, await serverBuild(c));
    c.res = res;
  }
}

/** Middleware for /api/*: refuses calls from a client build older than the minimum. */
export async function refuseOutdated(c: Ctx, next: Next): Promise<Response | void> {
  if (isClientTooOld(c.req.header(BUILD_HEADER), minClientBuild(c))) {
    return c.json({ error: 'client-outdated', message: 'reload: this client build is too old' }, 409, { 'cache-control': 'no-store' });
  }
  return next();
}

/** GET /api/build: what is deployed. Behind the gate, no session needed. */
export async function buildInfo(c: Ctx): Promise<Response> {
  let content: string | null = null;
  try {
    content = (await getContent(c.env)).index.version;
  } catch {
    // no bundle (worker tests without a build)
  }
  const body: BuildInfo = { build: await serverBuild(c), minClient: minClientBuild(c), content };
  return c.json(body, 200, { 'cache-control': 'no-store' });
}

/** True when a `?v=` on a /data or /media URL names the content version that is deployed. */
export async function isCurrentContentVersion(env: Env, v: string): Promise<boolean> {
  try {
    return (await getContent(env)).index.version === v;
  } catch {
    return false;
  }
}

/** Tests: forget the build id read from ASSETS. */
export function resetBuildForTests(): void {
  deployed = null;
}
