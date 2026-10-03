const { test, expect } = require('@playwright/test');

const common = [
  ['Edit', 'Edit Profile'],
  ['Privacy & Permissions', 'Privacy & Trust'],
  ['Payment History', 'Payment History'],
  ['Reviews', 'Reviews'],
  ['Contact Support', 'Contact Support'],
  ['Terms of Service', 'Terms of Service'],
  ['Privacy Policy', 'Privacy Policy'],
];

for (const role of ['client', 'photographer', 'model', 'admin']) {
  test(`${role} real Oracle settings entry points on phone`, async ({ page }, testInfo) => {
    test.setTimeout(180000);
    await page.setViewportSize({ width: 390, height: 844 });
    const crashes = [], failures = [];
    page.on('pageerror', error => crashes.push(error.message));
    await page.route(/https:\/\/.*(?:nip\.io|supabase\.co|nhost\.run)\//, route => {
      failures.push('Unexpected non-QA backend request');
      return route.abort();
    });
    page.on('response', response => {
      if (response.url().startsWith('http://127.0.0.1:18000') && response.status() >= 400) {
        failures.push(`${response.status()} ${new URL(response.url()).pathname}`);
      }
    });
    await page.goto('/');
    await page.getByPlaceholder('Email address').fill(`${role === 'admin' ? 'qa-admin-20261003' : `qa-${role}-40`}@example.invalid`);
    await page.getByPlaceholder('Password').fill('QA-only-not-a-real-user-2026!');
    await page.getByText('Sign In', { exact: true }).last().click();
    await page.getByRole('tab', { name: /Settings/ }).click({ timeout: 40000 });
    const provider = role === 'photographer' || role === 'model';
    const routes = [...common,
      ...(provider ? [['Identity Verification (KYC)', 'Identity Verification'], ['Payout Methods', 'Payout Methods']] : []),
      ...(role === 'photographer' ? [['Equipment & Tier', 'Equipment & Tier']] : []),
      ...(role === 'model' ? [['My Services & Rates', 'Services & Rates']] : []),
    ];
    for (const [label, heading] of routes) {
      await page.getByText(label, { exact: true }).last().click();
      await expect(page.getByText(heading, { exact: true }).last()).toBeVisible();
      if (heading === 'Services & Rates') {
        await expect(page.getByText('Adult Content', { exact: true })).toHaveCount(0);
        await expect(page.getByText('Adult Content (18+)', { exact: true })).toHaveCount(0);
        await expect(page.getByText(/Adult content/i)).toHaveCount(0);
      }
      await page.waitForTimeout(750);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2), `${label} horizontal overflow`).toBe(false);
      await page.screenshot({ path: testInfo.outputPath(`${role}-${heading.replaceAll(/[^a-zA-Z]/g, '-')}.png`), fullPage: true });
      await page.goBack();
      await expect(page.getByRole('tab', { name: /Settings/ })).toBeVisible();
    }
    expect(crashes).toEqual([]);
    expect(failures).toEqual([]);
  });
}
