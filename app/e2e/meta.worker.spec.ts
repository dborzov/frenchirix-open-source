// End-to-end flows of the screens around the practices against a real local Worker in TEST_MODE
// (meta-server.ts starts and stops it). Runs in both projects (phone, tablet) with `npm run e2e`.
// Finishing a practice belongs to the practice shell; where a flow needs one, the test completes it
// through the API, exactly as the shell would.
import { ACHIEVEMENTS, CHEERS } from '../shared/catalog';
import { readFileSync } from 'node:fs';
import { translate } from '../shared/i18n';
import { DAILY_CANDIDATES, DAILY_UNLOCKS } from '../shared/rules';
import { api, DAY2, PASSWORD, at, expect, nameSuffix, playPracticeViaApi, test, unlockViaApi } from './meta-server';

test.describe.configure({ timeout: 120_000 });

test('first open: gate, a new account, "Déjà un compte ?" then the welcome, three scenes chosen from the choose quest', async ({ server, newKidPage }) => {
  const { page } = await newKidPage(undefined, true);
  await page.goto(server.base + '/');
  // The gate page (server-rendered, no script).
  const password = page.locator('input[type=password], input[name=password]').first();
  await expect(password).toBeVisible();
  await password.fill(PASSWORD);
  await password.press('Enter');
  // The app boots and creates an account: "Déjà un compte ?" (in the browser too), then the welcome,
  // once, and never both at once.
  const back = page.getByTestId('pwa-welcome');
  await expect(back).toBeVisible({ timeout: 20_000 });
  await expect(back).toHaveAttribute('data-welcome-where', 'browser');
  const welcome = page.getByTestId('welcome');
  await page.waitForTimeout(2000); // longer than the welcome's grace period
  await expect(welcome).toHaveCount(0);
  await back.locator('[data-welcome-new]').click();
  await expect(back).toHaveCount(0);
  await expect(welcome).toBeVisible({ timeout: 20_000 });
  await welcome.locator('[data-welcome-go]').click();
  await expect(page).toHaveURL(/\/unlock$/);
  const covers = page.getByTestId('unlock-cover');
  const picks = page.getByTestId('unlock-pick');
  await expect(picks).toHaveCount(DAILY_CANDIDATES);
  // Watch a candidate before choosing: the watch page in preview mode, with no view reported.
  const views: string[] = [];
  page.on('request', (r) => r.url().includes('/view') && views.push(r.url()));
  await page.getByTestId('unlock-watch').first().click();
  await expect(page.locator('[data-candidate]')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-practice-start]')).toHaveCount(0);
  await page.locator('[data-back-to-choice]').click();
  await expect(page).toHaveURL(/\/unlock$/);
  // Choose one from its preview: back on the choice, its card leaves the selection.
  await page.getByTestId('unlock-watch').first().click();
  await page.locator('[data-choose]').click();
  await expect(page).toHaveURL(/\/unlock$/);
  await expect(page.getByTestId('unlock')).toHaveAttribute('data-left', '2');
  await expect(covers).toHaveCount(DAILY_CANDIDATES - 1, { timeout: 10_000 });
  // The other two from the covers; the last choice sends the rest into the cauldron, then Home.
  await picks.first().click();
  await expect(page.getByTestId('unlock')).toHaveAttribute('data-left', '1');
  await expect(covers).toHaveCount(DAILY_CANDIDATES - 2, { timeout: 10_000 });
  await picks.first().click();
  await expect(page.locator(`[data-cauldron-note="${DAILY_CANDIDATES - DAILY_UNLOCKS}"]`)).toBeVisible({ timeout: 10_000 });
  await expect(page).toHaveURL(new RegExp(`${server.base}/$`), { timeout: 15_000 });
  expect(views).toEqual([]);
  const quests = page.getByTestId('quest');
  await expect(quests.first()).toHaveAttribute('data-kind', 'choose');
  await expect(quests.first()).toHaveAttribute('data-state', 'done');
  await expect(quests.nth(1)).toHaveAttribute('data-state', 'next');
  await quests.nth(1).locator('button').first().click();
  await expect(page).toHaveURL(/\/practice\//);
  const plan = await page.evaluate(() => (history.state as { plan?: { sceneId: string; level: number; replay: boolean } } | null)?.plan);
  expect(plan?.level).toBe(1);
  expect(plan?.replay).toBe(false);
  // Neither question comes back.
  await page.goto(server.base + '/');
  await expect(page.getByTestId('welcome')).toHaveCount(0);
  await expect(page.getByTestId('pwa-welcome')).toHaveCount(0);
});

test('a finished practice gives a chest, a level on the timeline, and the scene is due the next day', async ({ server, newKidPage }) => {
  const { ctx, page } = await newKidPage();
  await page.goto(server.base + '/');
  await expect(page.locator('[data-home-hello]')).toBeVisible();
  const ids = await unlockViaApi(page, 3);
  const result = await playPracticeViaApi(page, { kind: 'scene', sceneId: ids[0] });
  // Nothing was due: choose, then three bronze quests (wood, silver, gold); the first bronze one is done.
  expect(result.quest?.index).toBe(1);
  expect(result.chest?.kind).toBe('wood');

  // Home shows the chest waiting on its quest.
  await page.goto(server.base + '/');
  await page.locator('[data-testid=quest][data-index="1"] [data-quest-chest="ready"]').click();
  await expect(page).toHaveURL(/\/chest\//);
  await page.locator('[data-chest-open]').click();
  const cont = page.locator('[data-chest-continue]');
  await expect(cont).toBeVisible({ timeout: 20_000 });
  await cont.click();
  await expect(page).toHaveURL(new RegExp(`${server.base}/$`));

  // The level shows in the collection, by episode; locked scenes around it are collapsed.
  const scene: string = result.sceneId;
  expect(ids).toContain(scene);
  await page.goto(`${server.base}/episodes/${scene.slice(0, 6)}`);
  const panel = page.locator(`[data-testid=collection-scene][data-scene="${scene}"]`);
  await expect(panel).toHaveAttribute('data-level', '1');
  await expect(page.getByTestId('locked-run').first()).toBeVisible();

  // The watch page: playing it again today is a replay, for XP only.
  await panel.click();
  await expect(page.locator(`[data-scene-page="${scene}"]`)).toBeVisible();
  await expect(page.locator('[data-worth]')).toHaveAttribute('data-worth', 'replay');
  await expect(page.locator('[data-practice-start]')).toHaveAttribute('data-action', 'replay');

  // Next day: the scenes can earn their next level, Home and the watch page say so.
  await ctx.setExtraHTTPHeaders({ 'x-test-now': at(DAY2), 'x-test-language': 'fr' });
  await page.goto(server.base + '/');
  await expect(page.locator('[data-due-count="3"]')).toBeVisible();
  await expect(page.locator('[data-testid=queue-item][data-kind=due]').first()).toBeVisible();
  await page.goto(`${server.base}/scene/${scene}`);
  await expect(page.locator('[data-worth]')).toHaveAttribute('data-worth', 'level');
  await expect(page.locator('[data-worth]')).toHaveAttribute('data-to-win', '2');
});

test('changing the name: accepted, rude refused, taken refused', async ({ server, newKidPage }) => {
  const other = await newKidPage();
  await other.page.goto(server.base + '/');
  const taken = (await api(other.page, 'GET', '/api/me')).json.state.profile.name as string;

  const { page } = await newKidPage();
  await page.goto(server.base + '/profile');
  await page.locator('[data-name-change]').click();
  const input = page.locator('#profile-name');

  const save = page.locator('[data-name-save]');
  await input.fill('merde');
  await expect(page.locator('[data-name-problem="rude"]')).toBeVisible();
  await expect(save).toBeDisabled();

  await input.fill(taken);
  await save.click();
  await expect(page.locator('[data-name-problem="name-taken"]')).toBeVisible();

  const name = `Gaulois_${nameSuffix()}`;
  await input.fill(name);
  await save.click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
  expect((await api(page, 'GET', '/api/me')).json.state.profile.name).toBe(name);
});

test('log in from a second browser with the name and the secret number', async ({ server, newKidPage }) => {
  const first = await newKidPage();
  await first.page.goto(server.base + '/');
  const name = `Asterix_${nameSuffix()}`;
  expect((await api(first.page, 'PATCH', '/api/me', { name })).status).toBe(200);
  await unlockViaApi(first.page, 3);
  const pin = (await api(first.page, 'GET', '/api/me')).json.state.profile.pin as string;
  await first.page.goto(server.base + '/profile');
  for (const d of pin) await expect(first.page.locator('[class*=digit]', { hasText: d }).first()).toBeVisible();

  const second = await newKidPage();
  await second.page.goto(server.base + '/login');
  await second.page.locator('#login-name').fill(name.toLowerCase());
  for (const d of pin) await second.page.getByRole('button', { name: d, exact: true }).click();
  await expect(second.page).toHaveURL(new RegExp(`${server.base}/$`), { timeout: 10_000 });
  await expect(second.page.getByRole('heading', { name: new RegExp(name) })).toBeVisible();
  await second.page.goto(server.base + '/episodes');
  const sceneCount = ((await api(second.page, 'GET', '/data/index.json')).json as { scenes: unknown[] }).scenes.length;
  await expect(second.page.getByText(translate('fr', 'episodes.total', { n: 3, total: sceneCount }), { exact: true }).first()).toBeVisible();
});

test('a wrong number is refused kindly', async ({ server, newKidPage }) => {
  const { page } = await newKidPage();
  await page.goto(server.base + '/login');
  await page.locator('#login-name').fill('personne-ici');
  for (const d of '000') await page.getByRole('button', { name: d, exact: true }).click();
  await expect(page.locator('[data-login-error="bad-credentials"], [data-login-error="rate-limited"]')).toBeVisible();
});

test('buy an item in the shop', async ({ server, newKidPage }) => {
  const { page } = await newKidPage();
  await page.goto(server.base + '/');
  const ids = await unlockViaApi(page, 3);
  const shop = (await api(page, 'GET', '/api/shop')).json as { offers: { itemId: string; price: number; owned: number }[] };
  const cheapest = shop.offers.filter((o) => o.owned === 0).sort((a, b) => a.price - b.price)[0]!;
  // Sesterces come from quests, new levels and perfect practices: the day's three bronze quests.
  for (const sceneId of ids) {
    const money = (await api(page, 'GET', '/api/me')).json.state.currencies.sesterces as number;
    if (money >= cheapest.price) break;
    await playPracticeViaApi(page, { kind: 'scene', sceneId });
  }
  expect((await api(page, 'GET', '/api/me')).json.state.currencies.sesterces, 'enough for the cheapest item').toBeGreaterThanOrEqual(cheapest.price);
  await page.goto(server.base + '/shop');
  await page.locator(`[data-item="${cheapest.itemId}"]`).first().click();
  await page.locator('[data-buy]').click();
  await expect(page.locator('[data-toast="bought"]')).toBeVisible();
  expect((await api(page, 'GET', '/api/me')).json.state.inventory[cheapest.itemId]).toBeGreaterThanOrEqual(1);
});

test('follow a friend, send a cheer, the friend sees it in the inbox', async ({ server, newKidPage }, info) => {
  const tablet = info.project.name === 'tablet';
  const b = await newKidPage();
  await b.page.goto(server.base + '/');
  const bName = (await api(b.page, 'GET', '/api/me')).json.state.profile.name as string;

  const a = await newKidPage();
  await a.page.goto(server.base + '/friends');
  if (!tablet) await a.page.locator('[data-tab="search"]').click();
  await a.page.locator('[data-friend-search]').fill(bName);
  await a.page.locator('[data-follow="follow"]').first().click();
  await expect(a.page.locator('[data-follow="following"]')).toBeVisible();

  if (!tablet) await a.page.locator('[data-tab="friends"]').click();
  await a.page.getByRole('button', { name: new RegExp(bName) }).first().click();
  await a.page.locator(`[data-cheer="${CHEERS[0]!.id}"]`).click();
  await expect(a.page.locator('[data-toast="sent"]')).toBeVisible();

  await b.page.goto(server.base + '/friends');
  if (!tablet) await b.page.locator('[data-tab="inbox"]').click();
  await expect(b.page.locator('[data-inbox="cheer"]')).toBeVisible();
});

test('league table, achievements and the version page', async ({ server, newKidPage }) => {
  const { page } = await newKidPage();
  await page.goto(server.base + '/');
  const [first] = await unlockViaApi(page, 3);
  await playPracticeViaApi(page, { kind: 'scene', sceneId: first });

  await page.goto(server.base + '/league');
  await expect(page.locator('[data-tier="bois"]')).toBeVisible();
  await expect(page.locator('[data-me]')).toBeVisible();

  await page.goto(server.base + '/achievements');
  const earned = Object.keys((await api(page, 'GET', '/api/me')).json.state.achievements).length;
  expect(earned).toBeGreaterThan(0);
  await expect(page.getByText(translate('fr', 'achievements.count', { n: earned, total: ACHIEVEMENTS.length }), { exact: true })).toBeVisible();

  await page.goto(server.base + '/version');
  await expect(page.locator('[data-version="2.0.0"]')).toBeVisible();
  await expect(page.locator('[data-version="1.0"]')).toBeVisible();
  const order = await page.locator('li h2').allTextContents();
  const versions = JSON.parse(readFileSync(new URL('../data/versions.json', import.meta.url), 'utf8')) as { versions: { title: string }[] };
  expect(order[0]).toBe(versions.versions[0]!.title); // newest first
});

test('switch the language to English and back', async ({ server, newKidPage }) => {
  const { page } = await newKidPage();
  await page.goto(server.base + '/profile');
  // The interface's own words, whatever they are: the dictionaries decide, the test does not.
  const homeLink = page.locator('[data-nav="/"]').first();
  await page.locator('[data-option="en"]').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('heading', { name: translate('en', 'profile.title') })).toBeVisible();
  await page.reload();
  await expect(homeLink).toHaveText(translate('en', 'nav.home'));
  await page.locator('[data-option="fr"]').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  await expect(homeLink).toHaveText(translate('fr', 'nav.home'));
});

test('the Episodes tab: empty, by day, by episode with locked runs, to review; the mode is remembered', async ({ server, newKidPage }) => {
  const { page } = await newKidPage();
  await page.goto(server.base + '/episodes');
  await expect(page.locator('[data-empty-go]')).toBeVisible();

  const ids = await unlockViaApi(page, 3);
  await page.reload();
  await expect(page.locator('[role=tab][data-mode=timeline]')).toHaveAttribute('aria-selected', 'true');
  const today = page.getByTestId('unlock-day').first();
  await expect(today).toHaveAttribute('data-today', 'true');
  await expect(today.getByTestId('collection-scene')).toHaveCount(3);

  await page.locator('[role=tab][data-mode=episodes]').click();
  await expect(page.getByTestId('episode-section')).toHaveCount(5);
  // 203 scenes, 3 unlocked: everything else is in collapsed runs, never 200 panels.
  await expect(page.getByTestId('collection-scene')).toHaveCount(3);
  const runs = await page.getByTestId('locked-run').count();
  expect(runs).toBeGreaterThanOrEqual(3);
  expect(runs).toBeLessThanOrEqual(5 + 3);

  await page.reload();
  await expect(page.locator('[role=tab][data-mode=episodes]')).toHaveAttribute('aria-selected', 'true');
  await page.locator('[role=tab][data-mode=review]').click();
  await expect(page.getByTestId('collection-scene')).toHaveCount(3);
  await page.getByTestId('collection-scene').first().click();
  await expect(page).toHaveURL(new RegExp(`/scene/(${ids.join('|')})$`));
});

test('the watch page refuses a locked scene that is not a candidate', async ({ server, newKidPage }) => {
  const { page } = await newKidPage();
  await page.goto(server.base + '/');
  const candidates = (await api(page, 'GET', '/api/daily')).json.daily.candidates.map((o: { sceneId: string }) => o.sceneId) as string[];
  const index = (await api(page, 'GET', '/data/index.json')).json as { scenes: { id: string }[] };
  const other = index.scenes.find((x) => !candidates.includes(x.id))!.id;
  await page.goto(`${server.base}/scene/${other}`);
  await expect(page.locator('[data-scene-page="locked"]')).toBeVisible();
  await page.goto(`${server.base}/scene/${candidates[0]}`);
  await expect(page.locator('[data-candidate]')).toBeVisible({ timeout: 15_000 });
});

test('a practice under way: its quest and the queue show its progress, the scene page continues it', async ({ server, newKidPage }) => {
  const { page } = await newKidPage();
  await page.goto(server.base + '/');
  const ids = await unlockViaApi(page, 3);
  const start = await api(page, 'POST', '/api/practices/start', { kind: 'scene', sceneId: ids[0] });
  expect(start.status).toBe(200);
  const plan = start.json.plan;
  expect(plan.sceneId).toBe(ids[0]);
  const outcomes = [0, 1, 2].map((i) => ({ puzzleId: `t${i}`, type: 'place-words', sceneId: plan.sceneId, unitIds: [], missedUnitIds: [], mistakes: 0, hints: 0, skipped: false, ms: 2000 }));
  expect((await api(page, 'POST', `/api/practices/${plan.id}/progress`, { done: 3, total: 30, outcomes })).status).toBe(200);

  await page.goto(server.base + '/');
  const next = page.locator('[data-testid=quest][data-state=next]');
  await expect(next).toHaveAttribute('data-scene', plan.sceneId);
  await expect(next).toHaveAttribute('data-reason', 'new');
  await expect(next.locator('[data-practice-progress="3/30"]')).toBeVisible();
  const first = page.getByTestId('queue-item').first();
  await expect(first).toHaveAttribute('data-kind', 'continue');
  await expect(first).toHaveAttribute('data-scene', plan.sceneId);

  await page.goto(`${server.base}/scene/${plan.sceneId}`);
  const action = page.locator('[data-practice-start]');
  await expect(action).toHaveAttribute('data-action', 'continue');
  await expect(page.locator('[data-practice-progress="3/30"]').first()).toBeVisible();
  await expect(page.getByTestId('level-ladder').locator('[data-rung="1"]')).toBeVisible();

  // Finishing it does its quest, with its chest.
  const done = await api(page, 'POST', `/api/practices/${plan.id}/complete`, { outcomes, ms: 20000 });
  expect(done.json.quest?.index).toBe(1);
  await page.goto(server.base + '/');
  await expect(page.locator('[data-testid=quest][data-index="1"]')).toHaveAttribute('data-state', 'done');
  await expect(page.locator('[data-testid=quest][data-index="1"] [data-quest-chest="ready"]')).toBeVisible();
});
