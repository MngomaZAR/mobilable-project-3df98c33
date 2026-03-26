/** @type {import('@playwright/test').PlaywrightTestConfig} */
module.exports = {
  testDir: './e2e-web',
  timeout: 45_000,
  fullyParallel: false,
  workers: 1,
  use: {
    browserName: 'chromium',
    headless: true,
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 1440, height: 900 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node scripts/serve-dist.cjs',
    url: 'http://127.0.0.1:4173',
    timeout: 60_000,
    reuseExistingServer: true,
  },
  reporter: [['list']],
};

