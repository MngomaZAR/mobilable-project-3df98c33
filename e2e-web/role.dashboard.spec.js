const { test, expect } = require('@playwright/test');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const fs = require('fs');

function loadLocalEnv() {
  const files = ['.env.local', '.env'];
  for (const name of files) {
    const abs = path.join(process.cwd(), name);
    if (!fs.existsSync(abs)) continue;
    const raw = fs.readFileSync(abs, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx <= 0) continue;
      const key = trimmed.slice(0, idx).replace(/^\uFEFF/, '').trim();
      let value = trimmed.slice(idx + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  }
}

loadLocalEnv();

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const roleSpecs = [
  { role: 'client', marker: 'Native map preview' },
  { role: 'photographer', marker: 'Photographer Mode' },
  { role: 'model', marker: 'Elite Creator Dashboard' },
  { role: 'admin', marker: 'Admin Overview' },
];

const makePassword = (seed) => `Papzi!${(seed % 900000) + 100000}Ab`;
const SUPABASE_ORIGIN = SUPABASE_URL ? new URL(SUPABASE_URL).origin : '';
const FALLBACK_ORIGIN = 'https://placeholder.supabase.co';

async function attachSupabaseProxy(page) {
  if (!SUPABASE_ORIGIN) return;
  const handleProxy = async (route, request) => {
    try {
      if (request.method() === 'OPTIONS') {
        await route.fulfill({
          status: 204,
          headers: {
            'access-control-allow-origin': '*',
            'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
            'access-control-allow-headers': '*',
          },
          body: '',
        });
        return;
      }

      const headers = { ...request.headers() };
      delete headers.host;
      delete headers['content-length'];

      if (!headers.apikey || headers.apikey === 'public-anon-key') {
        headers.apikey = SUPABASE_ANON_KEY;
      }
      if (!headers.authorization || headers.authorization === 'Bearer public-anon-key') {
        delete headers.authorization;
      }

      const incomingUrl = request.url();
      const targetUrl = incomingUrl.startsWith(FALLBACK_ORIGIN)
        ? `${SUPABASE_ORIGIN}${incomingUrl.slice(FALLBACK_ORIGIN.length)}`
        : incomingUrl;

      const upstream = await fetch(targetUrl, {
        method: request.method(),
        headers,
        body: request.postDataBuffer() || undefined,
      });

      const body = Buffer.from(await upstream.arrayBuffer());
      const upstreamHeaders = Object.fromEntries(upstream.headers.entries());
      upstreamHeaders['access-control-allow-origin'] = '*';

      await route.fulfill({
        status: upstream.status,
        headers: upstreamHeaders,
        body,
      });
    } catch (error) {
      await route.abort();
    }
  };

  await page.route(`${SUPABASE_ORIGIN}/**`, handleProxy);
  await page.route(`${FALLBACK_ORIGIN}/**`, handleProxy);
}

async function seedRoleUsers() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Missing Supabase env for role dashboard E2E.');
  }
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const stamp = Date.now();
  const seeded = [];

  for (let i = 0; i < roleSpecs.length; i += 1) {
    const role = roleSpecs[i].role;
    const email = `webrole.${role}.${stamp}@papzi.test`;
    const password = makePassword(stamp + i);
    const create = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { role, full_name: `Web Role ${role}` },
    });
    if (create.error) throw new Error(`createUser(${role}) failed: ${create.error.message}`);
    const id = create.data.user.id;

    const profile = await admin.from('profiles').upsert(
      {
        id,
        role,
        full_name: `Web Role ${role}`,
        age_verified: false,
        date_of_birth: null,
        kyc_status: role === 'photographer' || role === 'model' ? 'pending' : null,
      },
      { onConflict: 'id' },
    );
    if (profile.error) throw new Error(`profile upsert(${role}) failed: ${profile.error.message}`);

    seeded.push({ role, email, password });
  }

  return seeded;
}

test.describe('PAPZI Role Dashboards via Web', () => {
  test('all roles pass age verification and land on correct dashboard', async ({ browser }) => {
    test.setTimeout(420_000);
    const users = await seedRoleUsers();
    const screenshotDir = path.join(process.cwd(), 'test-results', 'role-dashboard-proof');
    fs.mkdirSync(screenshotDir, { recursive: true });

    for (const { role, email, password } of users) {
      const roleMeta = roleSpecs.find((r) => r.role === role);
      const runtimeErrors = [];
      const consoleErrors = [];

      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await context.newPage();
      await attachSupabaseProxy(page);
      page.on('pageerror', (err) => runtimeErrors.push(err?.message || String(err)));
      page.on('console', (msg) => {
        if (msg.type() === 'error') consoleErrors.push(msg.text());
      });

      await test.step(`${role}: sign in`, async () => {
        await page.goto('/', { waitUntil: 'load' });
        await expect(page.getByText('Welcome to Papzi')).toBeVisible({ timeout: 30_000 });
        await page.getByPlaceholder('Email address').fill(email);
        await page.getByPlaceholder('Password').fill(password);
        await page.locator('text=Sign In').last().click();
      });

      await test.step(`${role}: age verification`, async () => {
        await expect(page.getByText('Age Verification')).toBeVisible({ timeout: 30_000 });
        await page.getByText('I confirm I am 18+').click();
      });

      await test.step(`${role}: dashboard`, async () => {
        await expect(page.getByText(roleMeta.marker)).toBeVisible({ timeout: 40_000 });
        await page.screenshot({
          path: path.join(screenshotDir, `${role}-dashboard.png`),
          fullPage: true,
        });
      });

      expect(runtimeErrors).toEqual([]);
      const nonIgnorableConsoleErrors = consoleErrors.filter((msg) => {
        if (/wss:\/\/placeholder\.supabase\.co\/realtime\/v1\/websocket\?apikey=public-anon-key.*ERR_NAME_NOT_RESOLVED/i.test(msg)) {
          return false;
        }
        if (/Failed to load resource: the server responded with a status of 400 \(Bad Request\)/i.test(msg)) {
          return false;
        }
        return true;
      });
      expect(nonIgnorableConsoleErrors).toEqual([]);

      await context.close();
    }
  });
});
