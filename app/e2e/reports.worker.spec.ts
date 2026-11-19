// "Quelque chose ne va pas ?" and the activity log (docs/intent.md, "When something goes wrong"), against
// a real local Worker in TEST_MODE. The first practice shows the tip under the flag in its header; the kid
// taps it away, opens the form from the flag, types and sends; « Merci ! », and the same puzzle is still on
// screen. The Worker's D1 then has the report with its context (the practice, the puzzle and its state, the
// pane, the last events) and the activity log has the kid's events and the server's own. On a kid's first
// error panel (a failed load) the tip points at the panel's button, and a report from there carries the
// error's detail line. Screenshots of the flag, the tip, the form, the panel and the profile in E2E_SHOTS
// (default test-results/reports).
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { currentPuzzle, puzzleInfo, settled } from './drive';
import { api, expect, test, unlockViaApi, type MetaServer } from './meta-server';
import { COMPOSER_VERSION } from '../shared/practice/version';
import { translate } from '../shared/i18n';

test.use({ devBuild: true, trace: 'off' });
test.describe.configure({ timeout: 240_000 });

const SHOTS = process.env.E2E_SHOTS ?? 'test-results/reports';
const APP = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

/** Rows of the Worker's local D1 (the same command the session-start check runs, with --local). */
function query<T = Record<string, unknown>>(server: MetaServer, sql: string): T[] {
  const out = execFileSync(join(APP, 'node_modules', '.bin', 'wrangler'), ['d1', 'execute', 'DB', '--local', '--persist-to', server.state, '--json', '--command', sql], { cwd: APP, env: { ...process.env, CI: '1' }, encoding: 'utf8' });
  return (JSON.parse(out.slice(out.indexOf('['))) as { results: T[] }[])[0]!.results;
}

async function shoot(page: Page, name: string, project: string): Promise<void> {
  await settled(page);
  await page.screenshot({ path: `${SHOTS}/${project}-${name}.png` });
}

/** A new kid whose device has not seen the tip yet (newKidPage marks it seen for the other specs). */
async function freshKid(newKidPage: () => Promise<{ page: Page }>, server: MetaServer): Promise<Page> {
  const { page } = await newKidPage();
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('frx.e2e.tipCleared')) {
      localStorage.removeItem('frenchirix.onb.tip.report');
      sessionStorage.setItem('frx.e2e.tipCleared', '1');
    }
  });
  await page.goto(server.base + '/');
  await expect.poll(async () => (await page.context().cookies()).some((c) => c.name === 'fx_sid'), { timeout: 20_000 }).toBe(true);
  return page;
}

