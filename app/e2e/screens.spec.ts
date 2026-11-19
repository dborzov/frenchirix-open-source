// Screenshots for looking at the UI: `npm run screens` writes test-results/screens/<project>-<name>.png
// (E2E_SHOTS elsewhere).
// Add a route to SHOTS when you build a screen.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { settled } from './drive';

const OUT = process.env.E2E_SHOTS ?? 'test-results/screens';

// The Vite dev server is slow to go idle while the other specs load it: wait for idle a while, then shoot.
test.describe.configure({ timeout: 90_000 });

const SHOTS: [string, string][] = [
  ['avatar', '/avatar'],
  ['dev-avatar', '/dev/avatar'],
  ['home', '/'],
  ['unlock', '/unlock'],
  ['episodes', '/episodes'],
  ['episode', '/episodes/s01e04'],
  ['chest', '/chest/c_fixture01'],
  ['profile', '/profile'],
  ['login', '/login'],
  ['players', '/players'],
  ['shop', '/shop'],
  ['friends', '/friends'],
  ['league', '/league'],
  ['achievements', '/achievements'],
  ['version', '/version'],
  ['dev-ui', '/dev/ui'],
];

for (const [name, path] of SHOTS) {
  test(`screenshot ${name}`, async ({ page }, info) => {
    await page.goto(path);
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
    await settled(page);
    await page.screenshot({ path: `${OUT}/${info.project.name}-${name}.png`, fullPage: name.startsWith('dev') });
    expect(await offscreen(page), `${name}: cut off at the side of the screen`).toEqual([]);
  });
}

// The main action of a screen is on screen on arrival, without scrolling, above the phone's tab bar
// (the user plays on iPad, upright and on its side, and on phones).
const REACH: [string, string, string][] = [
  ['scene: the practice button', '/scene/s01e04-0016-0017', '[data-practice-start]'],
  ['home: the next quest', '/', '[data-testid="quest"][data-state="next"]'],
  ['home after "Do more": the next quest', '/?flow=more', '[data-testid="quest"][data-state="next"]'],
];

for (const [name, path, sel] of REACH) {
  test(`reachable: ${name}`, async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('frenchirix.onb.welcome', '1');
      } catch {
        // no storage: the welcome shows, and the check fails visibly
      }
    });
    await page.goto(path);
    const target = page.locator(sel).first();
    await expect(target).toBeVisible({ timeout: 20_000 });
    // Home brings the next quest into view once the scene titles are in: poll until it settles.
    await expect.poll(() => inView(target), { timeout: 5000 }).toBe('in view');
  });
}

/** 'in view' when the element is on screen above the phone's tab bar (or anywhere on screen, over it); else where it is. */
function inView(target: Locator, overTabBar = false): Promise<string> {
  return target.evaluate((el, over) => {
    const tabbar = over ? undefined : [...document.querySelectorAll('nav')].find((n) => n.getBoundingClientRect().top > innerHeight / 2);
    const bottom = tabbar ? tabbar.getBoundingClientRect().top : innerHeight;
    const r = el.getBoundingClientRect();
    return r.top >= 0 && r.bottom <= bottom + 1 ? 'in view' : `${Math.round(r.top)}..${Math.round(r.bottom)} with the screen ending at ${Math.round(bottom)}`;
  }, overTabBar);
}

// A short phone (375x667, an iPhone SE): the one thing to do is still in reach. Once, in the phone project.
test.describe('a short phone', () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test('every quest done: "Do more" in view on arrival', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone', 'one project is enough');
    await page.addInitScript(() => localStorage.setItem('frenchirix.onb.welcome', '1'));
    await page.goto('/?flow=done');
    const target = page.locator('[data-do-more-button]');
    await expect(target).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => inView(target), { timeout: 5000 }).toBe('in view');
  });

  test('the first-open welcome scrolls to its button', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone', 'one project is enough');
    await page.goto('/?welcome=1');
    const welcome = page.getByTestId('welcome');
    await expect(welcome).toBeVisible({ timeout: 20_000 });
    await settled(page);
    // A kid's swipe (a wheel here): the welcome (over the tab bar) scrolls, so its button comes into reach.
    await page.mouse.move(180, 300);
    await page.mouse.wheel(0, 1000);
    await expect.poll(() => inView(page.locator('[data-welcome-go]'), true), { timeout: 5000 }).toBe('in view');
  });
});

/**
 * The one layout rule every screen keeps at every size: nothing sticks out at the side of the screen
 * (the page clips sideways overflow, so it would be cut off), unless a scroller or a frame of its own
 * clips it. Checked once the entrance animations have ended (the shop's tiles slam in from 150%:
 * mid-way they stick out).
 */
async function offscreen(page: Page): Promise<string[]> {
  await settled(page);
  return page.evaluate(() => {
    const W = innerWidth;
    const out: string[] = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || (r.right <= W + 2 && r.left >= -2)) continue;
      if (getComputedStyle(el).position === 'fixed' || el.closest('[data-fx], [aria-hidden="true"]')) continue;
      let clipped = false;
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) if (getComputedStyle(a).overflowX !== 'visible') clipped = true;
      if (!clipped) out.push(`${el.tagName.toLowerCase()}.${String(el.getAttribute('class') ?? '').split(' ')[0]} at ${Math.round(r.left)}..${Math.round(r.right)} of ${W} "${(el.textContent ?? '').trim().slice(0, 30)}"`);
    }
    return out.slice(0, 10);
  });
}
