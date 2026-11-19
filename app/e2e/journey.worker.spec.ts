import { readFileSync } from 'node:fs';
// The whole journey of a kid through the daily quests, in the real interface, against a real local
// Worker in TEST_MODE (meta-server.ts, a development build so drive.ts can read the right moves):
// first open ("Déjà un compte ?", then the welcome, never both at once); choosing from the choose
// quest: one scene from its preview, back Home, two more, the rest into the cauldron by themselves;
// the first bronze practice from its quest card, its chest, a light streak; leaving a practice in the
// middle and continuing it from its quest card in a second browser logged into the same account; a
// practice composed by an older composer, recomposed and resumed by count; the next day (x-test-now):
// due quests locking the choose quest (Home, the candidates screen, 409 choose-locked), a level passed
// across days (bronze, then silver), choosing once they are done, the last quest making a full streak,
// "Do more" drawing fresh candidates and extra quests; a replay for XP only; speaking inside real
// practices (a pass by the scorer, a pass by the judge, misses then the automatic third-try pass,
// recognition unavailable); mute; the hint bubble's four rules and the playback bar in two puzzle
// types and on the scene page; every release scene in the bundle; a kid with everything unlocked.
// Both sizes. Practices are driven through drive.ts and data- attributes, never copy. The speaking
// panel's other paths (microphone denied, "Je ne peux pas parler") are in speaking.worker.spec.ts.
import type { Browser, Locator, Page } from '@playwright/test';
import { COMPOSER_VERSION } from '../shared/practice/version';
import { DAILY_CANDIDATES } from '../shared/rules';
import { audioState, checkHintRules, checkSeek, currentPuzzle, guard, playPuzzle, setHeader, puzzleInfo, type Guard, type Kid, type SpeakPlan } from './drive';
import { DAY1, DAY2, PASSWORD, api, at, expect, nameSuffix, playPracticeViaApi, test, type MetaServer } from './meta-server';

test.use({ devBuild: true, trace: 'off' }); // a whole journey's trace is too big to write at teardown
test.describe.configure({ mode: 'serial', timeout: 1_200_000 });

/** The release (app/data/release.json): every one of its scenes must be in the bundle. */
const RELEASE_SCENES = 203;
const ALL_TYPES = ['place-words', 'listen-pick', 'match', 'fill-blanks', 'say-line', 'say-hidden', 'question', 'rebuild', 'comic-order', 'catapult', 'vrai-faux', 'memory', 'next-line', 'line-meaning', 'act-line', 'say-chain', 'say-choice', 'watch'];
const MIC = new Set(['say-line', 'say-hidden', 'act-line', 'say-chain', 'say-choice']);
const ONE_TARGET = new Set(['say-line', 'say-hidden', 'act-line']);

let kid: Kid;
let g: Guard;
let index: { scenes: { id: string; lineCount: number; durationMs: number }[] };
let sceneA = ''; // chosen first: bronze on day one, silver on day two, then a replay
let sceneB = ''; // left mid-practice, continued in a second browser
let sceneC = ''; // a practice composed by an older composer
const offeredToday = new Set<string>(); // every candidate shown on day two, for "Do more"
const met = new Map<string, number>(); // puzzle type -> rounds played
const wrongDone = new Set<string>(); // types already played with wrong moves first
/** Speaking plans for one-target microphone rounds, in order; then plain passes. */
const speakQueue: SpeakPlan[] = ['pass', 'judge', 'fail3', 'unavailable'];
const hintChecked = new Set<string>(); // where the hint rules were checked
let muteChecked = false;

async function makeKid(browser: Browser, info: { project: { use: any } }, day = DAY1): Promise<Kid> {
  const u = info.project.use;
  const ctx = await browser.newContext({ viewport: u.viewport, hasTouch: u.hasTouch, deviceScaleFactor: 1, isMobile: u.isMobile, locale: 'fr-CA', reducedMotion: 'reduce' });
  const headers = { 'x-test-now': at(day), 'x-test-language': 'fr' };
  await ctx.setExtraHTTPHeaders(headers);
  return { ctx, page: await ctx.newPage(), headers };
}

async function closeQuietly(k: Kid | undefined) {
  if (!k) return;
  await k.page.goto('about:blank').catch(() => {});
  await k.ctx.close().catch(() => {});
}

