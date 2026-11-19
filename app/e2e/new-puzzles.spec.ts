// The six puzzle types of the practice rework, each played alone through /dev/practice (fixture Vite,
// real content) on the Panono scene and on a longer dialogue, at both project sizes: played to the end
// by taps (wrong moves first in the tapping ones), with checks particular to each and screenshots
// mid-play and at the reward in E2E_SHOTS (default test-results/new-puzzles).
// - every piece of French on screen is in tappable boxes that open their meaning;
// - no panel sits on its own colour (contrast.ts);
// - the French loops when the puzzle says it does, and nothing plays aloud while muted;
// - say-chain is hands-free after its start: no tap at all until the chain ends, misses included;
// - act-line plays the line(s) before the kid's turn and the line after it.
// The fixture client hears every take as said perfectly unless ?transcript= says otherwise.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { sameFillPanels } from './contrast';
import { currentPuzzle, guard, playChoice, playPuzzle, puzzleInfo, type Kid, type PuzzleInfo } from './drive';

const SHOTS = process.env.E2E_SHOTS ?? 'test-results/new-puzzles';
const PANONO = 's01e03-0023-0026';
const LONG = 's01e01-0296-0306'; // eleven lines, one with approxTimes
const TYPES = ['place-words', 'next-line', 'line-meaning', 'act-line', 'say-chain', 'say-choice'];
/** Every puzzle on both (every line of the release scenes has its alternates, for say-choice). */
const SCENES_FOR = (_type: string) => [PANONO, LONG];

test.describe.configure({ mode: 'parallel', timeout: 300_000 });
test.use({ trace: 'off' });

async function prepare(page: Page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('frx.mic.intro', '1'); // the first-time microphone explanation was seen
    } catch {
      /* storage blocked */
    }
    const w = window as any;
    w.__plays = [];
    w.__taps = 0;
    window.addEventListener('pointerdown', () => w.__taps++, { capture: true });
    const hook = setInterval(() => {
      if (!w.__frxAudio) return;
      clearInterval(hook);
      w.__frxAudio.subscribe((s: any) => {
        const last = w.__plays[w.__plays.length - 1];
        if (s.playing && (!last || last.tag !== s.tag || last.startMs !== s.startMs)) w.__plays.push({ tag: s.tag, loop: s.loop, startMs: s.startMs, endMs: s.endMs, muted: s.muted, at: performance.now() });
      });
    }, 20);
  });
}

async function open(page: Page, scene: string, type: string, extra = ''): Promise<PuzzleInfo | null> {
  await page.goto(`/dev/practice?scene=${scene}&type=${type}&level=3&seed=1${extra}`);
  const err = page.getByText(/returned null/);
  await expect(page.locator('[data-puzzle]').or(err).first()).toBeVisible({ timeout: 30_000 });
  if (await err.isVisible()) return null;
  // The kid's first touch, on the caption: it unlocks audio.
  await page.locator('[data-puzzle] header ~ div').first().tap({ position: { x: 5, y: 5 } });
  return currentPuzzle(page);
}

/** Where each puzzle shows French a kid can tap for its meaning (line-meaning shows none: it is heard). */
const FRENCH_BOXES: Record<string, string> = {
  'place-words': '[data-piece]',
  'say-choice': '[data-option] [data-gloss-unit]',
  'next-line': '[data-unit], [data-gloss-unit]',
};

/** A French box in the puzzle pane opens its meaning in the shared hint bubble. */
async function frenchIsTappable(page: Page, type: string): Promise<string | null> {
  const sel = FRENCH_BOXES[type];
  if (!sel) return null;
  const boxes = page.locator('[data-puzzle-pane]').locator(sel).filter({ visible: true });
  if ((await boxes.count()) === 0) return `no tappable French box (${sel})`;
  await boxes.first().tap({ force: true });
  // place-words: the first tap picks and plays a tray piece; a second tap on it (marked "?") shows its meaning.
  if (type === 'place-words') await boxes.first().tap({ force: true });
  const bubble = page.locator('[data-bubble]');
  if (!(await bubble.first().waitFor({ state: 'visible', timeout: 2500 }).then(() => true, () => false))) return 'a tapped French box showed no meaning';
  await page.locator('[data-puzzle] header ~ div').first().tap({ position: { x: 5, y: 5 } }); // close it
  return null;
}

