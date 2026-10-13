const { test, expect } = require('@playwright/test');

const slugs = ['privacy', 'terms', 'creator-policy', 'model-release', 'community', 'cookie-policy'];
for (const width of [320, 768, 1440]) {
  for (const slug of slugs) {
    test(`${slug} public policy fits ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      const failures = [];
      page.on('pageerror', error => failures.push(error.message));
      const response = await page.goto(`https://papzii.co.za/${slug}/`);
      expect(response.status()).toBe(200);
      expect(response.headers()['content-type']).toContain('text/html');
      await expect(page.locator('main h1')).toBeVisible();
      await expect(page.locator('footer')).toContainText('PAPZ (Pty) Ltd');
      await expect(page.locator('footer')).toContainText('2025/188861/07');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await expect(page.getByRole('link', { name: 'Support', exact: true })).toHaveAttribute('href', 'mailto:support@papzii.co.za');
      expect(await page.locator('main').innerText()).not.toMatch(/R250 admin fee|full refund less 10% admin fee|inforeg@justice\.gov\.za/);
      expect(failures).toEqual([]);
      await page.screenshot({ path: testInfo.outputPath(`${slug}-${width}.png`), fullPage: true });
    });
  }
}

test('HTTP policy requests redirect to HTTPS', async ({ request }) => {
  const response = await request.get('http://papzii.co.za/privacy/', { maxRedirects: 0 });
  expect([301, 302, 307, 308]).toContain(response.status());
  expect(response.headers().location).toBe('https://papzii.co.za/privacy/');
});