/** One of the day's quests on Home, by its index in DailyState.quests. */
const quest = (page: Page, i: number) => page.locator(`[data-testid="quest"][data-index="${i}"]`);
/** The quest card's own button (the chest is the other one). */
const tapQuest = (page: Page, i: number) => quest(page, i).locator('button').first().tap();
const covers = (page: Page) => page.getByTestId('unlock-cover');
const isHome = (server: MetaServer) => new RegExp(`${server.base}/$`);

async function home(page: Page, server: MetaServer) {
  await page.goto(server.base + '/');
  await expect(page.getByTestId('quest').first().or(page.getByTestId('all-unlocked'))).toBeVisible({ timeout: 20_000 });
}

async function state(page: Page): Promise<any> {
  return (await api(page, 'GET', '/api/me')).json.state;
}

const planOf = (page: Page) => page.evaluate(() => (history.state as any)?.plan);

/**
 * Plays the puzzle on screen, the way a kid would, with the journey's extras: the first round of
 * each tapping puzzle type starts with wrong moves; one-target speaking rounds take the speaking plans in
 * turn; the hint rules are checked once in the help strip of a tapping puzzle type; mute is tried once.
 */
async function playOne(k: Kid): Promise<string | null> {
  const { page } = k;
  const t = await currentPuzzle(page, 30_000);
  if (!t) return null;
  met.set(t.type, (met.get(t.type) ?? 0) + 1);
  let speak: SpeakPlan = 'pass';
  if (ONE_TARGET.has(t.type) && speakQueue.length) {
    speak = speakQueue.shift()!;
    if (speak === 'unavailable') g.allow(/\/api\/speech/); // no Workers AI locally: 503, as provoked
  }
  const wrongFirst = !MIC.has(t.type) && !wrongDone.has(t.type) ? 2 : 0;
  if (wrongFirst) wrongDone.add(t.type);
  await playPuzzle(k, {
    wrongFirst,
    speak,
    onStart: async (info) => {
      // The hint rules in the help strip of a tapping puzzle type (its boxes are the scene's French).
      if (!hintChecked.has('help strip') && !MIC.has(info.type) && info.type !== 'place-words') {
        const tablet = (page.viewportSize()?.width ?? 0) >= 768;
        const open = tablet ? page.locator('[data-help-open]') : page.locator('[data-help-toggle]');
        if (await open.isVisible().catch(() => false)) {
          await open.tap();
          const box = page.locator('[data-help="open"] [data-unit]').first();
          if (await box.isVisible({ timeout: 3000 }).catch(() => false)) {
            // "Elsewhere" is the progress bar: it does nothing when tapped.
            await checkHintRules(page, box, page.locator('[data-practice] [role="progressbar"]').first(), `${info.type}: help strip`);
            hintChecked.add('help strip');
          }
          if (!tablet && (await page.locator('[data-help="open"]').isVisible())) await page.locator('[data-help-toggle]').tap();
        }
      }
      // place-words: its own boxes and the playback bar.
      if (info.type === 'place-words' && !hintChecked.has('place-words')) {
        await checkSeek(page, page.locator('[data-puzzle-pane] [data-scene-bar]'), 'place-words');
        hintChecked.add('place-words');
      }
      // Mute, once, on a tapping puzzle type that loops French: the round runs, nothing is heard.
      if (!muteChecked && !MIC.has(info.type) && info.type !== 'place-words') {
        const mute = page.locator('[data-practice] [data-mute]');
        await mute.tap();
        await expect(mute).toHaveAttribute('data-mute', 'on');
        expect((await audioState(page)).muted).toBe(true);
      }
    },
    onDone: async () => {
      if (!muteChecked && (await page.locator('[data-practice] [data-mute="on"]').isVisible().catch(() => false))) {
        expect((await audioState(page)).muted, 'still muted at the end of the round').toBe(true);
        await page.locator('[data-practice] [data-mute]').tap();
        await expect(page.locator('[data-practice] [data-mute]')).toHaveAttribute('data-mute', 'off');
        muteChecked = true;
      }
    },
  });
  return t.type;
}

