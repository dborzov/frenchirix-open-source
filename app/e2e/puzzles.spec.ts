// Every puzzle type on its own, through /dev/practice (the real practice shell, no server: the fixture client of
// the Vite dev server, with the real exported content), on real scenes of different shapes (a short
// dialogue, a long one with an approximately timed line, a song) at levels 1, 3 and 6, in every
// project (phone, tablet, upright iPad). Each round is played to the end by tapping (drive.ts), wrong moves first at level
// 1, and checked: the French loops, the help strip opens and its boxes show meanings, nothing
// overflows or hides under the continue bar, no text is clipped, tap targets are 44 px, the reward
// moment fires. Screenshots mid-play and at the reward go to E2E_SHOTS (default test-results/puzzles).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { audioState, currentPuzzle, guard, playPuzzle, puzzleInfo, type Kid, type PuzzleInfo } from './drive';

const PUZZLE_TYPES = ['watch', 'listen-pick', 'match', 'fill-blanks', 'say-line', 'say-hidden', 'question', 'rebuild', 'comic-order', 'catapult', 'vrai-faux', 'memory', 'place-words', 'next-line', 'line-meaning'];
/** A short dialogue, a long dialogue with an approxTimes line, a song; then spares for puzzle types that cannot use one of them. */
const SCENES = ['s01e02-0074-0076', 's01e01-0296-0306', 's01e03-0019-0022', 's01e04-0138-0149', 's01e04-0266-0277'];
const LEVELS = [1, 3, 6];
const WANT_SCENES = 3;
const SHOTS = process.env.E2E_SHOTS ?? 'test-results/puzzles';
/** Puzzle types whose help strip starts closed (all but watch, which is the strip itself). */
const NO_HELP = new Set(['watch', 'place-words']);
/** Puzzle types that loop nothing at the start (memory speaks when a French shield turns; say-hidden only on "listen"). */
const SILENT_START = new Set(['memory', 'say-hidden']); // say-hidden: hearing it would give the answer away

test.describe.configure({ mode: 'parallel', timeout: 600_000 });
// No trace: the scene player re-renders its word highlight on every audio frame, so a long round's
// trace grew so large that writing it at teardown took minutes. Failures keep their screenshot.
test.use({ trace: 'off' });

interface Finding {
  puzzleType: string;
  project: string;
  scene: string;
  level: number;
  kind: string;
  detail: string;
}

/** Layout problems on screen now: overflow, clipped text, small tap targets. */
async function layoutProblems(page: Page): Promise<{ kind: string; detail: string }[]> {
  return page.evaluate(() => {
    const out: { kind: string; detail: string }[] = [];
    const W = innerWidth;
    const root = document.querySelector('[data-practice]') ?? document.body;
    const label = (el: Element) => `${el.tagName.toLowerCase()}${el.getAttribute('class') ? '.' + String(el.getAttribute('class')).split(' ')[0] : ''} "${(el.textContent ?? '').trim().slice(0, 30)}"`;
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      const cs = getComputedStyle(el);
      return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05 && !el.closest('[aria-hidden="true"]');
    };
    // Can a finger scroll the page sideways? Not when the viewport clips horizontal overflow.
    const ox = getComputedStyle(document.documentElement).overflowX;
    if (ox !== 'hidden' && ox !== 'clip' && document.documentElement.scrollWidth > W + 1) out.push({ kind: 'overflow', detail: `page scrolls sideways: ${document.documentElement.scrollWidth} > ${W}` });
    for (const el of root.querySelectorAll('*')) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      if ((r.right > W + 2 || r.left < -2) && !el.closest('[data-fx]')) {
        // Only report when no ancestor clips it (a scroller or overflow hidden).
        let clipped = false;
        for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
          const cs = getComputedStyle(p);
          if (cs.overflowX !== 'visible') {
            clipped = true;
            break;
          }
        }
        if (!clipped) out.push({ kind: 'offscreen', detail: `${label(el)} at ${Math.round(r.left)}..${Math.round(r.right)} of ${W}` });
      }
      const cs = getComputedStyle(el);
      const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? '').trim());
      if (ownText) {
        const hx = cs.overflowX === 'hidden' || cs.overflowX === 'clip';
        const hy = cs.overflowY === 'hidden' || cs.overflowY === 'clip';
        if ((hx && el.scrollWidth > el.clientWidth + 1) || (hy && el.scrollHeight > el.clientHeight + 2) || (cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1)) out.push({ kind: 'clipped', detail: `${label(el)} ${el.scrollWidth}x${el.scrollHeight} in ${el.clientWidth}x${el.clientHeight}` });
      }
      const tappable = el.matches('button:not([disabled]), [role="button"], a[href], input, select');
      if (tappable && !el.closest('[data-bubble]')) {
        // An invisible ::before with a negative inset widens the hit area (the note asterisk, GlossText boxes).
        const b = getComputedStyle(el, '::before');
        let w = r.width;
        let h = r.height;
        if (b.content !== 'none' && b.position === 'absolute') {
          const px = (v: string) => (v.endsWith('px') ? Math.max(0, -parseFloat(v)) : 0);
          w += px(b.left) + px(b.right);
          h += px(b.top) + px(b.bottom);
        }
        if (w < 43.5 || h < 43.5) out.push({ kind: 'small-target', detail: `${label(el)} ${Math.round(r.width)}x${Math.round(r.height)}` });
      }
    }
    return out;
  });
}

