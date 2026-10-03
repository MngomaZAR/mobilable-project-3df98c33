const { test, expect } = require('@playwright/test');
test.describe.configure({ timeout: 120000 });

const viewports = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
];
const roles = ['client', 'photographer', 'model', 'admin'];
const disabledServices = /\/(livekit-token|dispatch-create|dispatch-state|eta|heatmap|status-leaderboard|send-app-email|escrow-release)$/;

for (const viewport of viewports) {
  for (const role of roles) {
    test(`${role} real Oracle navigation on ${viewport.name}`, async ({ page }, testInfo) => {
      test.setTimeout(120000);
      await page.setViewportSize(viewport);
      await page.context().setGeolocation({ latitude: -29.85, longitude: 31.03 });
      await page.context().grantPermissions(['geolocation']);
      const failures = [], crashes = [];
      await page.route(/https:\/\/.*(?:nip\.io|supabase\.co|nhost\.run)\//, route => {
        failures.push('Unexpected non-QA backend request');
        return route.abort();
      });
      page.on('pageerror', error => crashes.push(error.message));
      page.on('response', response => {
        if (response.url().startsWith('http://127.0.0.1:18000') && response.status() >= 400 && !disabledServices.test(new URL(response.url()).pathname)) {
          failures.push(`${response.status()} ${new URL(response.url()).pathname}`);
        }
      });
      await page.goto('/');
      await page.getByPlaceholder('Email address').fill(`${role === 'admin' ? 'qa-admin-20261003' : `qa-${role}-${30 + viewports.indexOf(viewport)}`}@example.invalid`);
      await page.getByPlaceholder('Password').fill('QA-only-not-a-real-user-2026!');
      await page.getByText('Sign In', { exact: true }).last().click();
      await expect(page.getByRole('tab', { name: /Feed/ })).toBeVisible({ timeout: 40000 });
      for (const name of [role === 'client' ? 'Home' : 'Dashboard', 'Bookings', 'Feed', ...(role === 'client' ? [] : ['Chat']), 'Settings']) {
        await page.getByRole('tab', { name: new RegExp(name) }).click();
        await page.waitForTimeout(1000);
        await expect(page.getByRole('tab', { name: new RegExp(name) })).toHaveAttribute('aria-selected', 'true');
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
        expect(overflow, `${name} has horizontal overflow`).toBe(false);
        for (const label of ['Map', role === 'client' ? 'Home' : 'Dashboard', 'Bookings', 'Feed', ...(role === 'client' ? [] : ['Chat']), 'Settings']) {
          const tab = page.getByRole('tab', { name: new RegExp(label) });
          const tabBox = await tab.boundingBox();
          const labelBox = await tab.getByText(label, { exact: true }).boundingBox();
          expect(labelBox && tabBox && labelBox.y + labelBox.height <= tabBox.y + tabBox.height + 1, `Clipped ${label} navigation label`).toBeTruthy();
        }
        if (role === 'model' && name === 'Dashboard') {
          await expect(page.getByText('Recorded Earnings', { exact: true })).toBeVisible();
          await expect(page.getByText('Top Fans (This Month)', { exact: true })).toHaveCount(0);
          await expect(page.getByText('Subscribers', { exact: true })).toHaveCount(0);
        }
        await page.screenshot({ path: testInfo.outputPath(`${role}-${viewport.name}-${name}.png`), fullPage: true });
      }
      expect(crashes).toEqual([]);
      expect(failures).toEqual([]);
    });
  }
}

test('new client can register and leave the age gate against Oracle', async ({ page }) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByText('Create Account', { exact: true }).click();
  await page.getByPlaceholder('Full name').fill('QA browser registration');
  await page.getByPlaceholder('Email address').fill(`qa-browser-${Date.now()}@example.invalid`);
  await page.getByPlaceholder('Password').fill('QA-only-not-a-real-user-2026!');
  await page.getByPlaceholder('Date of birth (YYYY-MM-DD)').fill('1995-01-01');
  await page.getByPlaceholder('City (e.g. Johannesburg)').fill('Durban');
  await page.getByText('Female', { exact: true }).click();
  await page.getByText('I confirm I am 18 or older.', { exact: true }).click();
  await page.getByText('I accept the Terms and Privacy Policy.', { exact: true }).click();
  await page.getByText('Create Client Account', { exact: true }).click();
  await expect(page.getByText('Age Verification', { exact: true })).toBeVisible({ timeout: 30000 });
  await page.getByPlaceholder('Date of birth (YYYY-MM-DD)').fill('1995-01-01');
  await page.getByText('I confirm I am 18+', { exact: true }).click();
  await expect(page.getByRole('tab', { name: /Feed/ })).toBeVisible({ timeout: 30000 });
});
