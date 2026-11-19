// The speaking panel's paths through the real shell and the real worker's POST /api/speech (TEST_MODE:
// the x-test-transcript header stands in for Whisper, x-test-judge for the judge): a pass, a miss then
// a pass, misses ending in the automatic third-try pass, recognition unavailable, the microphone
// denied, "Je ne peux pas parler" swapping in tapping rounds and the setting carrying over. Rounds are
// chained through /dev/practice (behind the admin password) on a scene the kid unlocked; the last one
// is a real practice. The journey (journey.worker.spec.ts) meets them inside real practices too.
import type { Browser, Page } from '@playwright/test';
import { currentPuzzle, guard, playPuzzle, type Guard, type Kid } from './drive';
import { DAY1, PASSWORD, api, at, expect, signInAdmin, test, type MetaServer } from './meta-server';

test.use({ devBuild: true, trace: 'off' });
test.describe.configure({ timeout: 300_000 });

async function makeKid(browser: Browser, info: { project: { use: any } }): Promise<Kid> {
  const u = info.project.use;
  const ctx = await browser.newContext({ viewport: u.viewport, hasTouch: u.hasTouch, deviceScaleFactor: 1, isMobile: u.isMobile, locale: 'fr-CA', reducedMotion: 'reduce' });
  const headers = { 'x-test-now': at(DAY1), 'x-test-language': 'fr' };
  await ctx.setExtraHTTPHeaders(headers);
  return { ctx, page: await ctx.newPage(), headers };
}

async function home(page: Page, server: MetaServer) {
  await page.goto(server.base + '/');
  await expect(page.getByTestId('quest').first()).toBeVisible({ timeout: 20_000 });
}

/** Leave the page first, then close the context and wait for it. */
async function closeQuietly(k: Kid | undefined) {
  if (!k) return;
  await k.page.goto('about:blank').catch(() => {});
  await k.ctx.close().catch(() => {});
}

