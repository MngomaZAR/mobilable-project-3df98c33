import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { expect } from '@playwright/test';

async function mapColorCount(page, canvas) {
  const screenshot = await canvas.screenshot();
  return page.evaluate(async base64 => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const sample = document.createElement('canvas');
    sample.width = image.width;
    sample.height = image.height;
    const context = sample.getContext('2d');
    context.drawImage(image, 0, 0);
    const { data } = context.getImageData(0, 0, sample.width, sample.height);
    const colors = new Set();
    for (let y = Math.floor(sample.height * 0.2); y < sample.height * 0.7; y += 3) {
      for (let x = Math.floor(sample.width * 0.2); x < sample.width * 0.8; x += 3) {
        const i = (y * sample.width + x) * 4;
        colors.add(`${data[i] >> 3},${data[i + 1] >> 3},${data[i + 2] >> 3}`);
      }
    }
    return colors.size;
  }, screenshot.toString('base64'));
}

// Use the existing synthetic review account; secrets arrive on stdin.
const [preview, revision, output] = process.argv.slice(2);
const url = new URL(preview);
assert.equal(url.protocol, 'https:');
assert.match(url.hostname, /^papzi(?:--[a-z0-9]+)?\.expo\.app$/);
assert.equal(url.username + url.password + url.search + url.hash, '');
assert.match(revision, /^[a-f0-9]{40}$/);
assert.ok(path.isAbsolute(output));
const destination = path.resolve(output);
const relative = path.relative(process.cwd(), destination);
assert.ok(relative.startsWith('..') || path.isAbsolute(relative), 'Keep private screenshots outside Git.');
let input = '';
for await (const chunk of process.stdin) {
  input += chunk;
  assert.ok(input.length <= 4096);
}
const credentials = JSON.parse(input);
assert.deepEqual(Object.keys(credentials).sort(), ['name', 'password']);
assert.equal(credentials.name, 'appreview.beta39@papzii.co.za');
assert.ok(typeof credentials.password === 'string' && credentials.password.length >= 24);
const api = 'https://papzii-api.129.151.188.15.nip.io';
const current = await fetch(`${api}/version`, { signal: AbortSignal.timeout(30000) });
assert.equal(current.status, 200);
assert.equal((await current.json()).version, revision);
await fs.mkdir(destination, { recursive: true });
const browser = await chromium.launch({ headless: true });
const report = { checkedAt: new Date().toISOString(), preview, revision,
  scope: 'Existing synthetic client review account: sign-in, its age declaration if needed, five read-only tabs and sign-out on two web viewports.',
  nativeAcceptance: false, financialAcceptance: false, viewports: [] };
try {
  for (const viewport of [{ name: 'phone', width: 390, height: 844 }, { name: 'desktop', width: 1440, height: 900 }]) {
    const context = await browser.newContext({ viewport, geolocation: { latitude: -29.85, longitude: 31.03 }, permissions: ['geolocation'] });
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    let token, loadedTiles = 0, renderedMapColors = 0;
    const crashes = [], failedApiRequests = [];
    page.on('pageerror', () => crashes.push('pageerror'));
    page.on('response', async response => {
      if (response.url().startsWith('https://tiles.openfreemap.org/') && /\.(?:pbf|mvt)(?:\?|$)/.test(response.url()) && response.ok()) loadedTiles++;
      if (response.url() === `${api}/auth/sign-in` && response.status() === 200) {
        token = (await response.json()).session?.access_token;
      }
      if (response.url().startsWith(api + '/') && response.status() >= 400) {
        failedApiRequests.push({ status: response.status(), endpoint: new URL(response.url()).pathname.split('/').slice(0, 3).join('/') });
      }
    });
    try {
      report.lastStep = `${viewport.name}: load`;
      await page.goto(preview, { waitUntil: 'load' });
      report.lastStep = `${viewport.name}: sign in`;
      await page.getByPlaceholder('Email address').fill(credentials.name);
      await page.getByPlaceholder('Password').fill(credentials.password);
      await page.getByText('Sign In', { exact: true }).last().click();
      report.lastStep = `${viewport.name}: authenticated tabs`;
      const ageGate = page.getByText('Age Verification', { exact: true });
      await ageGate.or(page.getByRole('tab', { name: /Feed/ })).first().waitFor();
      if (await ageGate.isVisible()) {
        report.lastStep = `${viewport.name}: synthetic reviewer age declaration`;
        await page.getByPlaceholder('Date of birth (YYYY-MM-DD)').fill('1990-01-01');
        await page.getByText('I confirm I am 18+', { exact: true }).click();
        report.reviewAccountAgeDeclarationCompleted = true;
      }
      await page.getByRole('tab', { name: /Feed/ }).waitFor();
      const tabs = [];
      for (const name of ['Home', 'Map', 'Bookings', 'Feed', 'Settings']) {
        report.lastStep = `${viewport.name}: ${name}`;
        const tab = page.getByRole('tab', { name: new RegExp(name) });
        await tab.click();
        await page.waitForTimeout(2000);
        assert.equal(await tab.getAttribute('aria-selected'), 'true');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false);
        if (name === 'Map') {
          const map = page.getByRole('region', { name: 'Talent map', exact: true });
          await expect(map).toHaveAttribute('data-map-state', 'ready', { timeout: 45000 });
          await expect.poll(() => loadedTiles, { timeout: 45000 }).toBeGreaterThan(0);
          await expect.poll(async () => {
            renderedMapColors = await mapColorCount(page, map.locator('canvas.maplibregl-canvas'));
            return renderedMapColors;
          }, { timeout: 45000 }).toBeGreaterThan(16);
        }
        await page.screenshot({ path: path.join(destination, `${viewport.name}-${name}.png`), fullPage: true });
        tabs.push(name);
      }
      report.lastStep = `${viewport.name}: sign out`;
      await page.getByText('Sign Out', { exact: true }).click();
      await page.getByText('Confirm', { exact: true }).click();
      await page.getByPlaceholder('Email address').waitFor();
      assert.equal(crashes.length, 0);
      assert.deepEqual(failedApiRequests, []);
      report.viewports.push({ viewport: viewport.name, tabs, signIn: true, signOut: true, horizontalOverflow: false, crashes: 0, failedApiRequests: 0, loadedTiles, renderedMapColors });
    } catch (error) {
      report.failedApiRequests = failedApiRequests;
      report.crashCount = crashes.length;
      report.map = { loadedTiles, renderedMapColors };
      await page.screenshot({ path: path.join(destination, `${viewport.name}-failure.png`), fullPage: true }).catch(() => {});
      throw error;
    } finally {
      if (token) await context.request.post(`${api}/auth/sign-out`, { headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
      await context.close();
    }
  }
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.errorType = error.name;
  process.exitCode = 1;
} finally {
  await browser.close();
  await fs.writeFile(path.join(destination, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
}
