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

const DEFAULT_PASSWORD = 'Papzi!12345';

const roleSpecs = [
  {
    role: 'client',
    marker: 'Native map preview',
    email: 'sam.mngoma.reference@papzi.test',
    id: '5b2f56b4-1a3b-4c9c-a9c3-7c9b8b1c2a10',
  },
  {
    role: 'photographer',
    marker: 'Photographer Mode',
    email: 'michael.scott.reference@papzi.test',
    id: '9a04e8f2-2f3e-4e61-9cb7-97c4f9c39210',
  },
  {
    role: 'model',
    marker: 'Elite Creator Dashboard',
    email: 'lerato.sithole.reference@papzi.test',
    id: '6d3c94d1-2a93-4a48-8f7c-5cb8b2467f88',
  },
  {
    role: 'admin',
    marker: 'Admin Overview',
    email: 'sipho.dlamini.reference@papzi.test',
    id: 'e02e3d63-27bc-4d5b-9b0f-bb7a04db4e33',
  },
];

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

async function findAuthUserByEmail(admin, email) {
  if (admin.auth?.admin?.getUserByEmail) {
    const { data, error } = await admin.auth.admin.getUserByEmail(email);
    if (!error && data?.user) return data.user;
  }

  let page = 1;
  const perPage = 1000;
  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) break;
    const users = data?.users ?? [];
    const match = users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
    if (match) return match;
    if (users.length < perPage) break;
    page += 1;
  }

  return null;
}

async function purgeRoleAccount(admin, spec) {
  await admin.from('profiles').delete().eq('id', spec.id);
  await admin.from('photographers').delete().eq('id', spec.id);
  await admin.from('models').delete().eq('id', spec.id);

  const existing = await findAuthUserByEmail(admin, spec.email);
  if (existing?.id) {
    const { error } = await admin.auth.admin.deleteUser(existing.id);
    if (error) {
      throw new Error(`deleteUser(${spec.email}) failed: ${error.message}`);
    }
  }
}

async function prepareRoleAccounts() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Missing Supabase env for role dashboard E2E.');
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const accountIds = new Map();

  for (const spec of roleSpecs) {
    await purgeRoleAccount(admin, spec);
  }

  for (const spec of roleSpecs) {
    let accountId = spec.id;
    const existing = await findAuthUserByEmail(admin, spec.email);

    if (existing?.id) {
      accountId = existing.id;
      const { error: updateError } = await admin.auth.admin.updateUserById(accountId, {
        password: DEFAULT_PASSWORD,
        email_confirm: true,
        user_metadata: {
          full_name: `Web ${spec.role}`,
          role: spec.role,
        },
      });
      if (updateError) {
        throw new Error(`updateUserById(${spec.email}) failed: ${updateError.message}`);
      }
    } else {
      const created = await admin.auth.admin.createUser({
        id: spec.id,
        email: spec.email,
        password: DEFAULT_PASSWORD,
        email_confirm: true,
        user_metadata: {
          full_name: `Web ${spec.role}`,
          role: spec.role,
        },
      });
      if (created.error) {
        accountId = spec.id;
        const { error: updateError } = await admin.auth.admin.updateUserById(accountId, {
          password: DEFAULT_PASSWORD,
          email_confirm: true,
          user_metadata: {
            full_name: `Web ${spec.role}`,
            role: spec.role,
          },
        });
        if (updateError && !/not found/i.test(updateError.message || '')) {
          console.warn(`updateUserById(${spec.email}) failed after duplicate create: ${updateError.message}`);
        }
      } else {
        accountId = created.data.user.id;
      }
    }
    accountIds.set(spec.role, accountId);

    const profile = await admin.from('profiles').insert(
      {
        id: accountId,
        role: spec.role,
        full_name: `Web ${spec.role}`,
        avatar_url: null,
        city: 'Durban',
        age_verified: false,
        date_of_birth: null,
        kyc_status: spec.role === 'client' ? null : 'approved',
        availability_status: spec.role === 'client' ? null : 'online',
        verified: spec.role !== 'client',
        is_test_account: true,
      },
    );
    if (profile.error) throw new Error(`profile upsert(${spec.role}) failed: ${profile.error.message}`);
  }

  const photographer = await admin.from('photographers').upsert(
    {
      id: accountIds.get('photographer') ?? roleSpecs.find((item) => item.role === 'photographer').id,
      name: 'Web photographer',
      rating: 4.9,
      location: 'Durban, South Africa',
      latitude: -29.8587,
      longitude: 31.0218,
      price_range: '$$',
      style: 'Editorial',
      bio: 'Web role dashboard photographer',
      tags: ['web', 'e2e'],
    },
    { onConflict: 'id' },
  );
  if (photographer.error) throw new Error(`photographers upsert failed: ${photographer.error.message}`);

  const model = await admin.from('models').upsert(
    {
      id: accountIds.get('model') ?? roleSpecs.find((item) => item.role === 'model').id,
      latitude: -29.8587,
      longitude: 31.0218,
      is_available: true,
      rating: 4.9,
      price_range: '$$',
      style: 'Editorial',
      bio: 'Web role dashboard model',
      tags: ['web', 'e2e'],
    },
    { onConflict: 'id' },
  );
  if (model.error) throw new Error(`models upsert failed: ${model.error.message}`);

  const adminId = accountIds.get('admin') ?? roleSpecs.find((item) => item.role === 'admin').id;
  await admin.auth.admin.updateUserById(adminId, {
    user_metadata: {
      full_name: 'Web admin',
      role: 'admin',
    },
  });

  return roleSpecs.map((spec) => ({
    role: spec.role,
    email: spec.email,
    password: DEFAULT_PASSWORD,
    marker: spec.marker,
  }));
}

test.describe('PAPZI Role Dashboards via Web', () => {
  test('all roles pass age verification and land on correct dashboard', async ({ browser }) => {
    test.setTimeout(420_000);
    const users = await prepareRoleAccounts();
    const screenshotDir = path.join(process.cwd(), 'test-results', 'role-dashboard-proof');
    fs.mkdirSync(screenshotDir, { recursive: true });

    for (const { role, email, password, marker } of users) {
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
        await expect(page.getByText(marker)).toBeVisible({ timeout: 40_000 });
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
