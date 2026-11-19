// A real local Worker for the end-to-end specs of the screens around the practices (meta.worker.spec.ts).
// Each Playwright worker gets its own `wrangler dev --local` on its own port with a fresh D1 in its
// own temporary directory, TEST_MODE on (x-test-now sets the clock). The client is built once per
// test run into a temporary directory (not app/dist, which other work may be using).
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as base, expect, type BrowserContext, type Page } from '@playwright/test';

const APP = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const BIN = join(APP, 'node_modules', '.bin');
/** First port; worker n uses BASE_PORT + n. */
const BASE_PORT = Number(process.env.E2E_META_PORT ?? 8890);
/** The e2e Worker's test-only passwords (set with --var, so the specs never depend on .dev.vars). */
export const PASSWORD = 'e2egate';
export const ADMIN_PASSWORD = 'e2e-admin-0123';

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Build the client once per test run (keyed by the runner's pid), guarded by a lock directory.
 * `dev`: a development build (NODE_ENV=development), which keeps the test hooks the journey and
 * puzzle type specs need (window.__frxPractice, window.__frxAudio, the views' data-correct attributes).
 */
async function buildOnce(dev = false): Promise<string> {
  // Builds of earlier runs whose runner is gone are deleted.
  for (const name of readdirSync(tmpdir())) {
    const m = /^frenchirix-e2e-meta-(\d+)(-dev)?$/.exec(name);
    if (!m || Number(m[1]) === process.ppid) continue;
    try {
      process.kill(Number(m[1]), 0);
    } catch {
      rmSync(join(tmpdir(), name), { recursive: true, force: true });
    }
  }
  const root = join(tmpdir(), `frenchirix-e2e-meta-${process.ppid}${dev ? '-dev' : ''}`);
  const dist = join(root, 'dist');
  const done = join(root, 'built');
  const lock = join(root, 'lock');
  mkdirSync(root, { recursive: true });
  for (;;) {
    if (existsSync(done)) return dist;
    try {
      mkdirSync(lock);
    } catch {
      // Another worker is building; a stale lock (over 10 minutes) is taken over.
      if (Date.now() - statSync(lock).mtimeMs > 600_000) rmSync(lock, { recursive: true, force: true });
      await sleep(1000);
      continue;
    }
    try {
      execFileSync(join(BIN, 'vite'), ['build', '--config', join(APP, 'e2e', 'vite.e2e.config.ts'), '--outDir', dist, '--emptyOutDir', '--logLevel', 'error'], { cwd: APP, stdio: 'inherit', env: dev ? { ...process.env, NODE_ENV: 'development' } : process.env });
      copyPublic(join(APP, 'public'), dist);
      writeFileSync(done, '');
    } finally {
      rmSync(lock, { recursive: true, force: true });
    }
  }
}

/**
 * public/ into the build, as Vite would, but tolerant: temporaries (`*.try<n>.*`) and dot files are
 * skipped, and a file that vanishes mid-copy is ignored (the export hard-links question clips into
 * public/media/q from work/app-media/q while the suite may be running).
 */
function copyPublic(from: string, to: string): void {
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from)) {
    if (/\.try\d*\./.test(name) || name.startsWith('.')) continue;
    const src = join(from, name);
    const dst = join(to, name);
    try {
      if (statSync(src).isDirectory()) copyPublic(src, dst);
      else copyFileSync(src, dst);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
  }
}

export interface MetaServer {
  base: string;
  /** The local D1 state directory (`wrangler d1 execute DB --local --persist-to <state>` reads it). */
  state: string;
  stop: () => void;
}

/** True when nothing listens on the port (on localhost, either family). */
function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.once('error', () => resolve(false));
    srv.listen({ port, host: 'localhost', exclusive: true }, () => srv.close(() => resolve(true)));
  });
}