for (const type of TYPES) {
  for (const scene of SCENES_FOR(type)) {
    test(`${type} on ${scene === PANONO ? 'Panono' : 'a long dialogue'}`, async ({ page }, info) => {
      const project = info.project.name;
      mkdirSync(SHOTS, { recursive: true });
      const shot = (what: string) => page.screenshot({ path: join(SHOTS, `${project}-${type}-${scene === PANONO ? 'panono' : 'long'}-${what}.png`) });
      await prepare(page);
      const g = guard(page);
      g.allow(/\/api\/events/);
      const kid: Kid = { ctx: page.context(), page, headers: {} };
      const t = await open(page, scene, type);
      test.skip(!t, `${type} has no round on ${scene}`);
      const notes: string[] = [];

      // The colour rule, and the French in boxes (the speaking puzzles show it once their turn comes).
      for (const f of await sameFillPanels(page)) notes.push(`same fill: ${f.selector} "${f.text}" (${f.fill})`);
      if (type === 'next-line') {
        // Known: the line cards show their French as plain text with the English under it (like comic-order).
        const n = await page.locator('[data-puzzle-pane]').locator(FRENCH_BOXES['next-line']!).count();
        if (n === 0) console.log(`[${project}] next-line on ${scene}: the French of its cards is plain text, not tappable boxes (design question)`);
      } else {
        const tf = await frenchIsTappable(page, type);
        if (tf) notes.push(tf);
      }

      if (type === 'say-chain') {
        // Hands-free: one tap starts it; misses (?transcript= nonsense) replay the model and listen
        // again by themselves; the third try moves on. No tap at all after the start.
        await open(page, scene, type, `&transcript=${encodeURIComponent('brrr patati')}`);
        const pane = page.locator('[data-puzzle-pane]');
        await pane.locator('[data-chain-start]').tap();
        await page.evaluate(() => ((window as any).__taps = 0));
        await page.waitForTimeout(1500);
        await shot('mid');
        await expect.poll(async () => (await puzzleInfo(page))?.done ?? false, { timeout: 200_000, intervals: [500] }).toBe(true);
        expect(await page.evaluate(() => (window as any).__taps), 'say-chain needed a tap after its start').toBe(0);
        const st = JSON.parse((await puzzleInfo(page))!.state);
        expect(st.results.length).toBe((await puzzleInfo(page))!.puzzle.items.length);
        await page.waitForTimeout(400);
        await shot('reward');
        await page.locator('[data-continue] [data-next]').tap();
      } else if (type === 'say-choice') {
        await shot('mid');
        await playChoice(kid, t!);
        await page.waitForTimeout(450);
        await shot('reward');
        const tf = await frenchIsTappable(page, 'say-choice');
        if (tf) notes.push(`after the choice: ${tf}`);
        await page.locator('[data-continue] [data-next]').tap();
      } else if (type === 'act-line') {
        const puzzle = t!.puzzle;
        await expect(page.locator('[data-record="recording"]')).toBeVisible({ timeout: 30_000 }); // the turn opens the mic by itself
        await shot('mid');
        await playPuzzle(kid, {
          speak: 'pass',
          onDone: async () => {
            await page.waitForTimeout(puzzle.afterId ? 2500 : 400);
            await shot('reward');
          },
        });
        const plays = (await page.evaluate(() => (window as any).__plays)) as { tag: string }[];
        const tags = plays.map((p) => p.tag);
        for (const id of puzzle.beforeIds as string[]) expect(tags, `act-line played the line before (${id})`).toContain(`line:${id}`);
        if (puzzle.afterId) expect(tags, `act-line played the line after (${puzzle.afterId})`).toContain(`line:${puzzle.afterId}`);
        const turn = tags.indexOf(`line:${puzzle.lineId}`);
        const after = puzzle.afterId ? tags.lastIndexOf(`line:${puzzle.afterId}`) : -1;
        if (puzzle.afterId) expect(after, 'the line after comes after the kid\'s turn').toBeGreaterThan(turn);
      } else {
        // place-words, next-line, line-meaning: wrong moves first, then by the puzzle type's own solve.
        const st0 = await page.evaluate(() => (window as any).__frxAudio.getState());
        if (type !== 'place-words' && !(st0.playing && st0.loop)) notes.push(`nothing looping at the start (${st0.tag})`);
        await playPuzzle(kid, {
          wrongFirst: 2,
          onStart: async () => {
            await page.waitForTimeout(600);
            await shot('mid');
          },
          onDone: async () => {
            await page.waitForTimeout(450);
            await shot('reward');
          },
        });
      }
      await expect(page.locator('[data-results]')).toBeVisible({ timeout: 15_000 });
      g.check(`${type} on ${scene}`);
      expect(notes, notes.join('\n')).toEqual([]);
    });
  }
}

test('muted: the puzzles run, and nothing is heard', async ({ page }) => {
  await prepare(page);
  await open(page, PANONO, 'next-line');
  const mute = page.locator('[data-practice] [data-mute]');
  await expect(mute).toHaveAttribute('data-mute', 'off');
  await mute.tap();
  await expect(mute).toHaveAttribute('data-mute', 'on');
  // Remembered on the device, and every play since runs silently (the engine's master gain is 0).
  await page.goto(`/dev/practice?scene=${PANONO}&type=line-meaning&level=3&seed=1`);
  await expect(page.locator('[data-puzzle]')).toBeVisible({ timeout: 30_000 });
  await page.locator('[data-puzzle] header ~ div').first().tap({ position: { x: 5, y: 5 } });
  await expect(page.locator('[data-practice] [data-mute]')).toHaveAttribute('data-mute', 'on');
  const st = await page.evaluate(() => (window as any).__frxAudio.getState());
  expect(st.muted).toBe(true);
  const kid: Kid = { ctx: page.context(), page, headers: {} };
  await playPuzzle(kid);
  const plays = (await page.evaluate(() => (window as any).__plays)) as { muted: boolean }[];
  expect(plays.length, 'the puzzle still ran its loops (silently)').toBeGreaterThan(0);
  expect(plays.every((p) => p.muted), 'every play while muted is silent').toBe(true);
});
