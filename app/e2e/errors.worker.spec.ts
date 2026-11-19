// When an API call fails (docs/app-architecture.md, "Errors"), against a real local Worker in TEST_MODE:
// a progress save that fails shows the error panel over the continue bar with the admin's detail
// line, and « Réessayer » saves and moves on; a failed load shows the panel in place and « Réessayer »
// loads again; a practice finished in one page and played on in another shows the results as already
// saved, then the fresh Home, and the back button never replays it; switching player on a shared device
// (the player selection: a new player, back by a tap, a renamed account, removing one); a device that
// remembers its players but lost its session: "Who's playing?", a tap logs in, and no first-open welcome.
// Screenshots of the panels go to E2E_SHOTS (default test-results/errors).
import type { Page, Route } from '@playwright/test';
import { currentPuzzle, playPuzzle, puzzleInfo, settled, type Kid } from './drive';
import { api, at, DAY1, expect, nameSuffix, PASSWORD, test, unlockViaApi } from './meta-server';
import { COMPOSER_VERSION } from '../shared/practice/version';
import { translate } from '../shared/i18n';

test.use({ devBuild: true, trace: 'off' });
test.describe.configure({ timeout: 240_000 });

const SHOTS = process.env.E2E_SHOTS ?? 'test-results/errors';

/** Starts the first new scene's practice through the API and opens it as a link would (the screen asks the server). */
async function openPractice(page: Page): Promise<{ id: string; sceneId: string }> {
  const [sceneId] = await unlockViaApi(page, 3);
  const start = await api(page, 'POST', '/api/practices/start', { kind: 'scene', sceneId, composerVersion: COMPOSER_VERSION }); // as the app's start does
  expect(start.status).toBe(200);
  const plan = start.json.plan;
  await page.evaluate((p) => history.pushState({ plan: p }, '', `/practice/${p.id}`), plan);
  await expect(page).toHaveURL(/\/practice\//);
  await currentPuzzle(page, 30_000);
  return { id: plan.id as string, sceneId: (plan.sceneId ?? plan.entries[0].sceneId) as string };
}

/** Holds the practice's progress saves until the test answers them. */
async function holdSaves(page: Page): Promise<Route[]> {
  const held: Route[] = [];
  await page.route(/\/api\/practices\/[^/]+\/progress$/, (route) => void held.push(route));
  return held;
}

async function shoot(page: Page, name: string, project: string): Promise<void> {
  await settled(page); // the panel's slam-in
  await page.screenshot({ path: `${SHOTS}/${project}-${name}.png` });
}

test('a progress save that fails: the panel over the continue bar, the detail line, « Réessayer » saves and moves on', async ({ server, newKidPage }, info) => {
  const { ctx, page } = await newKidPage();
  await page.goto(server.base + '/');
  await expect(page.locator('[data-home-hello]')).toBeVisible();
  const practice = await openPractice(page);
  const kid: Kid = { ctx, page, headers: { 'x-test-now': at(DAY1) } };
  const held = await holdSaves(page);
  const first = await playPuzzle(kid, { leaveDone: true });
  await expect.poll(() => held.length, { timeout: 10_000 }).toBe(1);
  // « Continuer » while the save is under way: nothing moves, the button says it is busy.
  const next = page.locator('[data-continue] [data-next]');
  await next.tap();
  await expect(next).toHaveAttribute('aria-busy', 'true');
  expect((await puzzleInfo(page))?.puzzleId).toBe(first.puzzleId);
  // The server stumbles.
  await held[0]!.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'internal', message: 'test: D1 hiccup' }) });
  const panel = page.locator('[data-save-failed] [data-error-panel]');
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute('data-error-kind', 'server');
  await expect(panel).toContainText(translate('fr', 'common.fail.server'));
  const detail = (await panel.locator('[data-error-detail]').textContent()) ?? '';
  expect(detail).toMatch(new RegExp(`^FRX-ERR server 500 POST /api/practices/${practice.id}/progress code=internal msg="test: D1 hiccup" build=\\S+ at=\\d{4}-\\d\\d-\\d\\dT\\d\\d:\\d\\d:\\d\\dZ$`));
  await expect(page.locator('[data-continue] [data-next]')).toHaveCount(0);
  expect((await puzzleInfo(page))?.puzzleId, 'not moved on before the save').toBe(first.puzzleId);
  expect((await api(page, 'GET', '/api/me')).json.state.practices[practice.sceneId]?.done ?? 0).toBe(0);
  await shoot(page, 'save-failed', info.project.name);
  if (info.project.name === 'tablet') {
    await page.setViewportSize({ width: 768, height: 1024 }); // an iPad in portrait
    await shoot(page, 'save-failed-portrait', info.project.name);
    await page.setViewportSize({ width: 1024, height: 768 });
  }
  // « Réessayer »: saved this time, and on to the next puzzle.
  await page.unroute(/\/api\/practices\/[^/]+\/progress$/);
  await page.locator('[data-error-retry]').tap();
  await expect.poll(async () => (await puzzleInfo(page))?.puzzleId ?? first.puzzleId, { timeout: 15_000 }).not.toBe(first.puzzleId);
  await expect(panel).toHaveCount(0);
  expect((await api(page, 'GET', '/api/me')).json.state.practices[practice.sceneId]?.done).toBe(1);
});

