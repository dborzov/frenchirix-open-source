// The long practice prototype on the Panono scene (/dev/panono, composePractice), played by real taps
// through the practice shell, against a real local Worker (meta-server.ts) so the speaking puzzles go
// through the real POST /api/speech, scored on the x-test-transcript header (TEST_MODE). The kid
// signs in as admin (/dev) and unlocks the Panono scene the normal way (speech needs it unlocked):
// the test clock moves day by day until the scene is among the day's candidates.
//
// Each run: every puzzle of the composed practice, wrong moves first in the first round of each
// tapping puzzle type, speaking with a pass, a miss then a pass, and three misses ending in the automatic
// pass; it stops after a third of the puzzles, reloads, continues where it left off, and finishes.
// It checks that every one of the scene's four lines was the target of several puzzles of several types.
import type { Browser, Page } from '@playwright/test';
import { currentPuzzle, guard, playPuzzle, setHeader, puzzleInfo, type Kid, type SpeakPlan } from './drive';
import { DAY1, PASSWORD, api, at, expect, signInAdmin, test, type MetaServer } from './meta-server';

const PANONO = 's01e03-0023-0026';
const LINES = ['s01e03-0023', 's01e03-0024', 's01e03-0025', 's01e03-0026'];

test.use({ devBuild: true, trace: 'off' });
test.describe.configure({ mode: 'parallel', timeout: 900_000 });

async function makeKid(browser: Browser, info: { project: { use: any } }, server: MetaServer): Promise<Kid> {
  const u = info.project.use;
  const ctx = await browser.newContext({ viewport: u.viewport, hasTouch: u.hasTouch, deviceScaleFactor: 1, isMobile: u.isMobile, locale: 'fr-CA', reducedMotion: 'reduce' });
  const headers = { 'x-test-now': at(DAY1), 'x-test-language': 'fr' };
  await ctx.setExtraHTTPHeaders(headers);
  expect((await ctx.request.post(`${server.base}/gate`, { data: { password: PASSWORD } })).status()).toBe(204);
  await signInAdmin(ctx, server);
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('frenchirix.onb.welcome', '1');
      localStorage.setItem('frx.pwa.welcomeBack', 'new');
    } catch {
      // storage blocked
    }
  });
  return { ctx, page: await ctx.newPage(), headers };
}

/** Moves the test clock a day at a time until the Panono scene is offered, then unlocks it. */
async function unlockPanono(kid: Kid, server: MetaServer): Promise<void> {
  const { page } = kid;
  await page.goto(server.base + '/');
  // The app creates the kid's session on its first load: wait for it before calling the API.
  await expect.poll(async () => (await kid.ctx.cookies()).some((c) => c.name === 'fx_sid'), { timeout: 20_000 }).toBe(true);
  const start = new Date(`${DAY1}T12:00:00Z`).getTime();
  for (let d = 0; d < 120; d++) {
    const day = new Date(start + d * 86_400_000).toISOString().slice(0, 10);
    await setHeader(kid, 'x-test-now', at(day));
    const daily = (await api(page, 'GET', '/api/daily')).json.daily;
    if (daily.candidates.some((o: { sceneId: string }) => o.sceneId === PANONO)) {
      expect((await api(page, 'POST', '/api/daily/unlock', { sceneId: PANONO })).status).toBe(200);
      return;
    }
  }
  throw new Error('the Panono scene was never offered in 120 days');
}

/** The lines a puzzle is about: its own line, or the lines it shows for multi-line and scene puzzles. */
function linesOf(puzzle: any): string[] {
  if (typeof puzzle.lineId === 'string') return [puzzle.lineId];
  if (Array.isArray(puzzle.answer) && puzzle.answer.every((x: unknown) => typeof x === 'string' && LINES.includes(x as string))) return puzzle.answer;
  return (puzzle.helpLineIds as string[]).filter((id) => LINES.includes(id));
}

const MIC = new Set(['say-line', 'say-hidden', 'act-line', 'say-chain', 'say-choice']);

