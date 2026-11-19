// The microphone puzzles of the practice prototype (act-line, say-chain, say-choice) through the real
// shell with the fixture client and Chromium's fake microphone, on the Panono scene (say-choice needs
// its alternates). `?transcript=` stands for what the kid said (dev builds forward it; the fixture
// client scores it like the server). Runs at both project sizes.
import { expect, test } from '@playwright/test';
import { puzzleInfo } from './drive';

const SCENE = 's01e03-0023-0026';

test.describe.configure({ timeout: 120_000 });

async function open(page: import('@playwright/test').Page, puzzleType: string, transcript: string, extra = '') {
  await page.goto('/version');
  await page.evaluate(() => {
    localStorage.setItem('frenchirix.onb.welcome', '1');
    localStorage.setItem('frx.mic.intro', '1');
  });
  await page.goto(`/dev/practice?scene=${SCENE}&type=${puzzleType}&level=2&seed=1${extra}&transcript=${encodeURIComponent(transcript)}`);
  await expect(page.locator('[data-puzzle]')).toBeVisible({ timeout: 20_000 });
}

test('act-line: the line before plays, the microphone opens by itself, the scene goes on', async ({ page }) => {
  await open(page, 'act-line', 'On est bien, il fait chaud Il fait beau', '&line=s01e03-0024');
  const pane = page.locator('[data-puzzle-pane]');
  await expect(pane.locator('[data-act-line]')).toHaveAttribute('data-phase', 'before');
  // No tap: after the cue the microphone is open.
  await expect(pane.locator('[data-record="recording"]')).toBeVisible({ timeout: 15_000 });
  await expect(pane.locator('[data-cant-speak]')).toBeVisible();
  await page.waitForTimeout(1600);
  await pane.locator('[data-record="recording"]').tap({ force: true });
  await expect.poll(async () => (await puzzleInfo(page))?.done, { timeout: 15_000 }).toBe(true);
  await expect(pane.locator('[data-after]')).toBeVisible({ timeout: 5000 });
});

test('say-chain: one tap, then hands-free to the end (the third try always moves on)', async ({ page }) => {
  // One transcript for every item: the first is heard, the others pass by the third-try rule.
  await open(page, 'say-chain', 'tout va bien');
  const pane = page.locator('[data-puzzle-pane]');
  const n = ((await puzzleInfo(page))!.puzzle.items as unknown[]).length;
  await pane.locator('[data-chain-start]').tap();
  await expect.poll(async () => (await puzzleInfo(page))?.done, { timeout: 30_000 * n, intervals: [500] }).toBe(true);
  const st = JSON.parse((await puzzleInfo(page))!.state);
  expect(st.results).toHaveLength(n);
  expect(st.results.some((r: { how: string }) => r.how === 'heard')).toBe(true);
  expect(st.results.some((r: { how: string }) => r.how === 'auto')).toBe(true);
  await expect(pane.locator('[data-chain-end]')).toBeVisible();
});

test('say-choice: saying a funny alternate makes it win; nothing is wrong', async ({ page }) => {
  await open(page, 'say-choice', 'Madame Arbre, il pleut des crêpes, allez, saute avec tes moutons', '&line=s01e03-0023');
  const pane = page.locator('[data-puzzle-pane]');
  await pane.locator('[data-record]').tap();
  await expect(pane.locator('[data-record="recording"]')).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(1600);
  await pane.locator('[data-record="recording"]').tap({ force: true });
  await expect.poll(async () => (await puzzleInfo(page))?.done, { timeout: 15_000 }).toBe(true);
  const st = JSON.parse((await puzzleInfo(page))!.state);
  expect(st.chosen).toBe(2);
  expect((await puzzleInfo(page))!.mistakes).toBe(0);
});