/** Plays the practice on screen to its results (a practice is played in one go; up to 50 puzzles). */
async function playToResults(k: Kid): Promise<number> {
  let n = 0;
  for (let i = 0; i < 60; i++) {
    if (!(await playOne(k))) break;
    n++;
  }
  await expect(k.page.locator('[data-results]')).toBeVisible({ timeout: 20_000 });
  return n;
}

/** The results of a finished practice: continue, through a chest when there is one, back Home. */
async function finishResults(page: Page, server: MetaServer) {
  const cont = page.locator('[data-results-continue]');
  await expect(cont).toBeEnabled({ timeout: 20_000 });
  await cont.tap();
  if (/\/chest\//.test(page.url()) || (await page.waitForURL(/\/chest\//, { timeout: 2500 }).then(() => true, () => false))) {
    await page.locator('[data-chest-open]').tap();
    const c = page.locator('[data-chest-continue]');
    await expect(c).toBeVisible({ timeout: 20_000 });
    await c.tap();
  }
  await expect(page).toHaveURL(isHome(server), { timeout: 15_000 });
}

/** Leaves the practice on screen from its close button; it is saved up to the last finished puzzle. */
async function leavePractice(page: Page) {
  await page.locator('[data-practice-close]').tap();
  await page.locator('[data-exit-leave]').tap();
  await expect(page).not.toHaveURL(/\/practice\//, { timeout: 15_000 });
}

/** The practice's place: the overall progress bar's value (puzzles finished). */
const progressAt = (page: Page) => page.evaluate(() => Number(document.querySelector('[data-practice] [role="progressbar"]')?.getAttribute('aria-valuenow') ?? -1));

/** Chooses a candidate from its cover; its card leaves the selection. */
async function pickCover(page: Page, sceneId: string) {
  const cover = page.locator(`[data-testid="unlock-cover"][data-scene="${sceneId}"]`);
  await cover.locator('[data-testid="unlock-pick"]').tap();
  await expect(cover).toHaveCount(0, { timeout: 10_000 });
}

/** The candidates on screen, shortest scene first. */
async function coversByLength(page: Page): Promise<string[]> {
  await expect(covers(page).first()).toBeVisible({ timeout: 15_000 });
  const ids = await covers(page).evaluateAll((els) => els.map((e) => e.getAttribute('data-scene')!));
  const byId = new Map(index.scenes.map((s) => [s.id, s]));
  return ids.sort((a, b) => byId.get(a)!.lineCount - byId.get(b)!.lineCount || byId.get(a)!.durationMs - byId.get(b)!.durationMs);
}

test.beforeAll(async ({ browser }, info) => {
  kid = await makeKid(browser, info);
  g = guard(kid.page);
  if (process.env.E2E_DEBUG_NAV) kid.page.on('framenavigated', (f) => { if (f === kid.page.mainFrame()) console.log(`[nav] ${f.url()}`); });
});
test.afterAll(async ({}, info) => {
  info.setTimeout(180_000);
  await closeQuietly(kid);
});
test.afterEach(async () => {
  if (g.consoleErrors.length) console.log(`console errors:\n  ${g.consoleErrors.splice(0).join('\n  ')}`);
});

test('first open: "Déjà un compte ?" then the welcome; one scene chosen, Home, two more, the rest into the cauldron', async ({ server }) => {
  const { page } = kid;
  await page.goto(server.base + '/');
  const password = page.locator('input[name="password"]').first();
  await expect(password).toBeVisible();
  await password.fill(PASSWORD);
  await password.press('Enter');
  // A brand-new account: first "Déjà un compte ?" (a kid who lost their cookie logs in here), alone.
  const back = page.getByTestId('pwa-welcome');
  await expect(back).toBeVisible({ timeout: 20_000 });
  const welcome = page.getByTestId('welcome');
  await page.waitForTimeout(2000); // longer than the welcome's grace period (onboarding/index.tsx)
  await expect(welcome).toHaveCount(0);
  await back.locator('[data-welcome-new]').tap();
  // Then the welcome, which leads to the candidates.
  await expect(welcome).toBeVisible({ timeout: 20_000 });
  await welcome.locator('[data-welcome-go]').tap();
  await expect(page).toHaveURL(/\/unlock/);
  index = await (await page.request.get(`${server.base}/data/index.json`)).json();
  const released = JSON.parse(readFileSync(new URL('../data/release.json', import.meta.url), 'utf8')).scenes.length;
  expect(released, 'the release').toBe(RELEASE_SCENES);
  expect(index.scenes.length, 'the bundle holds every release scene').toBe(released);

  // The choose quest's candidates: preview the shortest one, choose it from its own page; back on the
  // choice, its card has left the selection.
  await expect(covers(page)).toHaveCount(DAILY_CANDIDATES, { timeout: 15_000 });
  await expect(page.getByTestId('unlock')).toHaveAttribute('data-left', '3');
  const [shortest] = await coversByLength(page);
  await page.locator(`[data-testid="unlock-cover"][data-scene="${shortest}"] [data-testid="unlock-watch"]`).tap();
  await expect(page.locator(`[data-candidate][data-scene-page="${shortest}"]`)).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-practice-start]')).toHaveCount(0);
  await page.locator('[data-choose]').tap();
  await expect(page).toHaveURL(/\/unlock/, { timeout: 15_000 });
  await expect(covers(page)).toHaveCount(DAILY_CANDIDATES - 1, { timeout: 10_000 });
  await expect(page.getByTestId('unlock')).toHaveAttribute('data-left', '2');

  // Home: the choose quest is still the next thing to do, one of three chosen; the first bronze quest
  // has its scene, the other two wait for theirs.
  await page.locator('[data-unlock-home]').tap();
  await expect(page).toHaveURL(isHome(server));
  await expect(quest(page, 0)).toHaveAttribute('data-kind', 'choose');
  await expect(quest(page, 0)).toHaveAttribute('data-state', 'next');
  await expect(quest(page, 0)).toHaveAttribute('data-chosen', '1/3');
  await expect(quest(page, 1)).toHaveAttribute('data-scene', shortest!);
  await expect(quest(page, 1)).toHaveAttribute('data-state', 'open');
  await expect(quest(page, 2)).toHaveAttribute('data-state', 'waiting');
  await expect(quest(page, 3)).toHaveAttribute('data-state', 'waiting');

  // Back to the choice from the quest: the rest are left; two more; the last choice sends the others
  // into the cauldron by themselves, and the screen goes Home.
  await tapQuest(page, 0);
  await expect(page).toHaveURL(/\/unlock/);
  await expect(covers(page)).toHaveCount(DAILY_CANDIDATES - 1, { timeout: 15_000 });
  const rest = await coversByLength(page);
  await pickCover(page, rest[0]!);
  await page.locator(`[data-testid="unlock-cover"][data-scene="${rest[1]}"] [data-testid="unlock-pick"]`).tap();
  await expect(page.getByTestId('unlock')).toHaveAttribute('data-phase', /cauldron|chosen/, { timeout: 10_000 });
  await expect(page).toHaveURL(isHome(server), { timeout: 15_000 });
  await expect(quest(page, 0)).toHaveAttribute('data-state', 'done');
  const d = (await api(page, 'GET', '/api/daily')).json.daily;
  const chosen = d.candidates.filter((o: { unlocked: boolean }) => o.unlocked).map((o: { sceneId: string }) => o.sceneId) as string[];
  expect(new Set(chosen)).toEqual(new Set([shortest, rest[0], rest[1]]));
  expect(d.unlocksLeft).toBe(0);
  // The places got the scenes in the order they were chosen.
  [sceneA, sceneB, sceneC] = [1, 2, 3].map((i) => d.quests.find((q: { index: number }) => q.index === i).sceneId) as [string, string, string];
  expect([sceneA, sceneB, sceneC]).toEqual([shortest, rest[0], rest[1]]);
  await expect(quest(page, 1)).toHaveAttribute('data-state', 'next');
  g.check('first open');
});

