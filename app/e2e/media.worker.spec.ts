// Loading media (docs/app-games.md, "Loading media"), against a real local Worker: the practice screen,
// the scene page and the karaoke screen wait behind the media gate for their audio and first frames. On a
// throttled connection the gate shows and fills by bytes, then says the connection is slow; a blocked
// file ends in the error panel with its detail line (every part of it reachable, under no bar) and
// « Réessayer » works once it is unblocked; a stall becomes the error after MEDIA_TIMEOUT_MS; a load from
// the cache shows no gate at all; a play button whose clip is still on its way is busy, never "pause" or
// "playing"; a practice fetches its clips ahead.
// Screenshots in E2E_SHOTS (default test-results/media).
import type { CDPSession, Page, Route } from '@playwright/test';
import { currentPuzzle } from './drive';
import { api, expect, signInAdmin, test, unlockViaApi } from './meta-server';
import { COMPOSER_VERSION } from '../shared/practice/version';
import { translate } from '../shared/i18n';

test.use({ devBuild: true, trace: 'off' });
test.describe.configure({ timeout: 240_000 });

const SHOTS = process.env.E2E_SHOTS ?? 'test-results/media';
const PANONO = 's01e03-0023-0026';

const gate = (page: Page) => page.locator('[data-media-gate]');
const bar = (page: Page) => page.locator('[data-media-gate] [role="progressbar"]');

/**
 * Holds the requests matching `re` until the returned release is called: the screen's code (a large
 * chunk in a dev build) loads at full speed and its gate is up before the connection is throttled.
 */
async function holdData(page: Page, re: RegExp): Promise<() => Promise<void>> {
  let hold = true;
  const held: Route[] = [];
  await page.route(re, (route) => (hold ? void held.push(route) : route.continue()));
  return async () => {
    hold = false;
    for (const r of held) await r.continue();
    await page.unroute(re);
  };
}

/** A slow connection for this page (Chromium's own throttling: the bytes really trickle in). */
async function throttle(page: Page, kbPerS: number): Promise<CDPSession> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: kbPerS * 1024, uploadThroughput: kbPerS * 1024 });
  return cdp;
}

async function unthrottle(cdp: CDPSession): Promise<void> {
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
}

/** Starts the first new scene's practice through the API and opens it as the app's start does. */
async function startPractice(page: Page): Promise<{ id: string; sceneId: string }> {
  const [sceneId] = await unlockViaApi(page, 3);
  const start = await api(page, 'POST', '/api/practices/start', { kind: 'scene', sceneId, composerVersion: COMPOSER_VERSION });
  expect(start.status).toBe(200);
  const plan = start.json.plan;
  await page.evaluate((p) => history.pushState({ plan: p, fresh: true }, '', `/practice/${p.id}`), plan);
  return { id: plan.id as string, sceneId: (plan.sceneId ?? plan.entries[0].sceneId) as string };
}

/** Samples the gate's bar until it is gone; the values it showed, in order. */
async function sampleBar(page: Page, until: () => Promise<boolean>, timeout = 90_000): Promise<number[]> {
  const seen: number[] = [];
  const end = Date.now() + timeout;
  while (Date.now() < end && !(await until())) {
    const v = await bar(page).getAttribute('aria-valuenow', { timeout: 200 }).catch(() => null);
    if (v !== null) seen.push(Number(v));
    await page.waitForTimeout(250);
  }
  return seen;
}

/** Records whether the gate's panel (not its silent first moment) ever appears from now on. */
async function watchGate(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __gateSeen: string[] };
    w.__gateSeen = [];
    const note = () => document.querySelectorAll('[data-media-gate]').forEach((el) => w.__gateSeen.push(el.getAttribute('data-media-gate') ?? ''));
    new MutationObserver(note).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-media-gate'] });
  });
}
const gateSeen = (page: Page) => page.evaluate(() => (window as unknown as { __gateSeen: string[] }).__gateSeen);

