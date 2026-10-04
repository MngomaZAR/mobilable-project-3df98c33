// Browser interaction/layout acceptance with synthetic transport, not live-user or payment evidence.
const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const API = 'http://127.0.0.1:18000';
const owner = { id: 'synthetic-client', email: 'client@example.invalid', is_admin: false, user_metadata: { role: 'client' } };
const clientProfile = { id: owner.id, email: owner.email, role: 'client', full_name: 'Synthetic client', age_verified: true, verified: true };
const creator = { id: 'synthetic-creator', role: 'photographer', full_name: 'Lebo Mokoena', bio: 'Portraits and live events in Durban.', city: 'Durban', verified: true, age_verified: true, kyc_status: 'approved', avatar_url: `${API}/synthetic-image` };

async function fixture(page, { failedProfile = false, admin = false, theme = 'light' } = {}) {
  const writes = [];
  let fail = failedProfile;
  const user = { ...owner, is_admin: admin };
  const session = { user, access_token: 'synthetic-not-a-real-token', refresh_token: 'synthetic-refresh', expires_at: Math.floor(Date.now() / 1000) + 3600 };
  await page.addInitScript(value => localStorage.setItem('papziApiSession', JSON.stringify(value)), session);
  await page.addInitScript(value => localStorage.setItem('papzi-theme-mode', value), theme);
  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === 'http://127.0.0.1:4173' || ['data:', 'blob:'].includes(url.protocol)) return route.continue();
    if (url.origin !== API) return route.abort();
    const respond = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }, body: JSON.stringify(body) });
    if (request.method() === 'OPTIONS') return respond({});
    if (url.pathname === '/synthetic-image') return route.fulfill({ contentType: 'image/jpeg', body: fs.readFileSync(path.join(__dirname, '../assets/papzi-logo.jpg')), headers: { 'access-control-allow-origin': '*' } });
    if (url.pathname === '/auth/me') return respond({ user });
    if (url.pathname === `/reviews/summary/${creator.id}`) return respond({ count: 60, average: 4.5 });
    if (url.pathname === '/moderation/reports') {
      writes.push({ path: url.pathname, body: request.postDataJSON() });
      return respond({ id: 'synthetic-report' });
    }
    if (url.pathname === '/admin/moderation/content') return respond({ counts: { posts: 0, stories: 0, post_comments: 0, reviews: 0 }, items: [] });
    if (url.pathname.startsWith('/data/')) {
      const table = url.pathname.split('/').pop();
      const command = request.postDataJSON();
      const id = command.filters?.find(item => item.column === 'id')?.value;
      if (command.action !== 'select') {
        writes.push({ path: url.pathname, body: command });
        return respond({ data: null, error: null });
      }
      if (table === 'profiles' && id === creator.id && fail) {
        fail = false;
        return respond({ detail: 'Connection interrupted' }, 503);
      }
      let rows = [];
      if (table === 'profiles') rows = [id === creator.id ? creator : clientProfile];
      if (table === 'photographers' && id === creator.id) rows = [{ id: creator.id, hourly_rate: 1200, tags: ['Portraits', 'Events'], latitude: -29.85, longitude: 31.03 }];
      if (table === 'posts') rows = [{ id: 'synthetic-post', author_id: creator.id, image_url: `${API}/synthetic-image`, caption: 'Synthetic media fixture', created_at: '2026-10-04T00:00:00Z' }];
      return respond({ data: command.single || command.maybeSingle ? rows[0] || null : rows, error: null, count: rows.length });
    }
    return respond({ data: [], messages: [], items: [] });
  });
  return writes;
}

for (const viewport of [{ width: 320, height: 740, theme: 'light' }, { width: 390, height: 844, theme: 'light' }, { width: 1440, height: 900, theme: 'light' }, { width: 390, height: 844, theme: 'dark' }]) {
  test(`truthful cold profile renders and fits ${viewport.width}px ${viewport.theme}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await fixture(page, { theme: viewport.theme });
    await page.goto(`/user/${creator.id}`);
    await expect(page.getByText('4.5 / 5 (60 reviews)', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Request shoot', exact: true })).toBeEnabled();
    await expect(page.getByText('Durban', { exact: true })).toBeVisible();
    await expect(page.getByText(/128 reviews|Collaboration request sent|5.0 Rating/)).toHaveCount(0);
    const bounds = await page.getByRole('button', { name: 'Request shoot', exact: true }).boundingBox();
    expect(bounds.width).toBeGreaterThan(44);
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`profile-${viewport.width}-${viewport.theme}.png`), fullPage: true });
  });
}

test('browser profile recovery, follow and report use acknowledged payloads', async ({ page }) => {
  const writes = await fixture(page, { failedProfile: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/user/${creator.id}`);
  await expect(page.getByText('Connection interrupted', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Retry profile', exact: true }).click();
  await expect(page.getByText('4.5 / 5 (60 reviews)', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Follow', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Following', exact: true })).toBeVisible();
  expect(writes.find(item => item.path === '/data/follows').body.payload).toEqual({ follower_id: owner.id, following_id: creator.id });
  await page.getByRole('button', { name: 'Report profile', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Submit report', exact: true })).toBeDisabled();
  await page.getByLabel('Report reason', { exact: true }).fill('Synthetic impersonation check');
  await page.getByRole('button', { name: 'Submit report', exact: true }).click();
  await expect(page.getByText('Report submitted for review.', { exact: true })).toBeVisible();
  expect(writes.find(item => item.path === '/moderation/reports').body).toEqual({ target_type: 'profile', target_id: creator.id, reason: 'Synthetic impersonation check', details: '' });
});

test('server capability enables admin dashboard without changing client business role', async ({ page }) => {
  await fixture(page, { admin: true });
  await page.goto('/');
  await expect(page.getByRole('tab', { name: /Dashboard/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Moderation queue', exact: true })).toBeVisible();
});