export async function startServer(index: number, dev = false): Promise<MetaServer> {
  const dist = await buildOnce(dev);
  const state = mkdtempSync(join(tmpdir(), 'frenchirix-e2e-meta-d1-'));
  // A restarted Playwright worker gets the index of one whose wrangler may still be shutting down:
  // step past ports that are still taken.
  let port = BASE_PORT + index;
  for (let k = 1; k <= 8 && !((await portFree(port)) && (await portFree(port + 1000))); k++) port = BASE_PORT + index + 16 * k;
  execFileSync(join(BIN, 'wrangler'), ['d1', 'migrations', 'apply', 'DB', '--local', '--persist-to', state], { cwd: APP, stdio: 'ignore', env: { ...process.env, CI: '1' } });
  const args = ['dev', '--local', '--port', String(port), '--inspector-port', String(port + 1000), '--persist-to', state, '--assets', dist, '--var', 'TEST_MODE:1', '--var', 'SESSION_SECRET:e2e-meta-secret-0123456789', '--var', 'ADMIN_TOKEN:e2e-meta', '--var', `GATE_PASSWORD:${PASSWORD}`, '--var', `ADMIN_PASSWORD:${ADMIN_PASSWORD}`, '--var', 'LOCAL_DEV:', '--show-interactive-dev-session=false'];
  const child: ChildProcess = spawn(join(BIN, 'wrangler'), args, { cwd: APP, detached: true, stdio: 'ignore', env: { ...process.env, CI: '1' } });
  const base = `http://localhost:${port}`;
  const stop = () => {
    try {
      if (child.pid) process.kill(-child.pid, 'SIGTERM');
    } catch {
      // already gone
    }
    rmSync(state, { recursive: true, force: true });
  };
  // Up to three minutes: with eight Playwright workers and the puzzle types spec's Vite busy, wrangler starts slowly.
  for (let i = 0; i < 360; i++) {
    try {
      const r = await fetch(`${base}/api/health`);
      if (r.ok && ((await r.json()) as { testMode?: boolean }).testMode) return { base, state, stop };
    } catch {
      // not up yet
    }
    await sleep(500);
  }
  stop();
  throw new Error(`worker did not start on ${base} within three minutes`);
}

/** A day at 15:00 UTC (10:00 in Toronto), as the x-test-now header. */
export function at(day: string): string {
  return `${day}T15:00:00Z`;
}
export const DAY1 = '2026-11-16';
export const DAY2 = '2026-11-17';

/**
 * Makes a test account's name unique: the clock as five letters. Not digits: the name filter reads
 * digits as letters (8 is b, 0 is o), so `Gaulois808` reads « gauloisbob », which it refuses ("boob"
 * with its letters collapsed). Consonants without k spell no word the filter refuses.
 */
export function nameSuffix(): string {
  return String(Date.now() % 100000).padStart(5, '0').replace(/\d/g, (d) => 'bcdfghjmnp'[Number(d)]!);
}

/** A new browser context past the gate, with the test clock set, ready for the app. */
export async function newKid(server: MetaServer, newContext: () => Promise<BrowserContext>, day = DAY1, fresh = false): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await newContext();
  // New accounts start in English; the specs read the French interface, so ask the test worker for French.
  await ctx.setExtraHTTPHeaders({ 'x-test-now': at(day), 'x-test-language': 'fr' });
  if (fresh) return { ctx, page: await ctx.newPage() };
  const res = await ctx.request.post(`${server.base}/gate`, { data: { password: PASSWORD } });
  expect(res.status()).toBe(204);
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('frenchirix.onb.welcome', '1');
      localStorage.setItem('frx.pwa.welcomeBack', 'new'); // "Tu as déjà joué ?" answered: a new kid
      localStorage.setItem('frenchirix.onb.tip.home-quests', '1');
      localStorage.setItem('frenchirix.onb.tip.unlock-pick', '1');
      localStorage.setItem('frenchirix.onb.tip.report', '1'); // "Quelque chose ne va pas ?" (e2e/reports.worker.spec.ts shows it)
    } catch {
      // storage blocked: tips just show
    }
  });
  const page = await ctx.newPage();
  return { ctx, page };
}

/**
 * Signs the browser context in as admin through the real POST /dev/login (as the admin page's form
 * does): /dev opens, and the admin cookie also passes the school gate. Once per context.
 */
export async function signInAdmin(ctx: BrowserContext, server: MetaServer): Promise<void> {
  const res = await ctx.request.post(`${server.base}/dev/login`, { data: { password: ADMIN_PASSWORD } });
  expect(res.status(), 'admin sign-in').toBe(204);
}