test('a failed load shows the panel in place; « Réessayer » loads again', async ({ server, newKidPage }, info) => {
  const { page } = await newKidPage();
  await page.goto(server.base + '/');
  await expect(page.locator('[data-home-hello]')).toBeVisible();
  // Every try fails until the test lets them through (a dev build runs each load twice: StrictMode).
  let offline = true;
  await page.route(/\/api\/shop$/, (route) => (offline ? route.abort('internetdisconnected') : route.continue()));
  await page.evaluate(() => history.pushState(null, '', '/shop'));
  const panel = page.locator('[data-error-panel="page"]');
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await expect(panel).toHaveAttribute('data-error-kind', 'offline');
  await expect(panel.locator('[data-error-detail]')).toContainText(/^FRX-ERR offline 0 GET \/api\/shop /);
  await shoot(page, 'load-failed', info.project.name);
  offline = false;
  await panel.locator('[data-error-retry]').tap();
  await expect(panel).toHaveCount(0);
  await expect(page.getByTestId('shop')).toBeVisible();
});

test('a practice finished in one page and played on in another: already saved, the fresh Home, never replayed', async ({ server, newKidPage }, info) => {
  const { ctx, page } = await newKidPage();
  await page.goto(server.base + '/');
  await expect(page.locator('[data-home-hello]')).toBeVisible();
  const practice = await openPractice(page);
  const total = Number(await page.locator('[data-practice] [role="progressbar"]').first().getAttribute('aria-valuemax'));
  expect(total).toBeGreaterThan(1);

  // Another tab of the same kid finishes the practice meanwhile.
  const other = await ctx.newPage();
  await other.goto(server.base + '/');
  const outcomes = Array.from({ length: total }, (_, i) => ({ puzzleId: `t${i}`, type: 'place-words', sceneId: practice.sceneId, unitIds: [], missedUnitIds: [], mistakes: 0, hints: 0, skipped: false, ms: 2000 }));
  expect((await api(other, 'POST', `/api/practices/${practice.id}/progress`, { done: total, total, outcomes })).status).toBe(200);
  expect((await api(other, 'POST', `/api/practices/${practice.id}/complete`, { outcomes, ms: 30000 })).status).toBe(200);
  await other.close();

  // This page plays on: its save answers practice-closed; the results say "already saved", no « Oups ».
  const kid: Kid = { ctx, page, headers: { 'x-test-now': at(DAY1) } };
  const held = await holdSaves(page);
  await playPuzzle(kid, { leaveDone: true });
  await expect.poll(() => held.length, { timeout: 10_000 }).toBe(1);
  await held[0]!.continue();
  await page.unroute(/\/api\/practices\/[^/]+\/progress$/);
  await expect(page.locator('[data-results] [data-already-saved]')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-error-panel]')).toHaveCount(0);
  await shoot(page, 'already-saved', info.project.name);
  await page.locator('[data-results-continue]').tap();
  await expect(page).toHaveURL(new RegExp(`${server.base}/$`), { timeout: 15_000 });
  // The fresh state: the scene passed at bronze, nothing left to continue on it.
  const item = page.locator(`[data-testid="queue-item"][data-scene="${practice.sceneId}"]`);
  await expect(item).toHaveAttribute('data-kind', 'later', { timeout: 15_000 });
  await expect(page.locator('[data-note-pin]')).toBeVisible(); // the first passed practice: note your name and PIN

  // The back button to the finished practice: the server is asked, it says so, and Home again.
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`${server.base}/$`), { timeout: 15_000 });
  await expect(page.locator('[data-toast="practice-closed"]')).toBeVisible();
  await expect(page.locator('[data-puzzle]')).toHaveCount(0);
});