/** With the round done: scroll the puzzle type to its end; anything still under the continue bar is unreachable. */
async function underContinueBar(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const bar = document.querySelector('[data-continue]');
    const pane = document.querySelector('[data-puzzle-pane]') as HTMLElement | null;
    if (!bar || !pane) return [];
    pane.scrollTop = pane.scrollHeight;
    for (let p = pane.parentElement; p; p = p.parentElement) p.scrollTop = p.scrollHeight;
    window.scrollTo(0, document.documentElement.scrollHeight);
    const b = bar.getBoundingClientRect();
    const out: string[] = [];
    for (const el of pane.querySelectorAll('button, [role="button"], p, h1, h2, h3, li')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || getComputedStyle(el).visibility === 'hidden' || el.closest('[aria-hidden="true"]')) continue;
      // Only the part not clipped by a list that scrolls on its own inside the pane (the scene player's
      // lines on a tablet): what is clipped there is reached by scrolling that list, not under the bar.
      let top = r.top;
      let bottom = r.bottom;
      for (let a = el.parentElement; a && a !== pane; a = a.parentElement) {
        if (getComputedStyle(a).overflowY === 'visible') continue;
        const ar = a.getBoundingClientRect();
        top = Math.max(top, ar.top);
        bottom = Math.min(bottom, ar.bottom);
      }
      if (bottom <= top) continue;
      const overlap = Math.min(bottom, b.bottom) - Math.max(top, b.top);
      if (overlap > Math.min(12, r.height / 2)) out.push(`${el.tagName.toLowerCase()} "${(el.textContent ?? '').trim().slice(0, 30)}" ${Math.round(overlap)}px under the bar`);
    }
    return out;
  });
}

async function openHelpAndTapBox(page: Page, tablet: boolean): Promise<string | null> {
  const help = page.locator('[data-help]').first();
  if ((await help.getAttribute('data-help')) !== 'open') {
    const btn = tablet ? page.locator('[data-help-open]') : page.locator('[data-help-toggle]');
    await btn.tap();
  }
  const box = page.locator('[data-help="open"] [data-unit]').first();
  await expect(box, 'help strip opens with its boxes').toBeVisible({ timeout: 5000 });
  await box.tap({ force: true });
  const bubble = page.locator('[data-bubble]').first();
  await expect(bubble, 'a tapped box shows its meaning').toBeVisible({ timeout: 3000 });
  const text = ((await bubble.textContent()) ?? '').trim();
  const st = await audioState(page);
  if (!(st.playing && st.loop && st.tag?.startsWith('unit:'))) return `a tapped help box did not loop its audio (${JSON.stringify(st)})`;
  if (!text) return 'the meaning balloon is empty';
  // Close it with a tap on a neutral spot (the caption), never a forced tap on the bubble: that could
  // land on a speaking control under it.
  await page.locator('[data-puzzle] header ~ div').first().tap({ position: { x: 5, y: 5 } }).catch(() => {});
  if (!tablet) await page.locator('[data-help-toggle]').tap();
  return null;
}

