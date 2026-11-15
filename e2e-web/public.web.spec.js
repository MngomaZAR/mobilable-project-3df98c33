const { test, expect } = require('@playwright/test');

for (const width of [320, 390, 768, 1440]) {
  test(`public pilot authentication fits and reloads at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const crashes = [], failedAssets = [];
    page.on('pageerror', error => crashes.push(error.message));
    page.on('response', response => {
      if (response.url().startsWith('https://papzii.co.za/') && response.status() >= 400) failedAssets.push(response.status());
    });
    await page.goto('https://papzii.co.za/Root');
    await expect(page.getByTestId('auth-email')).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId('auth-password')).toBeVisible();
    await expect(page.getByTestId('auth-submit')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.reload();
    await expect(page.getByTestId('auth-email')).toBeVisible();
    expect(crashes).toEqual([]);
    expect(failedAssets).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`public-auth-${width}.png`), fullPage: true });
  });
}

test('public web origin is allowed by the live API and static errors remain errors', async ({ request }) => {
  const response = await request.fetch('https://papzii-api.129.151.188.15.nip.io/auth/sign-in', {
    method: 'OPTIONS', headers: { Origin: 'https://papzii.co.za', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' },
  });
  expect(response.status()).toBe(200);
  expect(response.headers()['access-control-allow-origin']).toBe('https://papzii.co.za');
  const missing = await request.get('https://papzii.co.za/_expo/missing-acceptance-asset.js');
  expect(missing.status()).toBe(404);
  const worker = await request.get('https://papzii.co.za/maplibre/maplibre-gl-worker.mjs');
  expect(worker.status()).toBe(200);
  expect(worker.headers()['content-type']).toContain('javascript');
});
