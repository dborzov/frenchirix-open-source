// The /dev portal: every page loads and shows its content without a page error (fixture Vite).
import { expect, test } from '@playwright/test';
import { settled } from './drive';

const PAGES: [string, string][] = [
  ['/dev', '[data-dev-link="/dev/practices"]'],
  ['/dev/scenes', '[data-dev-scene]'],
  ['/dev/scenes?scene=s01e03-0023-0026', '[data-dev-line="s01e03-0023"]'],
  ['/dev/practice', '[data-coverage]'], // without a puzzle type: the practice viewer
  ['/dev/practices?scene=s01e03-0023-0026&level=1&seed=1', '[data-plan-row="0"]'],
  ['/dev/practices?scene=s01e03-0023-0026&level=3&seed=3', '[data-plan-row="0"]'],
  ['/dev/types_of_puzzles', '[data-type-card="listen-pick"]'],
  ['/dev/panono', '[data-coverage]'],
  ['/dev/loops', '[data-unit-pick]'],
  ['/dev/scene', '[data-strip]'],
  ['/dev/ui', 'h2'],
];

for (const [path, sel] of PAGES) {
  test(`dev page ${path}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(path);
    await expect(page.locator(sel).first()).toBeVisible({ timeout: 30_000 });
    expect(errors).toEqual([]);
  });
}

test('the Panono practice plays from the plan and keeps its place locally', async ({ page }) => {
  await page.goto('/dev/panono?level=1&seed=1&speak=0');
  await page.locator('[data-play-from="2"]').click();
  await expect(page.locator('[data-practice]')).toBeVisible({ timeout: 20_000 });
  // Where am I: the level the practice is for and the progress bar, at the puzzle played from.
  await expect(page.locator('[data-practice] [data-level-tag="1"]')).toBeVisible();
  await expect(page.locator('[data-practice] [role="progressbar"]')).toHaveAttribute('aria-valuenow', '2');
});

test('the question and answer play buttons on /dev/scenes play the static clips', async ({ page }) => {
  const asked: string[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url()).pathname;
    if (u.startsWith('/media/q/') || u.startsWith('/api/tts')) asked.push(u);
  });
  await page.goto('/dev/scenes?scene=s01e03-0023-0026');
  const q = page.locator('[data-dev-question]').first();
  await expect(q).toBeVisible({ timeout: 20_000 });
  for (const sel of ['[data-question-clip]', '[data-answer-clip]']) {
    asked.length = 0;
    const ok = page.waitForResponse((r) => new URL(r.url()).pathname.startsWith('/media/q/') && r.ok());
    await q.locator(sel).first().click();
    await ok;
    await expect.poll(() => page.evaluate(() => (window as any).__frxAudio.getState().playing)).toBe(true);
    expect(asked.length, sel).toBeGreaterThan(0);
    expect(asked.every((u) => u.startsWith('/media/q/')), asked.join(' ')).toBe(true);
  }
});

test('the playback bar: a tap at 50% plays from 50% of the scene; a line control jumps there', async ({ page }) => {
  await page.goto('/dev/scenes?scene=s01e03-0023-0026');
  const bar = page.locator('[data-scene-bar] [role="slider"]').first();
  await expect(bar).toBeVisible({ timeout: 20_000 });
  const box = (await bar.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const dur = await page.evaluate(async () => (await (await fetch('/data/scenes/s01e03-0023-0026.json')).json()).audio.durationMs as number);
  await expect.poll(async () => page.evaluate(() => (window as any).__frxAudio.getState().playing)).toBe(true);
  const pos = await page.evaluate(() => (window as any).__frxAudio.getPositionMs() as number);
  expect(Math.abs(pos - dur / 2)).toBeLessThan(dur * 0.05);
  // The second line's play control: the scene plays on from that line.
  const line = page.locator('[data-line-seek]').nth(1);
  await line.click({ force: true });
  const lineId = await line.getAttribute('data-play-line');
  const start = await page.evaluate(async (id) => (await (await fetch('/data/scenes/s01e03-0023-0026.json')).json()).lines.find((l: any) => l.id === id).startMs as number, lineId);
  const st = await page.evaluate(() => (window as any).__frxAudio.getState());
  expect(st.tag).toContain('scene:');
  const p2 = await page.evaluate(() => (window as any).__frxAudio.getPositionMs() as number);
  expect(p2).toBeGreaterThanOrEqual(start - 200);
  expect(p2).toBeLessThan(start + 1500);
});

test('the hint bubble: English only, tail on the box, hides on its own tap and on a tap elsewhere', async ({ page }) => {
  await page.goto('/dev/scenes?scene=s01e03-0023-0026');
  await expect(page.locator('[data-strip] [data-unit]').first()).toBeVisible({ timeout: 20_000 });
  // A unit whose English is not its French (proper names are the same in both).
  const scene = await page.evaluate(async () => (await (await fetch('/data/scenes/s01e03-0023-0026.json')).json()) as any);
  const u = scene.lines.flatMap((l: any) => l.units).find((x: any) => !x.en.toLowerCase().includes(x.fr.toLowerCase()));
  const unit = page.locator(`[data-strip] [data-unit="${u.id}"]`).first();
  await unit.scrollIntoViewIfNeeded();
  await unit.click();
  const bubble = page.locator('[data-bubble]');
  await expect(bubble).toBeVisible();
  const fr = (await unit.textContent())!.trim();
  expect((await bubble.textContent())!.toLowerCase()).not.toContain(fr.toLowerCase());
  await settled(page); // the box's pop animation
  const b = (await unit.boundingBox())!;
  const tip = await page.locator('[data-hint-layer]').evaluate((el) => ({ x: Number((el as HTMLElement).dataset.tipX), y: Number((el as HTMLElement).dataset.tipY), side: (el as HTMLElement).dataset.side }));
  expect(tip.x).toBeGreaterThanOrEqual(b.x - 3);
  expect(tip.x).toBeLessThanOrEqual(b.x + b.width + 3);
  expect(Math.abs(tip.y - (tip.side === 'below' ? b.y + b.height : b.y))).toBeLessThanOrEqual(4);
  // The tap on the bubble is the bubble's: it closes it, and nothing under it gets the tap.
  const bb = (await bubble.boundingBox())!;
  const at = { x: bb.x + bb.width / 2, y: bb.y + bb.height / 2 };
  const topIsBubble = await page.evaluate(({ x, y }) => {
    (window as any).__under = 0;
    const layer = document.querySelector('[data-hint-layer]') as HTMLElement;
    const hit = document.elementFromPoint(x, y);
    // What lies beneath: the element at that point with the bubble out of the way (not display:
    // none, which would restart its pop animation).
    const pe = layer.style.pointerEvents;
    layer.querySelectorAll<HTMLElement>('*').forEach((e) => (e.style.pointerEvents = 'none'));
    const under = document.elementFromPoint(x, y);
    layer.querySelectorAll<HTMLElement>('*').forEach((e) => (e.style.pointerEvents = pe));
    under?.addEventListener('pointerdown', () => (window as any).__under++, true);
    under?.addEventListener('click', () => (window as any).__under++, true);
    return !!hit && layer.contains(hit);
  }, at);
  expect(topIsBubble, 'a tap on the bubble lands on the bubble').toBe(true);
  await page.mouse.click(at.x, at.y);
  await expect(bubble).toBeHidden();
  expect(await page.evaluate(() => (window as any).__under), 'the tap on the bubble reached the element beneath').toBe(0);
  await unit.click({ force: true }); // it pulses while it loops: never "stable" for Playwright
  await expect(bubble).toBeVisible();
  await page.locator('h1').first().click();
  await expect(bubble).toBeHidden();
});