test('a report from the practice header: the tip, the form, « Merci ! », and the Worker has it with its context', async ({ server, newKidPage }, info) => {
  const page = await freshKid(newKidPage, server);
  const [sceneId] = await unlockViaApi(page, 3);
  const start = await api(page, 'POST', '/api/practices/start', { kind: 'scene', sceneId, composerVersion: COMPOSER_VERSION }); // as the app's start does
  expect(start.status).toBe(200);
  const plan = start.json.plan;
  await page.evaluate((p) => history.pushState({ plan: p }, '', `/practice/${p.id}`), plan);
  const puzzle = (await currentPuzzle(page, 30_000))!;
  expect(puzzle).not.toBeNull();

  // The first practice: the tip under the flag, in the flow (it covers nothing).
  const flag = page.locator('[data-practice] header [data-report-open]');
  await expect(flag).toBeVisible();
  const tip = page.locator('[data-report-tip="header"] button');
  await expect(tip).toBeVisible();
  await expect(tip).toContainText(translate('fr', 'common.report.tip'));
  const fb = (await flag.boundingBox())!;
  const tb = (await tip.boundingBox())!;
  expect(tb.y, 'the tip is under the flag').toBeGreaterThan(fb.y + fb.height);
  expect(tb.x + tb.width, 'the tip ends at the flag').toBeGreaterThanOrEqual(fb.x + fb.width / 2);
  await shoot(page, 'practice-tip', info.project.name);
  await tip.tap();
  await expect(tip).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('frenchirix.onb.tip.report'))).toBe('1');

  // The form, from the flag.
  await flag.tap();
  const form = page.locator('[data-report-form]');
  await expect(form).toBeVisible();
  await expect(form).toContainText(translate('fr', 'common.report.label'));
  await form.locator('textarea').fill('Le bouton ne marche pas, je suis bloqué');
  await shoot(page, 'report-form', info.project.name);
  await form.locator('[data-report-send]').tap();
  await expect(page.locator('[data-toast="report-thanks"]')).toBeVisible();
  await expect(form).toHaveCount(0);
  expect((await puzzleInfo(page))?.puzzleId, 'back where the kid was').toBe(puzzle.puzzleId);

  // The Worker has the report, with what the app knew when the flag was pressed.
  const reports = query<{ id: number; user_id: string; route: string; text: string; context: string; user_agent: string; build: string }>(server, 'SELECT * FROM reports');
  expect(reports).toHaveLength(1);
  const r = reports[0]!;
  expect(r.text).toBe('Le bouton ne marche pas, je suis bloqué');
  expect(r.route).toBe(`/practice/${plan.id}`);
  expect(r.user_agent).toMatch(/Chrome/);
  const ctx = JSON.parse(r.context);
  expect(ctx).toMatchObject({ practiceId: plan.id, puzzle: { index: 0, type: puzzle.type, id: puzzle.puzzleId }, layout: info.project.name === 'phone' ? 'phone' : 'tablet', online: true, muted: false, content: expect.any(String) });
  expect(typeof ctx.puzzleState).toBe('string');
  expect(ctx.pane).not.toBe('(no puzzle pane)');
  const kinds = (ctx.events as { kind: string }[]).map((e) => e.kind);
  expect(kinds).toEqual(expect.arrayContaining(['app-open', 'route', 'practice-open', 'puzzle-show']));
  const me = (await api(page, 'GET', '/api/me')).json.state.profile;
  expect(r.user_id).toBe(me.id);

  // The activity log: the client's events arrive in a batch (a beacon when the page goes away), the server's own at once.
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await expect
    .poll(() => query<{ kind: string }>(server, `SELECT DISTINCT kind FROM activity WHERE user_id = '${me.id}'`).map((x) => x.kind).sort(), { timeout: 15_000 })
    .toEqual(expect.arrayContaining(['app-open', 'practice-open', 'practice-start', 'puzzle-show', 'route']));
});

test('the first error panel shows the tip under its button; a report from there carries the error', async ({ server, newKidPage }, info) => {
  const page = await freshKid(newKidPage, server);
  await page.route(/\/api\/shop$/, (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'internal', message: 'test: the shop fell over' }) }));
  await page.evaluate(() => history.pushState(null, '', '/shop'));
  const panel = page.locator('[data-error-panel="page"]');
  await expect(panel).toBeVisible({ timeout: 15_000 });
  const button = panel.locator('[data-report-open]');
  await expect(button).toContainText(translate('fr', 'common.report.button'));
  await expect(panel.locator('[data-report-tip="panel"] button')).toBeVisible();
  await shoot(page, 'panel-tip', info.project.name);
  await button.tap();
  await page.locator('[data-report-form] textarea').fill('La boutique ne marche pas');
  await page.locator('[data-report-send]').tap();
  await expect(page.locator('[data-report-form]')).toHaveCount(0);
  const [r] = query<{ text: string; context: string }>(server, "SELECT text, context FROM reports WHERE text = 'La boutique ne marche pas'");
  expect(JSON.parse(r!.context).error).toMatch(/^FRX-ERR server 500 GET \/api\/shop code=internal msg="test: the shop fell over"/);

  // The profile has the button too.
  await page.unroute(/\/api\/shop$/);
  await page.evaluate(() => history.pushState(null, '', '/profile'));
  const inProfile = page.locator('[data-report-open]');
  await expect(inProfile).toBeVisible();
  await inProfile.scrollIntoViewIfNeeded();
  await shoot(page, 'profile', info.project.name);
});