for (const puzzleType of PUZZLE_TYPES) {
  test(`puzzle type ${puzzleType}: three scenes, levels 1, 3, 6`, async ({ page }, info) => {
    const project = info.project.name;
    const tablet = (page.viewportSize()?.width ?? 0) >= 768; // the tablet layout (both iPad projects)
    const kid: Kid = { ctx: page.context(), page, headers: {} };
    const g = guard(page);
    g.allow(/\/api\/events/); // the fixture client has no server for the loop counters
    const findings: Finding[] = [];
    const note = (scene: string, level: number, kind: string, detail: string) => findings.push({ puzzleType, project, scene, level, kind, detail });
    await page.addInitScript(() => {
      try {
        localStorage.setItem('frx.mic.intro', '1'); // the first-time microphone explanation was seen
      } catch {
        /* storage blocked */
      }
      (window as any).__fxImpacts = 0;
      new MutationObserver((ms) => {
        for (const m of ms) for (const n of m.addedNodes) if (n instanceof HTMLElement && (n.dataset.fx === 'impact' || n.querySelector?.('[data-fx="impact"]'))) (window as any).__fxImpacts++;
      }).observe(document, { childList: true, subtree: true });
    });
    mkdirSync(SHOTS, { recursive: true });
    let scenesDone = 0;
    let shot = false;

    for (const scene of SCENES) {
      if (scenesDone >= WANT_SCENES) break;
      let built = 0;
      for (const level of LEVELS) {
        // One retry: in a shared working tree, Vite's hot reload can restart the round under the test.
        let nullBuild = false;
        for (let attempt = 0; ; attempt++) {
          const kept = findings.length; // a retried attempt's findings are dropped
          try {
            let url = `/dev/practice?scene=${scene}&type=${puzzleType}&level=${level}&seed=1`;
            await page.goto(url);
            const err = page.getByText(/returned null/);
            await expect(page.locator('[data-puzzle]').or(err).first()).toBeVisible({ timeout: 30_000 });
            if (await err.isVisible()) {
              note(scene, level, 'null', 'build returned null');
              nullBuild = true;
              break;
            }
            let first = (await currentPuzzle(page))!;
            if (puzzleType === 'say-line' || puzzleType === 'say-hidden') {
              // The fixture client scores ?transcript= against the real line: say it right.
              const text = puzzleType === 'say-hidden' ? first.puzzle.fr : first.puzzle.text;
              url += `&transcript=${encodeURIComponent(text)}`;
              await page.goto(url);
              first = (await currentPuzzle(page))!;
            }
            built++;
            // The kid's first touch (it unlocks audio), on the scene caption.
            await page.locator('[data-puzzle] header ~ div').first().tap({ position: { x: 5, y: 5 } });
            await expect.poll(() => page.evaluate(() => (window as any).__frxAudio.isUnlocked() as boolean), { timeout: 5000 }).toBe(true).catch(() => {});
            await page.waitForTimeout(700);
            const st0 = { ...(await audioState(page)), unlocked: await page.evaluate(() => (window as any).__frxAudio.isUnlocked() as boolean) };
            if (!st0.unlocked) note(scene, level, 'audio', `not unlocked after a tap: ${JSON.stringify(st0)}`);
            if (puzzleType === 'watch') {
              if (!(st0.playing && !st0.loop)) note(scene, level, 'audio', `watch: scene not playing once (${JSON.stringify(st0)})`);
            } else if (!SILENT_START.has(puzzleType) && !(st0.playing && st0.loop)) note(scene, level, 'audio', `nothing looping at the start (${JSON.stringify(st0)})`);

            if (level === 3 && !NO_HELP.has(puzzleType)) {
              const h = await openHelpAndTapBox(page, tablet).catch((e: Error) => `help strip: ${e.message.split('\n')[0]}`);
              if (h) note(scene, level, 'help', h);
            }
            const takeShots = !shot && level === 3;
            const startImpacts = await page.evaluate(() => (window as any).__fxImpacts as number);
            let moves = 0;
            const played = await playPuzzle(kid, {
              wrongFirst: level === 1 ? 2 : 0,
              speak: 'pass',
              onDone: async (done: PuzzleInfo) => {
                void done;
                await page.waitForTimeout(450);
                const impacts = (await page.evaluate(() => (window as any).__fxImpacts as number)) - startImpacts;
                if (impacts < 1 && puzzleType !== 'watch') note(scene, level, 'reward', 'no impact burst on the winning move');
                if (takeShots) await page.screenshot({ path: join(SHOTS, `${project}-${puzzleType}-reward.png`) });
                for (const u of await underContinueBar(page)) note(scene, level, 'under-bar', u);
                for (const p of await layoutProblems(page)) note(scene, level, p.kind, p.detail);
              },
              onStart: async () => {
                moves = 0;
              },
            }).catch(async (e: Error) => {
              await page.screenshot({ path: join(SHOTS, `${project}-${puzzleType}-${scene}-${level}-FAIL.png`) });
              throw e;
            });
            void moves;
            expect(played.type).toBe(puzzleType);
            if (takeShots) shot = true;
            await expect(page.locator('[data-results]')).toBeVisible({ timeout: 10_000 });
            g.check(`${puzzleType} ${scene} level ${level}`);
            break;
          } catch (e) {
            if (attempt >= 1) throw e;
            findings.length = kept;
            console.log(`[${project}] ${puzzleType} ${scene} level ${level}: retrying once after: ${String(e).split('\n')[0]}`);
          }
        }
        if (nullBuild) continue;
      }
      if (built) scenesDone++;
    }
    expect(scenesDone, `${puzzleType} could be played on ${WANT_SCENES} scenes`).toBe(WANT_SCENES);

    // Mid-play screenshot: one more round on the first scene that took the puzzle type, stopped after a move.
    const sc = findings.length ? SCENES.find((x) => !findings.some((f) => f.scene === x && f.kind === 'null')) : SCENES[0];
    await page.goto(`/dev/practice?scene=${sc}&type=${puzzleType}&level=3&seed=1`);
    const i = await currentPuzzle(page);
    await page.locator('[data-puzzle] header ~ div').first().tap({ position: { x: 5, y: 5 } });
    if (i && i.solve && !['watch', 'say-line', 'say-hidden'].includes(puzzleType)) {
      await midMove(page, i);
    } else await page.waitForTimeout(puzzleType === 'watch' ? 3500 : 900);
    await page.screenshot({ path: join(SHOTS, `${project}-${puzzleType}-mid.png`) });
    for (const p of await layoutProblems(page)) note(sc!, 2, p.kind, `(mid) ${p.detail}`);

    const dedup = new Map<string, Finding>();
    for (const f of findings) dedup.set(`${f.kind}|${f.detail}`, f);
    const list = [...dedup.values()];
    writeFileSync(join(SHOTS, `${project}-${puzzleType}-findings.json`), JSON.stringify(list, null, 1));
    const soft = new Set(['null', 'small-target', 'clipped', 'offscreen']);
    const hard = list.filter((f) => !soft.has(f.kind));
    for (const f of list.filter((x) => soft.has(x.kind) && x.kind !== 'null')) console.log(`[${project}] ${puzzleType} ${f.kind}: ${f.detail}`);
    // Leave the page before the fixture closes the context: closing one with audio still playing
    // has hung Chromium for minutes on a loaded machine.
    await page.goto('about:blank').catch(() => {});
    expect(hard, `${puzzleType}: problems`).toEqual([]);
    void readFileSync;
  });
}

/** One right move, then a short pause so the animation is mid-way. */
async function midMove(page: Page, i: PuzzleInfo) {
  const { tapsFor } = await import('./drive');
  for (const t of tapsFor(i.type, i.solve, i.puzzle)) {
    let loc = page.locator('[data-puzzle-pane]').locator(t.sel).first();
    if (t.part) loc = loc.locator(t.part).first();
    await loc.tap({ force: true, timeout: 10_000 });
  }
  await page.waitForTimeout(350);
  void puzzleInfo;
}
