const { test, expect } = require('@playwright/test');

test.describe('PAPZI Web Smoke', () => {
  test('auth screen loads and signup toggle works without runtime crashes', async ({ page }) => {
    const runtimeErrors = [];
    const consoleErrors = [];
    const failedRequests = [];

    page.on('pageerror', (err) => runtimeErrors.push(err?.message || String(err)));
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });
    page.on('requestfailed', (req) => {
      failedRequests.push(`${req.method()} ${req.url()} :: ${req.failure()?.errorText || 'request failed'}`);
    });

    test.setTimeout(90_000);

    await page.goto('/', { waitUntil: 'load' });
    await page.waitForTimeout(10_000);

    const authHeadline = page.getByText('Welcome to Papzi');
    const emailInput = page.getByPlaceholder('Email address');
    const passwordInput = page.getByPlaceholder('Password');

    if (!(await emailInput.isVisible().catch(() => false))) {
      const debug = {
        url: page.url(),
        title: await page.title(),
        runtimeErrors,
        consoleErrors,
        failedRequests: failedRequests.slice(0, 20),
      };
      // eslint-disable-next-line no-console
      console.log('PAPZI_WEB_DEBUG', JSON.stringify(debug, null, 2));
    }

    await expect(authHeadline).toBeVisible({ timeout: 20_000 });
    await expect(emailInput).toBeVisible({ timeout: 20_000 });
    await expect(passwordInput).toBeVisible({ timeout: 20_000 });

    await page.getByText('Create Account').click();
    await expect(page.getByPlaceholder('Full name')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByPlaceholder('Date of birth (YYYY-MM-DD)')).toBeVisible({ timeout: 10_000 });

    // We allow no unhandled runtime exceptions during initial auth flows.
    expect(runtimeErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
});