test('switching player on a shared device: a new player, back by a tap, a renamed account by name and PIN, removing one', async ({ server, newKidPage }, info) => {
  const { page } = await newKidPage();
  const me = async () => (await api(page, 'GET', '/api/me')).json.state.profile as { id: string; name: string; pin: string };
  const tile = (name: string) => page.locator(`[data-player="${name}"]`);
  const openPlayers = async () => {
    await page.goto(server.base + '/players');
    await expect(page.locator('[data-players]')).toBeVisible({ timeout: 20_000 });
  };
  await page.goto(server.base + '/');
  await expect(page.locator('[data-home-hello]')).toBeVisible();
  await unlockViaApi(page, 1); // something worth coming back to
  const first = await me();
  // The profile's « Changer de joueur »: the player selection, this kid playing now.
  await page.goto(server.base + '/profile');
  await page.locator('[data-switch-player]').tap();
  await expect(page).toHaveURL(/\/players$/);
  await expect(tile(first.name)).toHaveAttribute('data-current', 'true');
  await shoot(page, 'players', info.project.name);
  // « Nouveau joueur »: a new kid, not asked whether they played before (they just said so).
  await page.locator('[data-players-new]').tap();
  await expect(page).toHaveURL(new RegExp(`${server.base}/$`));
  await expect.poll(async () => (await me()).id, { timeout: 15_000 }).not.toBe(first.id);
  const empty = await me();
  await expect(page.getByTestId('pwa-welcome')).toHaveCount(0);
  // Back to the first kid by a tap, no typing; the new kid held nothing, so the server deleted it and
  // the device forgot it.
  await openPlayers();
  await expect(tile(empty.name)).toHaveAttribute('data-current', 'true');
  await tile(first.name).tap();
  await expect(page).toHaveURL(new RegExp(`${server.base}/$`), { timeout: 15_000 });
  expect((await me()).id).toBe(first.id);
  await openPlayers();
  await expect(page.locator('[data-player]')).toHaveCount(1);
  // A second kid who plays, then back and forth.
  await page.locator('[data-players-new]').tap();
  await expect.poll(async () => (await me()).id, { timeout: 15_000 }).not.toBe(first.id);
  await unlockViaApi(page, 1);
  const second = await me();
  await openPlayers();
  await tile(first.name).tap();
  await expect.poll(async () => (await me()).id, { timeout: 15_000 }).toBe(first.id);
  await openPlayers();
  await expect(page.locator('[data-player]')).toHaveCount(2);
  // The second kid renamed on another device: the stored name no longer works; the login, prefilled,
  // says so, and the new name (typed with a space) and the PIN open the account.
  const elsewhere = await newKidPage();
  await elsewhere.page.goto(server.base + '/');
  await api(elsewhere.page, 'GET', '/api/me'); // its own kid first, so the app's start does not race the login
  expect((await api(elsewhere.page, 'POST', '/api/login', { name: second.name, pin: second.pin, timeZone: 'UTC' })).status).toBe(200);
  const renamed = `Barde_${nameSuffix()}-bis`;
  expect((await api(elsewhere.page, 'PATCH', '/api/me', { name: renamed })).status).toBe(200);
  await tile(second.name).tap();
  await expect(page).toHaveURL(/\/login\?name=.*stale=1/, { timeout: 15_000 });
  await expect(page.locator('#login-name')).toHaveValue(second.name);
  await expect(page.locator('[data-login-error="stale"]')).toBeVisible();
  await page.locator('#login-name').fill(renamed.replace(/-/g, ' '));
  for (const d of second.pin) await page.getByRole('button', { name: d, exact: true }).tap();
  await expect(page).toHaveURL(new RegExp(`${server.base}/$`), { timeout: 15_000 });
  expect((await me()).id).toBe(second.id);
  await openPlayers();
  await expect(tile(renamed)).toHaveAttribute('data-current', 'true');
  await expect(tile(second.name)).toHaveCount(0);
  // Removing the first kid from this device shows its name and PIN first.
  await page.locator(`[data-player-remove="${first.name}"]`).tap();
  const remove = page.locator('[data-remove]');
  await expect(remove).toContainText(first.name);
  await expect(remove).toContainText(first.pin);
  await shoot(page, 'players-remove', info.project.name);
  await remove.locator('[data-remove-go]').tap();
  await expect(tile(first.name)).toHaveCount(0);
  await openPlayers();
  await expect(page.locator('[data-player]')).toHaveCount(1);
});

