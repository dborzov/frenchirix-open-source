import { expect, test } from '@playwright/test';

test('boots to Home inside the shell', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-placeholder="screens/Home.tsx"], main h1').first()).toBeVisible();
  await expect(page.getByRole('navigation').first()).toBeVisible();
});
