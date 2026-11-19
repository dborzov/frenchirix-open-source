// The /dev portal behind the admin password, against a real local Worker (meta-server.ts: TEST_MODE,
// its own ADMIN_PASSWORD, LOCAL_DEV off, as in production). Specs that need /dev use signInAdmin().
import { ADMIN_PASSWORD, PASSWORD, expect, test } from './meta-server';

test.use({ devBuild: true });

test('/dev asks for the admin password once; the admin cookie also passes the school gate', async ({ server, browser, contextOptions, viewport }) => {
  const ctx = await browser.newContext({ ...contextOptions, viewport, locale: 'fr-CA', extraHTTPHeaders: { 'x-test-language': 'fr' } });
  const page = await ctx.newPage();

  // Without any cookie: the admin page, not the school gate, not the portal.
  await page.goto(`${server.base}/dev/panono`);
  await expect(page).toHaveTitle(/admin/i);
  const field = page.locator('form[action="/dev/login"] input[name="password"]');
  await expect(field).toBeVisible();
  await expect(page.locator('[data-coverage]')).toHaveCount(0);

  // A wrong password stays on the admin page.
  await field.fill('pas-le-bon');
  await field.press('Enter');
  await expect(page.locator('form[action="/dev/login"] input[name="password"]')).toBeVisible();
  await expect(page).toHaveTitle(/admin/i);

  // The right one, through the real form: back to the page asked for.
  await page.locator('form[action="/dev/login"] input[name="password"]').fill(ADMIN_PASSWORD);
  await page.locator('form[action="/dev/login"] input[name="password"]').press('Enter');
  await expect(page).toHaveURL(/\/dev\/panono/);
  await expect(page.locator('[data-coverage]')).toBeVisible({ timeout: 20_000 });

  // Remembered: another /dev page opens at once.
  await page.goto(`${server.base}/dev`);
  await expect(page.locator('[data-dev-link="/dev/practices"]')).toBeVisible({ timeout: 20_000 });

  // The admin cookie alone (no school-gate cookie) opens the app itself.
  expect((await ctx.cookies()).map((c) => c.name)).not.toContain('fx_gate');
  await page.goto(`${server.base}/`);
  await expect(page.locator('input[name="password"]')).toHaveCount(0);
  await expect(page.locator('[data-home-hello]')).toBeVisible({ timeout: 20_000 });
  await ctx.close();

  // The school gate alone does not open /dev.
  const kid = await browser.newContext({ ...contextOptions, viewport, locale: 'fr-CA', extraHTTPHeaders: { 'x-test-language': 'fr' } });
  expect((await kid.request.post(`${server.base}/gate`, { data: { password: PASSWORD } })).status()).toBe(204);
  const p2 = await kid.newPage();
  await p2.goto(`${server.base}/dev`);
  await expect(p2).toHaveTitle(/admin/i);
  expect((await kid.request.get(`${server.base}/dev`, { headers: { accept: 'application/json' } })).status()).toBe(401);
  await kid.close();
});