test('a device that remembers its players, without a session: "Who\'s playing?", a tap logs in, no first-open welcome', async ({ server, newKidPage }) => {
  const { page } = await newKidPage();
  await page.goto(server.base + '/');
  await expect(page.locator('[data-home-hello]')).toBeVisible();
  await unlockViaApi(page, 1); // a kid who played
  const kid = (await api(page, 'GET', '/api/me')).json.state.profile as { id: string; name: string };
  await page.goto(server.base + '/profile'); // the device remembers the kid once the app has shown them
  await expect(page.locator('[data-switch-player]')).toBeVisible({ timeout: 20_000 });
  const remembered = await page.evaluate(() => localStorage.getItem('frx.accounts'));
  expect(remembered, 'the device remembers the kid').toContain(kid.id);
  // The same device with its cookies gone (a school profile wiped at night): a new empty account boots,
  // and the first open asks who is playing, with the remembered kid's tile.
  const device = await newKidPage(DAY1, true);
  expect((await device.ctx.request.post(`${server.base}/gate`, { data: { password: PASSWORD } })).status()).toBe(204);
  await device.page.addInitScript((v) => localStorage.setItem('frx.accounts', v), remembered!);
  await device.page.goto(server.base + '/');
  await expect(device.page.locator('[data-welcome-pick]')).toBeVisible({ timeout: 20_000 });
  await device.page.locator(`[data-player="${kid.name}"]`).tap();
  await expect.poll(async () => (await api(device.page, 'GET', '/api/me')).json.state.profile.id, { timeout: 15_000 }).toBe(kid.id);
  // Home, as that kid: the welcome for a first open ("Let's go" to the candidates) is not theirs.
  await expect(device.page).toHaveURL(new RegExp(`${server.base}/$`));
  await expect(device.page.locator('[data-home-hello]')).toBeVisible();
  await device.page.waitForTimeout(2500); // longer than the welcome's grace period (onboarding/index.tsx)
  await expect(device.page.getByTestId('welcome')).toHaveCount(0);
});