/**
 * Every part of the gate's error panel (« Réessayer », Home, the detail line, the copy button) can be
 * brought into view and is then on top: nothing (a sticky bar, the tab bar) covers it. Ends with the
 * detail line in view, for the screenshot.
 */
async function expectPanelReachable(page: Page): Promise<void> {
  const panel = page.locator('[data-media-gate="error"] [data-error-panel]');
  for (const sel of ['[data-error-retry]', '[data-error-home]', '[data-error-copy]', '[data-error-detail]']) {
    const el = panel.locator(sel);
    await el.scrollIntoViewIfNeeded();
    await page.waitForTimeout(100); // a smooth scroll settling
    const covered = await el.evaluate((node) => {
      const r = node.getBoundingClientRect();
      const pts: [number, number][] = [
        [r.left + r.width / 2, r.top + r.height / 2],
        [r.left + 4, r.top + 4],
        [r.right - 4, r.bottom - 4],
      ];
      return pts
        .map(([x, y]) => {
          if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return `(${Math.round(x)},${Math.round(y)}) outside the viewport`;
          const top = document.elementFromPoint(x, y);
          return top && (node.contains(top) || top.contains(node)) ? null : `(${Math.round(x)},${Math.round(y)}) under ${top?.outerHTML.slice(0, 80)}`;
        })
        .filter(Boolean);
    });
    expect(covered, `${sel} is covered`).toEqual([]);
  }
}

test('a practice on a slow connection: the gate fills by bytes, says it is slow, then the first puzzle; its clips are fetched ahead', async ({ server, newKidPage }, info) => {
  const { page } = await newKidPage();
  await page.goto(server.base + '/');
  await expect(page.locator('[data-home-hello]')).toBeVisible();
  const clips: string[] = [];
  page.on('request', (r) => /\/media\/(q|w)\//.test(r.url()) && clips.push(r.url()));
  const release = await holdData(page, /\/(data\/scenes|media)\//);
  await startPractice(page);
  await expect(gate(page)).toBeAttached({ timeout: 20_000 });
  const cdp = await throttle(page, 30);
  await release();
  await expect(gate(page)).toHaveAttribute('data-media-gate', 'loading', { timeout: 10_000 });
  await expect.poll(async () => Number(await bar(page).getAttribute('aria-valuenow')), { timeout: 30_000 }).toBeGreaterThan(5);
  await expect(gate(page)).toHaveAttribute('data-progress-by', 'bytes');
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-practice-gate.png` });
  await expect(page.locator('[data-media-slow]')).toBeVisible({ timeout: 15_000 });
  await expect(gate(page)).toHaveAttribute('data-media-gate', 'slow');
  await expect(page.locator('[data-media-home]')).toBeVisible(); // a way out while it keeps loading
  expect(await page.locator('[data-media-slow]').textContent()).toBe(translate('fr', 'common.media.slow'));
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-practice-slow.png` });
  const seen = await sampleBar(page, async () => (await gate(page).count()) === 0);
  expect(seen.length).toBeGreaterThan(3);
  for (let i = 1; i < seen.length; i++) expect(seen[i]!, 'the bar never runs back').toBeGreaterThanOrEqual(seen[i - 1]!);
  await currentPuzzle(page, 30_000);
  await unthrottle(cdp);
  // Fetched ahead: the practice's question, answer and alternate clips, before any puzzle plays them.
  await expect.poll(() => clips.length, { timeout: 15_000 }).toBeGreaterThan(0);
});