test('day one: the first bronze practice from its quest card, its chest, a light streak', async ({ server }) => {
  const { page } = kid;
  await home(page, server);
  await expect(quest(page, 1)).toHaveAttribute('data-state', 'next');
  await expect(quest(page, 1)).toHaveAttribute('data-reason', 'new');
  await tapQuest(page, 1);
  await expect(page).toHaveURL(/\/practice\//, { timeout: 15_000 });
  const plan = await planOf(page);
  expect(plan.sceneId).toBe(sceneA);
  expect(plan.level).toBe(1);
  expect(plan.replay).toBe(false);
  expect(plan.composerVersion, 'the start carried the composer version').toBe(COMPOSER_VERSION);
  const played = await playToResults(kid);
  expect(played, 'a practice in one go').toBeGreaterThan(5);
  await expect(page.locator(`[data-level-up="${sceneA}"]`)).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-quest-done="1"]')).toBeVisible();
  await finishResults(page, server);
  const st = await state(page);
  expect(st.progress[sceneA].level, 'bronze').toBe(1);
  expect(st.streak.count).toBe(1);
  expect(st.streak.doneToday).toBe(true);
  expect(st.streak.fullToday, 'two bronze quests are left').toBe(false);
  await expect(quest(page, 1)).toHaveAttribute('data-state', 'done');
  await expect(page.locator(`[data-streak-week] [data-day="${DAY1}"]`)).toHaveAttribute('data-kind', 'light');
  // The scene page: bronze, the next level waits a day, so playing again is a replay; its playback
  // bar seeks; its strip's boxes follow the hint rules.
  await page.goto(`${server.base}/scene/${sceneA}`);
  await expect(page.locator('[data-rung="1"]')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-practice-start]')).toHaveAttribute('data-action', 'replay');
  await expect(page.locator('[data-next-level]')).toHaveAttribute('data-next-level', '1');
  await checkSeek(page, page.locator('[data-scene-player] [data-scene-bar]'), 'scene page');
  await checkHintRules(page, page.locator('[data-scene-player] [data-unit]').first(), page.locator('[data-scene-page] h1').first(), 'scene page');
  g.check('bronze');
});