test.describe('speaking', () => {
  // Speaking puzzles through the real shell (/dev/practice chains the puzzle types) and the real worker's
  // POST /api/speech, which in TEST_MODE scores the x-test-transcript header instead of Whisper.
  // The scene must be unlocked for the kid, so each test unlocks one first.
  async function speaker(browser: Browser, info: { project: { use: any } }, server: MetaServer, deny = false): Promise<{ k: Kid; gg: Guard; scene: string }> {
    const k = await makeKid(browser, info);
    const res = await k.ctx.request.post(`${server.base}/gate`, { data: { password: PASSWORD } });
    expect(res.status()).toBe(204);
    await signInAdmin(k.ctx, server); // these rounds run through /dev/practice, behind the admin password
    await k.ctx.addInitScript(() => {
      localStorage.setItem('frenchirix.onb.welcome', '1');
      localStorage.setItem('frx.pwa.welcomeBack', 'new');
    });
    if (deny)
      await k.ctx.addInitScript(() => {
        navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
      });
    const gg = guard(k.page);
    await home(k.page, server);
    const d = await api(k.page, 'GET', '/api/daily');
    // A scene with enough to say: the offer with the most lines.
    const candidates = d.json.daily.candidates.map((o: { sceneId: string }) => o.sceneId) as string[];
    const index = await (await k.page.request.get(`${server.base}/data/index.json`)).json();
    const scene = candidates.map((id) => index.scenes.find((s: any) => s.id === id)).sort((a: any, b: any) => b.lineCount - a.lineCount)[0].id as string;
    expect((await api(k.page, 'POST', '/api/daily/unlock', { sceneId: scene })).status).toBe(200);
    return { k, gg, scene };
  }

  test('pass; fail then pass; three fails and "well tried"; recognition unavailable', async ({ browser, server }, info) => {
    const { k, gg, scene } = await speaker(browser, info, server);
    await k.page.goto(`${server.base}/dev/practice?scene=${scene}&type=say-line,say-hidden,say-line,say-line&level=1&seed=2`);
    await expect(k.page.locator('[data-puzzle]')).toBeVisible({ timeout: 20_000 });
    const p1 = await playPuzzle(k, { speak: 'pass' });
    expect(p1.mistakes).toBe(0);
    const p2 = await playPuzzle(k, { speak: 'fail-pass' });
    expect(p2.mistakes).toBe(1);
    const p3 = await playPuzzle(k, { speak: 'fail3' });
    expect(p3.mistakes).toBe(2); // the third try always passes
    gg.allow(/\/api\/speech/); // the local worker has no Workers AI: 503 speech-unavailable, as provoked
    const p4 = await playPuzzle(k, { speak: 'unavailable' });
    expect(p4.mistakes).toBe(0);
    await expect(k.page.locator('[data-results]')).toBeVisible();
    gg.check('speaking');
    await closeQuietly(k);
  });

  test('act-line and say-chain against the real speech endpoint: the scene goes on; the chain runs hands-free', async ({ browser, server }, info) => {
    const { k, gg, scene } = await speaker(browser, info, server);
    await k.page.goto(`${server.base}/dev/practice?scene=${scene}&type=act-line,say-chain&level=2&seed=2`);
    await expect(k.page.locator('[data-puzzle]')).toBeVisible({ timeout: 20_000 });
    const act = await playPuzzle(k, { speak: 'fail-pass' });
    expect(act.type).toBe('act-line');
    expect(act.mistakes).toBe(1);
    const chain = await playPuzzle(k, { speak: 'pass' });
    expect(chain.type).toBe('say-chain');
    expect(chain.mistakes).toBe(0);
    await expect(k.page.locator('[data-results]')).toBeVisible();
    gg.check('new speaking puzzles');
    await closeQuietly(k);
  });

  test('microphone denied: skip, or "Je ne peux pas parler" replaces this and later speaking rounds with tapping rounds on the same French', async ({ browser, server }, info) => {
    const { k, gg, scene } = await speaker(browser, info, server, true);
    await k.page.goto(`${server.base}/dev/practice?scene=${scene}&type=say-line,say-hidden,listen-pick,say-line,match&level=2&seed=3`);
    await expect(k.page.locator('[data-puzzle]')).toBeVisible({ timeout: 20_000 });
    await playPuzzle(k, { speak: 'denied-skip' });
    // The second speaking round: the button on the denied screen replaces it by its tapping equivalent.
    const before = (await currentPuzzle(k.page))!;
    expect(before.type).toBe('say-hidden');
    expect(before.puzzle.alt.helpLineIds).toContain(before.puzzle.lineId); // the same line
    const p2 = await playPuzzle(k, { speak: 'denied-cant' });
    expect(p2.replaced).toBe('say-hidden');
    expect(p2.type).toBe(before.puzzle.alt.type);
    expect(p2.mistakes).toBe(0);
    await expect.poll(async () => (await currentPuzzle(k.page))?.type).toBe('listen-pick');
    await playPuzzle(k);
    // The later say-line comes already replaced.
    const later = (await currentPuzzle(k.page))!;
    expect(later.puzzleId).toMatch(/:say-line~/);
    expect(['say-line', 'say-hidden']).not.toContain(later.type);
    await playPuzzle(k);
    await expect.poll(async () => (await currentPuzzle(k.page))?.type).toBe('match');
    await playPuzzle(k);
    await expect(k.page.locator('[data-results]')).toBeVisible();
    gg.check('mic denied');
    await closeQuietly(k);
  });

  test('the microphone switch in the practice header replaces the speaking rounds and stays to turn them back on', async ({ browser, server }, info) => {
    const { k, gg, scene } = await speaker(browser, info, server);
    await k.page.goto(`${server.base}/dev/practice?scene=${scene}&type=listen-pick,say-line,say-hidden,match&level=2&seed=4`);
    await expect(k.page.locator('[data-puzzle]')).toBeVisible({ timeout: 20_000 });
    const toggle = k.page.locator('[data-speak-toggle]');
    await expect(toggle).toBeVisible();
    await toggle.tap();
    await playPuzzle(k);
    for (const was of ['say-line', 'say-hidden']) {
      const t = (await currentPuzzle(k.page))!;
      expect(t.puzzleId).toContain(`:${was}~`);
      await playPuzzle(k);
    }
    await expect.poll(async () => (await currentPuzzle(k.page))?.type).toBe('match');
    await expect(toggle).toBeVisible(); // speaking is off: the switch stays, to turn it back on
    await playPuzzle(k);
    await expect(k.page.locator('[data-results]')).toBeVisible();
    gg.check('cant talk');
    await closeQuietly(k);
  });

  test('"Je ne peux pas parler" in the middle of a take, in a real practice: replaced, saved, and turned back on for the next practice', async ({ browser, server }, info) => {
    const { k, gg, scene } = await speaker(browser, info, server);
    await k.page.goto(`${server.base}/dev/practice?plan=scene&scene=${scene}`);
    await expect(k.page).toHaveURL(/\/practice\//, { timeout: 20_000 });
    await expect(k.page.locator('[data-puzzle]')).toBeVisible({ timeout: 20_000 });
    let replacedOne = false;
    for (let i = 0; i < 60; i++) { // a practice is 12 to 50 puzzles, played in one go
      const t = await currentPuzzle(k.page);
      if (!t) break;
      const mic = ['say-line', 'say-hidden', 'act-line', 'say-chain', 'say-choice'].includes(t.type);
      expect(mic && replacedOne, 'a speaking round after "Je ne peux pas parler"').toBe(false);
      if (mic && (t.type === 'say-line' || t.type === 'say-hidden' || t.type === 'act-line')) {
        const p = await playPuzzle(k, { speak: 'cant' });
        expect(p.replaced).toBe(t.type);
        if (t.puzzle.alt) expect(t.puzzle.alt.helpLineIds).toContain(t.puzzle.lineId);
        replacedOne = true;
      } else await playPuzzle(k);
    }
    await expect(k.page.locator('[data-results]')).toBeVisible();
    // The composer's seed is the server's: now and then a practice's only speaking rounds are chains
    // and choices, which have no "Je ne peux pas parler" (one run in about ten under the full suite).
    test.skip(!replacedOne, 'this practice had no one-target speaking round (say-line, say-hidden, act-line)');
    // Saved: the profile says no speaking, and the next practice is planned without the microphone.
    await expect.poll(async () => (await api(k.page, 'GET', '/api/me')).json.state.profile.speak).toBe(false);
    expect((await api(k.page, 'POST', '/api/practices/start', { kind: 'scene', sceneId: scene })).json.plan.speak).toBe(false);
    // Turning it back on from the practice header: the next practice has speaking rounds again.
    await k.page.goto(`${server.base}/dev/practice?plan=scene&scene=${scene}`);
    await expect(k.page.locator('[data-puzzle]')).toBeVisible({ timeout: 20_000 });
    const toggle = k.page.locator('[data-speak-toggle]');
    await expect(toggle).toBeVisible();
    await toggle.tap();
    await expect.poll(async () => (await api(k.page, 'GET', '/api/me')).json.state.profile.speak).toBe(true);
    // (A practice continued keeps the plan it was made with; the shell follows the kid's setting.)
    gg.check('cant speak, saved');
    await closeQuietly(k);
  });
});