test('a blocked frame ends in the error panel with its detail; « Réessayer » works once it is unblocked', async ({ server, newKidPage }, info) => {
  const { page } = await newKidPage();
  await page.goto(server.base + '/');
  await expect(page.locator('[data-home-hello]')).toBeVisible();
  let blocked = true;
  await page.route(/\/media\/f\//, (route) => (blocked ? route.abort('internetdisconnected') : route.continue()));
  await startPractice(page);
  const panel = page.locator('[data-media-gate="error"] [data-error-panel]');
  await expect(panel).toBeVisible({ timeout: 20_000 });
  await expect(panel).toHaveAttribute('data-error-kind', 'offline');
  await expect(panel).toContainText(translate('fr', 'common.fail.offline'));
  expect(await panel.locator('[data-error-detail]').textContent()).toMatch(/^FRX-ERR media offline 0 GET \/media\/f\/\S+ msg="[^"]*" build=\S+ at=\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  await expect(panel.locator('[data-error-home]')).toBeVisible();
  await expectPanelReachable(page);
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-practice-error.png` });
  blocked = false;
  await panel.locator('[data-error-retry]').tap();
  await currentPuzzle(page, 30_000);
  await expect(gate(page)).toHaveCount(0);
});

test('the scene page: a stalled audio is the slow line, then the error after 25 s; « Réessayer » plays it; a second visit shows no gate', async ({ server, newKidPage }, info) => {
  const { page } = await newKidPage();
  await page.goto(server.base + '/');
  await expect(page.locator('[data-home-hello]')).toBeVisible();
  const [sceneId] = await unlockViaApi(page, 1);
  let stall = true;
  const held: Route[] = [];
  await page.route(/\/media\/a\//, (route) => (stall ? void held.push(route) : route.continue()));
  await page.evaluate((id) => history.pushState(null, '', `/scene/${id}`), sceneId);
  await expect(gate(page)).toHaveAttribute('data-media-gate', 'loading', { timeout: 10_000 });
  await expect(page.locator('[data-media-slow]')).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-scene-slow.png` });
  const panel = page.locator('[data-media-gate="error"] [data-error-panel]');
  await expect(panel).toBeVisible({ timeout: 30_000 });
  await expect(panel).toHaveAttribute('data-error-kind', 'timeout');
  expect(await panel.locator('[data-error-detail]').textContent()).toMatch(/^FRX-ERR media timeout 0 GET \/media\/a\/\S+ msg="no data for 25 s" /);
  await expectPanelReachable(page);
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-scene-error.png` });
  stall = false;
  for (const r of held) await r.abort().catch(() => {});
  await panel.locator('[data-error-retry]').tap();
  await expect(page.locator('[data-scene-player]')).toBeVisible({ timeout: 20_000 });
  // From the cache: no gate at all, not even for a moment.
  await page.evaluate(() => history.pushState(null, '', '/'));
  await expect(page.locator('[data-home-hello]')).toBeVisible();
  await watchGate(page);
  await page.evaluate((id) => history.pushState(null, '', `/scene/${id}`), sceneId);
  await expect(page.locator('[data-scene-player]')).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(600);
  // 'wait' is the gate's silent first moment (an empty box while the scene's data comes from memory).
  expect((await gateSeen(page)).filter((x) => x !== 'wait')).toEqual([]);
});

test('karaoke on a slow connection: the gate, then the song; Home’s card shows a busy button while its song loads', async ({ server, newKidPage }, info) => {
  const { page } = await newKidPage();
  await page.goto(server.base + '/');
  await expect(page.locator('[data-home-hello]')).toBeVisible();
  const index = await api(page, 'GET', '/data/index.json');
  // Home's compact card is not gated: its play button is busy (never "pause") until the song is in.
  const card = page.locator('[data-karaoke]').first();
  if (await card.waitFor({ timeout: 8000 }).then(() => true, () => false)) {
    let hold = true;
    const held: Route[] = [];
    await page.route(/\/media\/s\//, (route) => (hold ? void held.push(route) : route.continue()));
    const toggle = card.locator('[data-karaoke-toggle]');
    await toggle.scrollIntoViewIfNeeded();
    await toggle.click();
    await expect(toggle).toHaveAttribute('data-busy', 'true');
    await expect(toggle).toHaveAttribute('aria-label', translate('fr', 'common.media.busy'));
    await card.screenshot({ path: `${SHOTS}/${info.project.name}-karaoke-card-busy.png` });
    hold = false;
    for (const r of held) await r.continue();
    await expect(toggle).not.toHaveAttribute('data-busy', 'true', { timeout: 15_000 });
    await expect(toggle).toHaveAttribute('aria-label', translate('fr', 'karaoke.pause'));
    await page.unroute(/\/media\/s\//);
    await page.evaluate(() => (window as unknown as { __frxAudio: { stop(): void } }).__frxAudio.stop());
  }
  // A song not yet heard, on its own screen, on a slow connection.
  const heard = await card.getAttribute('data-karaoke').catch(() => null);
  const other: string = index.json.songs.map((x: { id: string }) => x.id).find((id: string) => id !== heard);
  const release = await holdData(page, /\/(data\/songs|media)\//);
  await page.evaluate((id) => history.pushState(null, '', `/karaoke/${id}`), other);
  await expect(gate(page)).toBeAttached({ timeout: 20_000 });
  const cdp = await throttle(page, 60);
  await release();
  await expect(gate(page)).toHaveAttribute('data-media-gate', /loading|slow/, { timeout: 10_000 });
  await expect.poll(async () => Number(await bar(page).getAttribute('aria-valuenow')), { timeout: 30_000 }).toBeGreaterThan(5);
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-karaoke-gate.png` });
  await expect(page.locator('[data-media-slow]')).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-karaoke-slow.png` });
  await expect(page.locator(`[data-karaoke="${other}"]`)).toBeVisible({ timeout: 90_000 });
  await expect(gate(page)).toHaveCount(0);
  await unthrottle(cdp);
});

test('karaoke: a blocked song ends in the error panel, all of it reachable; « Réessayer » plays it once it is unblocked', async ({ server, newKidPage }, info) => {
  const { page } = await newKidPage();
  await page.goto(server.base + '/');
  await expect(page.locator('[data-home-hello]')).toBeVisible();
  const index = await api(page, 'GET', '/data/index.json');
  const song: string = index.json.songs[0].id;
  let blocked = true;
  await page.route(/\/media\/s\//, (route) => (blocked ? route.abort('internetdisconnected') : route.continue()));
  await page.evaluate((id) => history.pushState(null, '', `/karaoke/${id}`), song);
  const panel = page.locator('[data-media-gate="error"] [data-error-panel]');
  await expect(panel).toBeVisible({ timeout: 20_000 });
  await expect(panel).toHaveAttribute('data-error-kind', 'offline');
  expect(await panel.locator('[data-error-detail]').textContent()).toMatch(/^FRX-ERR media offline 0 GET \/media\//);
  await expectPanelReachable(page);
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-karaoke-error.png` });
  blocked = false;
  await panel.locator('[data-error-retry]').tap();
  await expect(page.locator(`[data-karaoke="${song}"]`)).toBeVisible({ timeout: 30_000 });
  await expect(gate(page)).toHaveCount(0);
});

test('a question clip still on its way: the loop button is busy, never "playing"', async ({ server, newKidPage }, info) => {
  const { ctx, page } = await newKidPage();
  await signInAdmin(ctx, server);
  let hold = true;
  const held: Route[] = [];
  await page.route(/\/media\/q\//, (route) => (hold ? void held.push(route) : route.continue()));
  await page.goto(`${server.base}/dev/practice?scene=${PANONO}&type=question&level=1&seed=1`);
  await currentPuzzle(page, 30_000);
  await page.locator('h1, [data-practice]').first().click({ force: true }).catch(() => {}); // a first touch: audio unlocked
  const loop = page.locator('[data-loop]').first();
  // The question loops by itself on arrival (or on a tap of its button) and waits for its clip.
  if (!(await loop.getAttribute('data-busy'))) await loop.click();
  await expect(loop).toHaveAttribute('data-busy', 'true', { timeout: 10_000 });
  await expect(loop).toHaveAttribute('aria-label', translate('fr', 'common.media.busy'));
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-question-busy.png` });
  hold = false;
  for (const r of held) await r.continue();
  await expect(loop).not.toHaveAttribute('data-busy', 'true', { timeout: 15_000 });
  await expect(loop).toHaveAttribute('aria-pressed', 'true');
});