/** Call the API from inside the page (its cookies and the test clock apply). */
export async function api<T = any>(page: Page, method: string, path: string, body?: unknown): Promise<{ status: number; json: T }> {
  // Right after a navigation the app may not have created its session yet: wait for it.
  for (let i = 0; i < 40; i++) {
    const r = await rawApi<T>(page, method, path, body);
    if (r.status !== 401) return r;
    await page.waitForTimeout(250);
  }
  return rawApi<T>(page, method, path, body);
}

async function rawApi<T>(page: Page, method: string, path: string, body?: unknown): Promise<{ status: number; json: T }> {
  return page.evaluate(
    async ([m, p, b]) => {
      const r = await fetch(p as string, { method: m as string, headers: { 'content-type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) });
      const text = await r.text();
      return { status: r.status, json: text ? JSON.parse(text) : null };
    },
    [method, path, body] as const,
  );
}

/** Unlock today's first n candidates through the API. */
export async function unlockViaApi(page: Page, n: number): Promise<string[]> {
  const d = await api(page, 'GET', '/api/daily');
  const ids = d.json.daily.candidates.slice(0, n).map((o: { sceneId: string }) => o.sceneId);
  for (const id of ids) expect((await api(page, 'POST', '/api/daily/unlock', { sceneId: id })).status).toBe(200);
  return ids;
}

/**
 * Start and finish a practice through the API, as if the practice screen had been played perfectly:
 * `{ kind: 'scene', sceneId }` continues the scene's started practice, or starts its due level, or a
 * replay. Returns the completion's answer with the plan, its scene and the chest of the quest it did.
 */
export async function playPracticeViaApi(page: Page, req: unknown, puzzles = 3): Promise<any> {
  const start = await api(page, 'POST', '/api/practices/start', req);
  expect(start.status).toBe(200);
  const plan = start.json.plan;
  const sceneId: string = plan.sceneId ?? plan.entries[0].sceneId;
  const outcomes = Array.from({ length: puzzles }, (_, i) => ({ puzzleId: `t${i}`, type: 'place-words', sceneId, unitIds: [], missedUnitIds: [], mistakes: 0, hints: 0, skipped: false, ms: 2000 }));
  const done = Math.max(puzzles, plan.done ?? 0);
  const progress = await api(page, 'POST', `/api/practices/${encodeURIComponent(plan.id)}/progress`, { done, total: Math.max(done, plan.total ?? 0), outcomes });
  expect(progress.status).toBe(200);
  const complete = await api(page, 'POST', `/api/practices/${encodeURIComponent(plan.id)}/complete`, { outcomes, ms: 20000 });
  expect(complete.status).toBe(200);
  return { ...complete.json, plan, sceneId, chest: complete.json.chest ?? null };
}

/** Playwright fixtures: one server per worker. */
export const test = base.extend<{ newKidPage: (day?: string, fresh?: boolean) => Promise<{ ctx: BrowserContext; page: Page }> }, { server: MetaServer; devBuild: boolean }>({
  /** `test.use({ devBuild: true })`: serve a development build of the client (test hooks on). */
  devBuild: [false, { scope: 'worker', option: true }],
  server: [
    async ({ devBuild }, use, info) => {
      const server = await startServer(info.parallelIndex, devBuild);
      await use(server);
      server.stop();
    },
    { scope: 'worker', timeout: 480_000 },
  ],
  newKidPage: async ({ server, browser, contextOptions, viewport, hasTouch, deviceScaleFactor, isMobile }, use) => {
    const made: BrowserContext[] = [];
    await use(async (day?: string, fresh = false) => {
      // The project's device (viewport, touch) must be passed on: browser.newContext does not inherit it.
      const kid = await newKid(server, () => browser.newContext({ ...contextOptions, viewport, hasTouch, deviceScaleFactor, isMobile, locale: 'fr-CA', reducedMotion: 'reduce' }), day, fresh);
      made.push(kid.ctx);
      return kid;
    });
    for (const c of made) await c.close();
  },
});
export { expect };