async function openPanono(page: Page, server: MetaServer, level: number, speak: boolean) {
  await page.goto(`${server.base}/dev/panono?level=${level}&seed=1${speak ? '' : '&speak=0'}`);
  await expect(page.locator('[data-coverage]')).toBeVisible({ timeout: 30_000 });
}

for (const level of [1, 4]) {
  for (const speak of [true, false]) {
    test(`Panono practice, level ${level}, speaking ${speak ? 'on' : 'off'}: every puzzle by taps, left a third of the way, a reload, continued to the end`, async ({ browser, server }, info) => {
      const kid = await makeKid(browser, info, server);
      const g = guard(kid.page);
      await unlockPanono(kid, server);
      const { page } = kid;
      await openPanono(page, server, level, speak);
      const planned = await page.locator('[data-plan-row]').count();
      expect(planned, 'a long practice: ten puzzles or more for a four-line scene').toBeGreaterThanOrEqual(10);
      await page.locator('[data-panono-play]').tap();
      await expect(page.locator('[data-practice]')).toBeVisible({ timeout: 20_000 });

      const byLine = new Map<string, { n: number; types: Set<string> }>(LINES.map((id) => [id, { n: 0, types: new Set<string>() }]));
      const seenTypes = new Set<string>();
      const plans: SpeakPlan[] = ['pass', 'fail-pass', 'fail3'];
      let micRounds = 0;
      let played = 0;
      let broke = false;
      let resumedAt = -1;
      for (let guardSteps = 0; guardSteps < 80; guardSteps++) {
        const t = await currentPuzzle(page, 30_000);
        if (!t) break;
        expect(speak || !MIC.has(t.type), `${t.type} with speaking off`).toBe(true);
        for (const id of linesOf(t.puzzle)) {
          const e = byLine.get(id)!;
          e.n++;
          e.types.add(t.type);
        }
        const fresh = !seenTypes.has(t.type);
        seenTypes.add(t.type);
        // One-target speaking rounds get the three plans in turn; chains and choices are played as said.
        const plan = ['say-line', 'say-hidden', 'act-line'].includes(t.type) ? plans[micRounds++ % plans.length] : 'pass';
        await playPuzzle(kid, { wrongFirst: fresh && !MIC.has(t.type) ? 2 : 0, speak: plan });
        played++;
        // A third of the way: leave here, reload, continue where it left off.
        if (!broke && played === Math.floor(planned / 3)) {
          broke = true;
          const done = played;
          await openPanono(page, server, level, speak);
          const cont = page.locator('[data-panono-continue]');
          await expect(cont).toBeVisible();
          await cont.tap();
          const next = await currentPuzzle(page, 30_000);
          expect(next, 'a puzzle after continuing').not.toBeNull();
          resumedAt = await page.evaluate(() => Number(document.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow') ?? -1));
          expect(resumedAt, 'continued at the saved puzzle').toBe(done);
        }
      }
      await expect(page.locator('[data-results]')).toBeVisible({ timeout: 20_000 });
      expect(broke, 'the practice was left and continued').toBe(true);
      expect(played, 'every planned puzzle was played').toBe(planned);
      if (speak) expect(micRounds, 'speaking rounds with one target').toBeGreaterThanOrEqual(1);
      for (const [id, e] of byLine) {
        expect(e.n, `line ${id} is the target of several puzzles`).toBeGreaterThanOrEqual(3);
        expect(e.types.size, `line ${id} is practised by several types`).toBeGreaterThanOrEqual(2);
      }
      console.log(`[${info.project.name}] Panono level ${level} speak ${speak}: ${played} puzzles, ${[...seenTypes].join(' ')}; per line ${[...byLine].map(([id, e]) => `${id.slice(-2)}:${e.n}/${e.types.size}`).join(' ')}`);
      g.check(`Panono level ${level} speak ${speak}`);
      await kid.page.goto('about:blank').catch(() => {});
      await kid.ctx.close();
      void puzzleInfo;
    });
  }
}
