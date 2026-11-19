// Installing and updating, against a real local Worker in TEST_MODE (meta-server.ts).
// The server is made to look newer than the page with the TEST_MODE-only headers `x-test-build`
// (the deployed build id) and `x-test-min-build` (the minimum client build); see worker/pwa.ts.
import type { BrowserContext, Page } from '@playwright/test';
import { api, at, DAY1, expect, test, unlockViaApi } from './meta-server';
import { COMPOSER_VERSION } from '../shared/practice/version';

test.describe.configure({ timeout: 120_000 });

/** Later than any build made today. */
const NEWER = '20991231T000000Z-fffffff';

/** Marks the current document; a reload clears the mark. */
async function mark(page: Page): Promise<void> {
  await page.evaluate(() => ((window as unknown as { __frxMark: number }).__frxMark = 1));
}
async function marked(page: Page): Promise<boolean> {
  return page.evaluate(() => (window as unknown as { __frxMark?: number }).__frxMark === 1).catch(() => false);
}

async function serverSays(ctx: BrowserContext, headers: Record<string, string>): Promise<void> {
  await ctx.setExtraHTTPHeaders({ 'x-test-now': at(DAY1), 'x-test-language': 'fr', ...headers });
}

/** Starts the first new scene's practice through the API and opens it in the app, as a quest card does. */
async function openPractice(page: Page): Promise<{ id: string; sceneId: string }> {
  const [sceneId] = await unlockViaApi(page, 3);
  const start = await api(page, 'POST', '/api/practices/start', { kind: 'scene', sceneId, composerVersion: COMPOSER_VERSION }); // as the app's start does
  expect(start.status).toBe(200);
  const plan = start.json.plan;
  await page.evaluate((p) => history.pushState({ plan: p }, '', `/practice/${p.id}`), plan);
  await expect(page).toHaveURL(/\/practice\//);
  return { id: plan.id as string, sceneId: sceneId! };
}

test('a newer build is applied on an idle screen, never in the middle of a practice', async ({ server, newKidPage }) => {
  const { ctx, page } = await newKidPage();
  await page.goto(server.base + '/');
  await expect(page.locator('[data-home-hello]')).toBeVisible();
  await openPractice(page);
  await mark(page);

  // Deploy: the server now reports a newer build; the app hears about it when the network comes back.
  await serverSays(ctx, { 'x-test-build': NEWER });
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  // It is noticed, and kept waiting while the practice runs.
  await expect(page.locator('html')).toHaveAttribute('data-frx-update', 'pending');
  await page.waitForTimeout(2500);
  expect(await marked(page)).toBe(true);
  await expect(page.getByTestId('pwa-updating')).toHaveCount(0);
  await expect(page).toHaveURL(/\/practice\//);

  // Back on Home (an idle screen): the NOUVEAU ! burst, then a reload.
  await page.evaluate(() => history.pushState(null, '', '/'));
  await expect(page.getByTestId('pwa-updating')).toBeVisible();
  await expect.poll(() => marked(page), { timeout: 10_000 }).toBe(false);
  await expect(page.locator('[data-home-hello]')).toBeVisible({ timeout: 20_000 });

  // The reloaded page is still this build (the server is pretending): no reload loop.
  await mark(page);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForTimeout(2500);
  expect(await marked(page)).toBe(true);
});

test('a client below the minimum build reloads at once and a finished practice is not lost', async ({ server, newKidPage }) => {
  const { ctx, page } = await newKidPage();
  await page.goto(server.base + '/');
  await expect(page.locator('[data-home-hello]')).toBeVisible();
  const { id: practiceId, sceneId } = await openPractice(page);
  // The kid finished every puzzle (each one saved before moving on); the completion was not sent yet.
  await expect(page.locator('[data-practice] [role="progressbar"]').first()).toBeVisible({ timeout: 30_000 });
  const total = Number(await page.locator('[data-practice] [role="progressbar"]').first().getAttribute('aria-valuemax'));
  expect(total).toBeGreaterThan(0);
  const outcomes = Array.from({ length: total }, (_, i) => ({ puzzleId: `t${i}`, type: 'watch', sceneId, unitIds: [], missedUnitIds: [], mistakes: 0, hints: 0, skipped: false, ms: 2000 }));
  expect((await api(page, 'POST', `/api/practices/${encodeURIComponent(practiceId)}/progress`, { done: total, total, outcomes })).status).toBe(200);
  await mark(page);

  // The server now refuses this build: the next API call answers 409 client-outdated.
  await serverSays(ctx, { 'x-test-min-build': '20991231T000000Z' });
  // Any API call from the app gets the 409; the check on resume (here: the network coming back) also
  // reads the minimum from GET /api/build. It reloads at once, even in a practice.
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(() => marked(page), { timeout: 15_000 }).toBe(false);
  // Reloaded but still "too old" (the server pretends): the stuck panel offers a button, no loop.
  await expect(page.getByTestId('pwa-stuck')).toBeVisible({ timeout: 20_000 });

  // The server accepts the build again (a real deploy would have served the new one): the reopened
  // practice asks the server where it stands, finds every puzzle done, and completes it, once.
  await serverSays(ctx, {});
  await page.getByTestId('pwa-stuck').getByRole('button').click();
  await expect(page.locator('[data-results]')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-already-saved]')).toHaveCount(0);
  const again = await api(page, 'POST', `/api/practices/${encodeURIComponent(practiceId)}/complete`, { outcomes, ms: 2000 });
  expect(again.json.error).toBe('practice-closed');
});

test('a code-split chunk that fails to load reloads the app once instead of a blank screen', async ({ server, newKidPage }) => {
  const { page } = await newKidPage();
  await page.goto(server.base + '/');
  await expect(page.locator('[data-home-hello]')).toBeVisible();
  await mark(page);
  // The deploy removed the old Profile chunk: the first request for it fails like a missing file.
  let failed = 0;
  await page.route(/\/assets\/Profile-[\w-]+\.js$/, async (route) => {
    if (failed++ === 0) return route.fulfill({ status: 404, body: 'not found', contentType: 'text/plain' });
    return route.continue();
  });
  await page.evaluate(() => history.pushState(null, '', '/profile'));
  await expect.poll(() => marked(page), { timeout: 15_000 }).toBe(false);
  await expect(page.getByTestId('pwa-install-button')).toBeVisible({ timeout: 20_000 });
  expect(failed).toBeGreaterThanOrEqual(2);
});

test('install files are public, the page is installable, and the build shows on /version', async ({ server, newKidPage, browser }) => {
  // Without any cookie, as the operating system fetches them.
  const anon = await browser.newContext();
  const manifest = await anon.request.get(server.base + '/manifest.webmanifest');
  expect(manifest.status()).toBe(200);
  const m = await manifest.json();
  expect(m).toMatchObject({ id: '/', start_url: '/', scope: '/', display: 'standalone', lang: 'en' });
  for (const icon of m.icons as { src: string; sizes: string }[]) {
    const r = await anon.request.get(server.base + icon.src);
    expect(r.status(), icon.src).toBe(200);
    expect(r.headers()['content-type']).toBe('image/png');
  }
  expect((await anon.request.get(server.base + '/apple-touch-icon.png')).status()).toBe(200);
  expect((await anon.request.get(server.base + '/data/index.json')).status()).toBe(401);
  await anon.close();

  const { page } = await newKidPage();
  await page.goto(server.base + '/');
  await expect(page.locator('[data-home-hello]')).toBeVisible();
  // Chromium's own installability check (the same one that decides on the install prompt).
  const cdp = await page.context().newCDPSession(page);
  const errors = (await cdp.send('Page.getInstallabilityErrors')) as { installabilityErrors: { errorId: string }[] };
  // Playwright's contexts are incognito, where Chromium never installs; anything else is a real problem.
  expect(errors.installabilityErrors.map((e) => e.errorId).filter((id) => id !== 'in-incognito')).toEqual([]);
  const got = (await cdp.send('Page.getAppManifest')) as { url: string; errors: unknown[] };
  expect(got.url).toContain('/manifest.webmanifest');
  expect(got.errors).toEqual([]);

  await page.evaluate(() => history.pushState(null, '', '/version'));
  await expect(page.getByTestId('pwa-build')).toContainText(/\d{8}T\d{6}Z-[0-9a-f]{7}/);
});

test('the installed app offers to log back in instead of starting over', async ({ server, newKidPage }) => {
  const { page } = await newKidPage();
  // Chromium cannot emulate display-mode here; iOS's own signal (navigator.standalone) stands in.
  await page.context().addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true }));
  // newKidPage answers "Tu as déjà joué ?" for every test; this one asks it, on the first load only.
  await page.context().addInitScript(() => {
    if (sessionStorage.getItem('e2e.asked')) return;
    sessionStorage.setItem('e2e.asked', '1');
    localStorage.removeItem('frx.pwa.welcomeBack');
  });
  await page.goto(server.base + '/');
  const welcome = page.getByTestId('pwa-welcome');
  await expect(welcome).toHaveAttribute('data-welcome-where', 'app', { timeout: 20_000 });
  await expect(welcome).toBeVisible({ timeout: 20_000 });
  await welcome.locator('[data-welcome-login]').click();
  await expect(page).toHaveURL(/\/login$/);
  // Once answered, never again on this device.
  await page.goto(server.base + '/');
  await expect(page.locator('[data-home-hello]')).toBeVisible();
  await expect(page.getByTestId('pwa-welcome')).toHaveCount(0);
});
