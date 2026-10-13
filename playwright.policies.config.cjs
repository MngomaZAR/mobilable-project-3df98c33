module.exports = {
  testDir: './e2e-web',
  testMatch: ['public.policies.spec.js', 'public.web.spec.js'],
  timeout: 45000,
  workers: 1,
  use: { browserName: 'chromium', headless: true, screenshot: 'only-on-failure' },
  outputDir: 'docs/output/public-policies-20261013',
  reporter: [['list']],
};