test('leaving mid-practice and continuing from its quest card in a second browser, at the same puzzle', async ({ server, browser }, info) => {
  const { page } = kid;
  await home(page, server);
  await expect(quest(page, 2)).toHaveAttribute('data-state', 'next');
  await tapQuest(page, 2);
  await expect(page).toHaveURL(/\/practice\//, { timeout: 15_000 });
  expect((await planOf(page)).sceneId).toBe(sceneB);
  for (let i = 0; i < 3; i++) await playOne(kid);
  expect(await progressAt(page)).toBe(3);
  await leavePractice(page);
  // Home: the quest shows how far it is.
  await home(page, server);
  await expect(quest(page, 2).locator('[data-practice-progress^="3/"]')).toBeVisible();
  // The account: a name, and the secret number from the profile.
  const name = `Gaulois${nameSuffix()}`;
  expect((await api(page, 'PATCH', '/api/me', { name })).status).toBe(200);
  const pin = (await state(page)).profile.pin as string;
  const second = await makeKid(browser, info);
  const g2 = guard(second.page);
  // The provoked speech 503 of a speaking puzzle may fall in this browser (it depends on the practice's seed).
  g2.allow(/\/api\/speech/);
  expect((await second.ctx.request.post(`${server.base}/gate`, { data: { password: PASSWORD } })).status()).toBe(204);
  await second.page.goto(`${server.base}/login`);
  await second.page.locator('#login-name').fill(name.toLowerCase());
  for (const d of pin) await second.page.getByRole('button', { name: d, exact: true }).tap();
  await expect(second.page).toHaveURL(isHome(server), { timeout: 15_000 });
  const card = quest(second.page, 2);
  await expect(card).toHaveAttribute('data-state', 'next', { timeout: 15_000 });
  await expect(card.locator('[data-practice-progress^="3/"]')).toBeVisible();
  await tapQuest(second.page, 2);
  await expect(second.page).toHaveURL(/\/practice\//, { timeout: 15_000 });
  await currentPuzzle(second.page, 30_000);
  expect(await progressAt(second.page), 'continued at the saved puzzle').toBe(3);
  await playOne(second);
  await expect.poll(async () => (await api(second.page, 'GET', '/api/me')).json.state.practices[sceneB]?.done).toBe(4);
  g2.check('second browser');
  await closeQuietly(second);
  g.check('left and continued');
});

test('a practice composed by an older composer is composed again and resumed by count', async ({ server }) => {
  const { page } = kid;
  const start = await api(page, 'POST', '/api/practices/start', { kind: 'scene', sceneId: sceneC, composerVersion: 1 });
  expect(start.status).toBe(200);
  const plan = start.json.plan;
  expect(plan.composerVersion).toBe(1);
  expect((await api(page, 'POST', `/api/practices/${encodeURIComponent(plan.id)}/progress`, { done: 4, outcomes: [] })).status).toBe(200);
  await page.goto(`${server.base}/scene/${sceneC}`);
  const cont = page.locator('[data-practice-start]');
  await expect(cont).toHaveAttribute('data-action', 'continue', { timeout: 15_000 });
  await cont.tap();
  await expect(page).toHaveURL(/\/practice\//, { timeout: 15_000 });
  const t = await currentPuzzle(page, 30_000);
  expect(t, 'a puzzle of the recomposed practice').not.toBeNull();
  expect(await progressAt(page), 'resumed at puzzle 4 by count').toBe(4);
  await playOne(kid);
  await expect.poll(async () => (await state(page)).practices[sceneC]?.done).toBe(5);
  await leavePractice(page);
  g.check('older composer');
});

test('the next day: the quests that wait lock the choose quest; silver passed from its quest; then choosing opens', async ({ server }) => {
  const { page } = kid;
  await setHeader(kid, 'x-test-now', at(DAY2));
  await home(page, server);
  // Built at the day's first visit: the due silver practice, the two bronze practices started
  // yesterday, then the choose quest, locked behind those three, then one bronze place.
  const d = (await api(page, 'GET', '/api/daily')).json.daily;
  for (const c of d.candidates) offeredToday.add(c.sceneId);
  expect(d.quests.map((q: any) => `${q.kind}:${q.reason ?? ''}`)).toEqual(['practice:due', 'practice:continue', 'practice:continue', 'choose:', 'practice:new']);
  expect(d.quests[0].sceneId).toBe(sceneA);
  expect(d.quests[0].level).toBe(2);
  expect(new Set([d.quests[1].sceneId, d.quests[2].sceneId])).toEqual(new Set([sceneB, sceneC]));
  await expect(quest(page, 0)).toHaveAttribute('data-state', 'next');
  await expect(quest(page, 3)).toHaveAttribute('data-state', 'locked');
  await expect(quest(page, 3).locator('[data-waiting-for]')).toHaveAttribute('data-waiting-for', '1,2,3');
  await expect(quest(page, 4)).toHaveAttribute('data-state', 'waiting');
  // Tapping the locked quest says what comes first and stays on Home.
  await tapQuest(page, 3);
  await expect(page).toHaveURL(isHome(server));
  // The candidates screen says the same; its scenes can be watched, not chosen; the server refuses.
  await page.goto(`${server.base}/unlock`);
  await expect(page.locator('[data-unlock-locked="1,2,3"]')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('unlock-watch')).toHaveCount(DAILY_CANDIDATES);
  await expect(page.getByTestId('unlock-pick')).toHaveCount(0);
  g.allow(/\/api\/daily\/unlock$/);
  const refused = await api(page, 'POST', '/api/daily/unlock', { sceneId: d.candidates[0].sceneId });
  expect(refused.status).toBe(409);
  expect(refused.json.error).toBe('choose-locked');

  // The due practice from its quest card: silver, a day after bronze.
  await home(page, server);
  await tapQuest(page, 0);
  await expect(page).toHaveURL(/\/practice\//, { timeout: 15_000 });
  const plan = await planOf(page);
  expect(plan.sceneId).toBe(sceneA);
  expect(plan.level).toBe(2);
  await playToResults(kid);
  await expect(page.locator(`[data-level-up="${sceneA}"]`)).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-quest-done="0"]')).toBeVisible();
  await finishResults(page, server);
  const st = await state(page);
  expect(st.progress[sceneA].level, 'silver').toBe(2);
  expect(st.streak.count).toBe(2);
  // The two bronze practices started yesterday, finished (through the API, as the practice screen
  // would): each does its quest.
  for (const i of [1, 2]) {
    const r = await playPracticeViaApi(page, { kind: 'scene', sceneId: d.quests[i].sceneId });
    expect(r.quest?.index).toBe(i);
  }
  // Choosing opens.
  await home(page, server);
  await expect(quest(page, 3)).toHaveAttribute('data-state', 'next');
  g.check('silver, choosing opens');
});

test('the last quest of the day: a full streak, then "Do more" draws fresh candidates and extra quests', async ({ server }) => {
  const { page } = kid;
  await home(page, server);
  await tapQuest(page, 3);
  await expect(page).toHaveURL(/\/unlock/);
  const ids = await coversByLength(page);
  for (const id of ids) offeredToday.add(id);
  await pickCover(page, ids[0]!);
  await pickCover(page, ids[1]!);
  await page.locator(`[data-testid="unlock-cover"][data-scene="${ids[2]}"] [data-testid="unlock-pick"]`).tap();
  await expect(page).toHaveURL(isHome(server), { timeout: 15_000 });
  // The day's last quest: the bronze practice of the first scene chosen.
  await expect(quest(page, 4)).toHaveAttribute('data-scene', ids[0]!);
  await expect(quest(page, 4)).toHaveAttribute('data-state', 'next');
  await tapQuest(page, 4);
  await expect(page).toHaveURL(/\/practice\//, { timeout: 15_000 });
  await playToResults(kid);
  await expect(page.locator('[data-quest-done="4"]')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-full-streak]')).toBeVisible();
  await finishResults(page, server);
  const st = await state(page);
  expect(st.streak.fullToday).toBe(true);
  expect(st.daily.questsDone).toBe(true);
  await expect(page.locator(`[data-streak-week] [data-day="${DAY2}"]`)).toHaveAttribute('data-kind', 'full');
  await expect(page.locator(`[data-streak-week] [data-day="${DAY1}"]`)).toHaveAttribute('data-kind', 'light');
  // Every quest done: "Do more".
  await expect(page.getByTestId('quests-done')).toBeVisible();
  await page.locator('[data-do-more-button]').first().tap();
  await expect(page).toHaveURL(/\/unlock/, { timeout: 15_000 });
  await expect(covers(page)).toHaveCount(DAILY_CANDIDATES, { timeout: 15_000 });
  await expect(page.getByTestId('unlock')).toHaveAttribute('data-left', '3');
  const fresh = await coversByLength(page);
  expect(fresh.filter((id) => offeredToday.has(id)), 'none offered earlier today').toEqual([]);
  // Home: the extra quests (an extra choose quest and three bronze places), after the day's.
  await page.locator('[data-unlock-home]').tap();
  await expect(page).toHaveURL(isHome(server));
  await expect(page.locator('[data-quests-extra]')).toBeVisible();
  const extra = page.locator('[data-testid="quest"][data-extra]');
  await expect(extra).toHaveCount(4);
  await expect(extra.first()).toHaveAttribute('data-kind', 'choose');
  await expect(extra.first()).toHaveAttribute('data-state', 'next');
  g.check('full streak, do more');
});

test('a replay: a level not due plays for XP only, no quest and no level; left and continued', async ({ server }) => {
  const { page } = kid;
  const before = await state(page);
  await page.goto(`${server.base}/scene/${sceneA}`);
  const start = page.locator('[data-practice-start]');
  await expect(start).toHaveAttribute('data-action', 'replay', { timeout: 15_000 });
  await expect(page.locator('[data-worth]')).toHaveAttribute('data-worth', 'replay');
  await expect(page.locator('[data-next-level]')).toHaveAttribute('data-next-level', '2'); // gold waits two days
  await start.tap();
  await expect(page).toHaveURL(/\/practice\//, { timeout: 15_000 });
  const plan = await planOf(page);
  expect(plan.replay).toBe(true);
  expect(plan.level, 'a replay is at the scene\'s level').toBe(2);
  await playOne(kid);
  await playOne(kid);
  await leavePractice(page);
  // The scene page continues the replay.
  await page.goto(`${server.base}/scene/${sceneA}`);
  await expect(start).toHaveAttribute('data-action', 'continue', { timeout: 15_000 });
  await expect(start).toHaveAttribute('data-replay', 'true');
  await start.tap();
  await expect(page).toHaveURL(/\/practice\//, { timeout: 15_000 });
  await currentPuzzle(page, 30_000);
  expect(await progressAt(page)).toBe(2);
  await playToResults(kid);
  await expect(page.locator('[data-level-up]')).toHaveCount(0);
  await expect(page.locator('[data-quest-done]')).toHaveCount(0);
  await finishResults(page, server);
  const after = await state(page);
  expect(after.progress[sceneA].level, 'still silver').toBe(2);
  expect(after.currencies.xp, 'XP for the replay').toBeGreaterThan(before.currencies.xp);
  expect(after.streak.count).toBe(before.streak.count);
  g.check('replay');
});

test('the puzzle types the practices met', async () => {
  // Composition decides which types a practice uses (a two-line song has no multi-line puzzles);
  // puzzles.spec.ts and new-puzzles.spec.ts play every one of the eighteen types on its own.
  console.log(`[journey] met in practices: ${[...met].map(([t, n]) => `${t}×${n}`).join(' ')}; not met: ${ALL_TYPES.filter((t) => !met.has(t)).join(' ') || 'none'}; speaking plans not used: ${speakQueue.join(' ') || 'none'}`);
  expect(met.size, 'a good variety of puzzles').toBeGreaterThanOrEqual(10);
  expect([...met.keys()].filter((t) => MIC.has(t)).length, 'speaking puzzles inside the practices').toBeGreaterThanOrEqual(2);
});

test('a kid with everything unlocked', async ({ browser, server }, info) => {
  const k = await makeKid(browser, info);
  const gg = guard(k.page);
  expect((await k.ctx.request.post(`${server.base}/gate`, { data: { password: PASSWORD } })).status()).toBe(204);
  await k.ctx.addInitScript(() => {
    localStorage.setItem('frenchirix.onb.welcome', '1');
    localStorage.setItem('frx.pwa.welcomeBack', 'new');
  });
  await home(k.page, server);
  // Three a day, the test clock moving on, until every release scene is unlocked (nothing is played,
  // so nothing waits and the choose quest is never locked).
  const total = ((await (await k.page.request.get(`${server.base}/data/index.json`)).json()) as { scenes: unknown[] }).scenes.length;
  expect(total).toBe(RELEASE_SCENES);
  const start = new Date(`${DAY1}T12:00:00Z`).getTime();
  let unlocked = 0;
  let d = 0;
  for (; d < 200 && unlocked < total; d++) {
    await setHeader(k, 'x-test-now', at(new Date(start + d * 86_400_000).toISOString().slice(0, 10)));
    const daily = (await api(k.page, 'GET', '/api/daily')).json.daily;
    for (const o of daily.candidates.filter((x: { unlocked: boolean }) => !x.unlocked).slice(0, daily.unlocksLeft)) {
      expect((await api(k.page, 'POST', '/api/daily/unlock', { sceneId: o.sceneId })).status).toBe(200);
      unlocked++;
    }
  }
  expect(Object.keys((await state(k.page)).progress)).toHaveLength(total);
  // The next day: no choose quest, nothing waits, so no quests; the candidates screen and Home say so.
  const last = new Date(start + (d + 1) * 86_400_000).toISOString().slice(0, 10);
  await setHeader(k, 'x-test-now', at(last));
  const daily = (await api(k.page, 'GET', '/api/daily')).json.daily;
  expect(daily.choose).toBeNull();
  expect(daily.doMore).toBe(false);
  await k.page.goto(`${server.base}/unlock`);
  await expect(k.page.locator('[data-testid="unlock-all-done"]')).toBeVisible({ timeout: 15_000 });
  await home(k.page, server);
  await expect(k.page.getByTestId('all-unlocked')).toBeVisible();
  // Any scene's page starts its bronze practice.
  const first = Object.keys((await state(k.page)).progress)[0]!;
  await k.page.goto(`${server.base}/scene/${first}`);
  await expect(k.page.locator('[data-practice-start]')).toHaveAttribute('data-action', 'start', { timeout: 15_000 });
  await k.page.locator('[data-practice-start]').tap();
  await expect(k.page).toHaveURL(/\/practice\//, { timeout: 15_000 });
  await playOne(k);
  await page2Episodes(k.page, server, total);
  gg.check('everything unlocked');
  await closeQuietly(k);
});

/** The Episodes tab with every release scene unlocked: no locked runs left. */
async function page2Episodes(page: Page, server: MetaServer, total: number) {
  await page.goto(`${server.base}/episodes`);
  await page.locator('[data-mode="episodes"]').tap();
  await expect(page.locator('[data-testid="collection-scene"]')).toHaveCount(total, { timeout: 15_000 });
  await expect(page.locator('[data-testid="locked-run"]')).toHaveCount(0);
}

void puzzleInfo;
void ((x: Locator) => x);
