const { test, expect } = require('@playwright/test');
const { randomUUID } = require('node:crypto');

test.describe.configure({ timeout: 180000 });
test.use({ actionTimeout: 15000, navigationTimeout: 30000 });
const API = 'http://127.0.0.1:18000';
const password = 'QA-only-not-a-real-user-2026!';
const actorIndex = process.env.QA_WORKFLOW_ACTOR_INDEX || '94';
const email = role => `${role === 'admin' ? 'qa-admin-20261003' : `qa-${role}-${actorIndex}`}@example.invalid`;

async function actor(request, role, address = email(role)) {
  const response = await request.post(`${API}/auth/sign-in`, { data: { email: address, password } });
  expect(response.ok(), `Synthetic ${role} fixture login`).toBe(true);
  const body = await response.json();
  return { id: body.user.id, headers: { authorization: `Bearer ${body.session.access_token}` } };
}

async function login(page, address) {
  await page.goto('/');
  await page.getByPlaceholder('Email address').fill(address);
  await page.getByPlaceholder('Password').fill(password);
  await page.getByText('Sign In', { exact: true }).last().click();
  await expect.poll(async () => await page.getByText('Age Verification', { exact: true }).isVisible()
    || await page.getByRole('tab', { name: /Settings/ }).isVisible(), { timeout: 40000 }).toBe(true);
  if (await page.getByText('Age Verification', { exact: true }).isVisible()) {
    await page.getByPlaceholder('Date of birth (YYYY-MM-DD)').fill('1995-01-01');
    const confirming = page.waitForResponse(response => response.url() === `${API}/auth/age-confirm` && response.request().method() === 'POST');
    await page.getByText('I confirm I am 18+', { exact: true }).click();
    const confirmed = await confirming;
    expect(confirmed.ok(), 'Age declaration must persist before entering the app').toBe(true);
    expect((await confirmed.json()).profile.age_verified).toBe(true);
  }
  await expect(page.getByRole('tab', { name: /Settings/ })).toBeVisible({ timeout: 40000 });
}

async function rows(request, user, table, filters = []) {
  const response = await request.post(`${API}/data/${table}`, { headers: user.headers, data: { action: 'select', select: '*', filters } });
  expect(response.ok(), `Read synthetic ${table} fixture`).toBe(true);
  return (await response.json()).data;
}

async function adminQueue(page) {
  await page.getByRole('tab', { name: /Dashboard/ }).click();
  await page.getByRole('button', { name: 'Moderation queue', exact: true }).click();
  await expect(page.getByText('Moderation Triage', { exact: true })).toBeVisible();
}

async function decide(page, request, admin, table, id, decision) {
  const label = { posts: 'post', stories: 'story', post_comments: 'comment', reviews: 'review' }[table];
  await page.getByRole('button', { name: `Review ${label} ${id}`, exact: true }).click();
  await page.getByLabel('Decision reason', { exact: true }).fill(`Synthetic QA ${decision} evidence`);
  const pending = page.waitForResponse(response => response.url() === `${API}/admin/moderation/content/review` && response.request().postDataJSON()?.id === id);
  await page.getByRole('button', { name: decision === 'approved' ? 'Approve content' : 'Reject content', exact: true }).click();
  const response = await pending;
  expect(response.ok()).toBe(true);
  expect((await response.json()).audit_event_id).toBeTruthy();
  await expect(page.getByRole('button', { name: `Review ${label} ${id}`, exact: true })).toHaveCount(0);
  const stored = await rows(request, admin, table, [{ op: 'eq', column: 'id', value: id }]);
  expect(stored[0].moderation_status).toBe(decision);
}

test.beforeEach(async ({ page, request }) => {
  test.skip(process.env.PAPZII_WORKFLOW_QA !== '1', 'Requires explicit synthetic-QA write opt-in and the parent QA tunnel');
  const health = await request.get(`${API}/health`);
  expect(health.ok(), 'QA tunnel must be available before any writes').toBe(true);
  expect((await health.json()).environment, 'Refuse production mutations').toBe('qa');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.context().setGeolocation({ latitude: -29.85, longitude: 31.03 });
  await page.context().grantPermissions(['geolocation']);
  page.on('dialog', dialog => dialog.accept());
  await page.route(/https:\/\/.*(?:payfast\.co\.za|nip\.io|supabase\.co|nhost\.run)\//, route => route.abort());
});

test('model service rate save and availability toggle persist through real commands', async ({ page, request }, testInfo) => {
  const model = await actor(request, 'model');
  const original = await rows(request, model, 'model_services', [{ op: 'eq', column: 'model_id', value: model.id }]);
  const prior = await request.get(`${API}/providers/me/availability`, { headers: model.headers });
  expect(prior.ok()).toBe(true);
  const priorOnline = (await prior.json()).is_online;
  try {
    await login(page, email('model'));
    await page.getByRole('tab', { name: /Settings/ }).click();
    await page.getByText('My Services & Rates', { exact: true }).click();
    const service = page.getByText('Brand Ambassador', { exact: true }).locator('xpath=ancestor::div[.//*[@role="switch"]][1]').locator('..');
    const toggle = service.getByRole('switch');
    if (!await toggle.isChecked()) await toggle.click();
    await service.getByRole('textbox').fill('2675.50');
    const saving = page.waitForResponse(response => response.url() === `${API}/providers/me/model-services` && response.request().method() === 'POST');
    await page.getByText('Save Services', { exact: true }).click();
    expect((await saving).ok()).toBe(true);
    const saved = await rows(request, model, 'model_services', [{ op: 'eq', column: 'model_id', value: model.id }, { op: 'eq', column: 'service_type', value: 'brand_ambassador' }]);
    expect(Number(saved[0].rate_zar)).toBe(2675.5);
    expect(saved[0].is_active).toBe(true);
    await page.goto('/Root/Home');
    const availability = page.getByLabel('Provider online availability', { exact: true });
    await expect(availability).toBeEnabled({ timeout: 30000 });
    const updating = page.waitForResponse(response => response.url() === `${API}/providers/me/availability` && response.request().method() === 'POST');
    await availability.click();
    expect((await updating).ok()).toBe(true);
    const confirmed = await request.get(`${API}/providers/me/availability`, { headers: model.headers });
    expect((await confirmed.json()).is_online).toBe(!priorOnline);
    await page.reload();
    await expect(page.getByLabel('Provider online availability')).toBeChecked({ checked: !priorOnline, timeout: 30000 });
    await page.screenshot({ path: testInfo.outputPath('model-services-availability.png'), fullPage: true });
  } finally {
    const restoreServices = await request.post(`${API}/providers/me/model-services`, { headers: model.headers, data: { services: original.filter(service => service.is_active).map(service => ({ service_type: service.service_type, rate_zar: Number(service.rate_zar) })) } });
    expect(restoreServices.ok()).toBe(true);
    const restoreOnline = await request.post(`${API}/providers/me/availability`, { headers: model.headers, data: { is_online: priorOnline } });
    expect(restoreOnline.ok()).toBe(true);
  }
});

test('client submits a server-priced scheduled booking and provider accepts without payment or tracking', async ({ page, request, browser }, testInfo) => {
  const client = await actor(request, 'client');
  const provider = await actor(request, 'photographer');
  const prior = await request.get(`${API}/providers/me/availability`, { headers: provider.headers });
  expect(prior.ok()).toBe(true);
  const priorOnline = (await prior.json()).is_online;
  let booking;
  const providerContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const online = await request.post(`${API}/providers/me/availability`, { headers: provider.headers, data: { is_online: true } });
    expect(online.ok()).toBe(true);
    await login(page, email('client'));
    // Existing deep link opens the actual BookingForm, not a synthetic test component.
    await page.goto(`/booking/new/${provider.id}`);
    await expect(page.getByText('Service type', { exact: true })).toBeVisible({ timeout: 30000 });
    await page.getByText('Photoshoot', { exact: true }).click();
    const day = new Date();
    day.setUTCDate(day.getUTCDate() + 10);
    if (day.getUTCMonth() !== new Date().getUTCMonth()) await page.getByText('›', { exact: true }).click();
    const dayLabel = await page.evaluate(iso => new Date(iso).toDateString(), new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate())).toISOString());
    await page.getByLabel(`Select ${dayLabel}`, { exact: true }).click();
    await page.getByText('Pick on map', { exact: true }).click();
    await page.getByText('Use current location', { exact: true }).click();
    await page.getByText('Use this location', { exact: true }).click();
    await page.getByPlaceholder('Shot list, vibe, must-have moments').fill(`Synthetic workflow ${randomUUID()}`);
    await expect(page.getByText('Estimated Cost', { exact: true })).toBeVisible({ timeout: 30000 });
    const creating = page.waitForResponse(response => response.url() === `${API}/bookings` && response.request().method() === 'POST');
    await page.getByText('Confirm Booking', { exact: true }).click();
    const created = await creating;
    expect(created.ok()).toBe(true);
    booking = await created.json();
    expect(Number(booking.total_amount)).toBe(Number(created.request().postDataJSON().expected_total_amount));
    expect(booking.status).toBe('pending');
    expect(booking.payment_status).not.toBe('paid');
    const providerPage = await providerContext.newPage();
    providerPage.on('dialog', dialog => dialog.accept());
    await login(providerPage, email('photographer'));
    await providerPage.getByRole('tab', { name: /Dashboard/ }).click();
    const accepting = providerPage.waitForResponse(response => response.url() === `${API}/bookings/${booking.id}` && response.request().method() === 'PATCH');
    const dateLabel = await providerPage.evaluate(start => `${new Intl.DateTimeFormat('en-ZA', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Johannesburg' }).format(new Date(start))} SAST`, booking.start_datetime);
    const card = providerPage.getByText(dateLabel, { exact: true }).filter({ visible: true }).locator('xpath=ancestor::div[.//*[text()="Accept"]][1]');
    await card.getByText('Accept', { exact: true }).click();
    expect((await accepting).ok()).toBe(true);
    const stored = await rows(request, client, 'bookings', [{ op: 'eq', column: 'id', value: booking.id }]);
    expect(stored[0].status).toBe('accepted');
    expect(stored[0].payment_status).not.toBe('paid');
    await expect(providerPage.getByText('Awaiting Payment', { exact: true }).first()).toBeVisible();
    await expect(providerPage.getByText('Route to client', { exact: false })).toHaveCount(0);
    await providerPage.screenshot({ path: testInfo.outputPath('accepted-awaiting-payment.png'), fullPage: true });
    await providerPage.goto(`/booking/${booking.id}`);
    await expect(providerPage.getByRole('button', { name: 'Open chat', exact: true })).toBeVisible({ timeout: 30000 });
    const shootLabel = dateLabel;
    await expect(providerPage.getByText(shootLabel, { exact: true })).toBeVisible();
    await expect(providerPage.getByRole('button', { name: 'Track on map', exact: true })).toBeDisabled();
    await providerPage.getByRole('button', { name: 'Open chat', exact: true }).click();
    await expect(providerPage).toHaveURL(/\/chat\/[^/?]+/);
    const conversationId = new URL(providerPage.url()).pathname.split('/chat/')[1];
    const members = await rows(request, provider, 'conversation_participants', [{ op: 'eq', column: 'conversation_id', value: conversationId }]);
    expect(members.map(member => member.user_id).sort()).toEqual([client.id, provider.id].sort());
    await providerPage.goto(`/booking/${booking.id}`);
    await expect(providerPage.getByRole('button', { name: 'Booking support', exact: true })).toBeVisible({ timeout: 30000 });
    for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
      await providerPage.setViewportSize(viewport);
      await expect(providerPage.getByText(`Booking reference: ${booking.id}`, { exact: true })).toBeVisible();
      await providerPage.screenshot({ path: testInfo.outputPath(`booking-detail-${viewport.width}.png`), fullPage: true });
      expect(await providerPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
    await providerPage.setViewportSize({ width: 390, height: 844 });
    await providerPage.getByRole('button', { name: 'Booking support', exact: true }).click();
    await providerPage.getByLabel('Support description', { exact: true }).fill('Synthetic QA booking payment investigation');
    const [submittedTicket] = await Promise.all([
      providerPage.waitForResponse(response => response.url() === `${API}/data/support_tickets` && response.request().postDataJSON()?.action === 'insert'),
      providerPage.getByRole('button', { name: 'Submit ticket', exact: true }).click(),
    ]);
    expect(submittedTicket.ok()).toBe(true);
    await expect(providerPage.getByText(/Ticket submitted\. Reference:/)).toBeVisible();
    const tickets = await rows(request, provider, 'support_tickets');
    expect(tickets.some(ticket => ticket.category === 'billing' && ticket.description.includes(`Booking reference: ${booking.id}`))).toBe(true);
    await providerPage.goto(`/booking/${booking.id}`);
    const [cancelledByProvider] = await Promise.all([
      providerPage.waitForResponse(response => response.url() === `${API}/bookings/${booking.id}` && response.request().method() === 'PATCH'),
      providerPage.getByRole('button', { name: 'Cancel booking', exact: true }).click(),
    ]);
    expect(cancelledByProvider.ok()).toBe(true);
    expect((await cancelledByProvider.json()).status).toBe('cancelled');
    await expect(providerPage.getByText('Your booking has been cancelled.', { exact: true })).toBeVisible();
  } finally {
    await providerContext.close();
    if (booking) {
      const cancelled = await request.patch(`${API}/bookings/${booking.id}`, { headers: client.headers, data: { status: 'cancelled' } });
      expect(cancelled.ok()).toBe(true);
    }
    const restored = await request.post(`${API}/providers/me/availability`, { headers: provider.headers, data: { is_online: priorOnline } });
    expect(restored.ok()).toBe(true);
  }
});

test('synthetic provider uploads KYC and submits; admin document and identity decisions persist', async ({ page, request, browser }, testInfo) => {
  const readiness = await request.get(`${API}/health/readiness`);
  expect(readiness.ok()).toBe(true);
  test.skip(!(await readiness.json()).capabilities.object_storage_configured, 'KYC upload requires configured QA object storage');
  const address = `qa-workflow-kyc-${randomUUID()}@example.invalid`;
  const registered = await request.post(`${API}/auth/sign-up`, { data: { email: address, password, options: { displayName: 'Synthetic workflow KYC', metadata: { role: 'model', date_of_birth: '1995-01-01', city: 'Durban' } } } });
  expect(registered.ok()).toBe(true);
  const provider = await actor(request, 'model', address);
  await login(page, address);
  await page.getByRole('tab', { name: /Settings/ }).click();
  await page.getByText('Identity Verification (KYC)', { exact: true }).click();
  const image = Buffer.from(await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 300; canvas.height = 160;
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff'; context.fillRect(0, 0, 300, 160);
    context.fillStyle = '#111'; context.font = '20px sans-serif'; context.fillText('SYNTHETIC QA ONLY', 20, 80);
    return canvas.toDataURL('image/png').split(',')[1];
  }), 'base64');
  for (const docType of ['id_book', 'selfie']) {
    const choosing = page.waitForEvent('filechooser');
    const uploading = page.waitForResponse(response => response.url() === `${API}/kyc/documents` && response.request().postDataJSON()?.doc_type === docType);
    await page.getByRole('button', { name: `Upload ${docType === 'id_book' ? 'SA ID / Passport' : 'Selfie with ID'}`, exact: true }).click();
    await (await choosing).setFiles({ name: `qa-${docType}.png`, mimeType: 'image/png', buffer: image });
    const uploaded = await uploading;
    expect(uploaded.ok()).toBe(true);
  }
  const submitting = page.waitForResponse(response => response.url() === `${API}/kyc/submit`);
  await expect(page.getByRole('button', { name: 'Submit for Review', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Submit for Review', exact: true }).click();
  expect((await submitting).ok()).toBe(true);
  const admin = await actor(request, 'admin');
  const documents = await rows(request, admin, 'kyc_documents', [{ op: 'eq', column: 'user_id', value: provider.id }]);
  expect(documents.filter(doc => doc.status === 'submitted')).toHaveLength(2);
  const adminContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  try {
    const adminPage = await adminContext.newPage();
    adminPage.on('dialog', dialog => dialog.accept());
    await login(adminPage, email('admin'));
    await adminQueue(adminPage);
    await adminPage.getByText('QUEUE', { exact: true }).click();
    for (const document of documents) {
      const reviewed = adminPage.waitForResponse(response => response.url() === `${API}/functions/admin-review` && response.request().postDataJSON()?.document_id === document.id);
      await adminPage.getByRole('button', { name: `Approve KYC document ${document.id}`, exact: true }).click();
      expect((await reviewed).ok()).toBe(true);
    }
    const identity = adminPage.waitForResponse(response => response.url() === `${API}/functions/admin-review` && response.request().postDataJSON()?.user_id === provider.id);
    await adminPage.getByRole('button', { name: `Approve identity ${provider.id}`, exact: true }).click();
    expect((await identity).ok()).toBe(true);
    const profile = await rows(request, admin, 'profiles', [{ op: 'eq', column: 'id', value: provider.id }]);
    expect(profile[0].kyc_status).toBe('approved');
    expect(profile[0].verified).toBe(true);
    await adminPage.screenshot({ path: testInfo.outputPath('synthetic-kyc-admin-review.png'), fullPage: true });
  } finally {
    await adminContext.close();
  }
});

test('admin approves pending post and comment then rejects parent; outsiders cannot see rejected content', async ({ page, request }, testInfo) => {
  const creator = await actor(request, 'photographer');
  const outsider = await actor(request, 'client');
  const admin = await actor(request, 'admin');
  const id = `qa-workflow-post-${randomUUID()}`;
  const inserted = await request.post(`${API}/data/posts`, { headers: creator.headers, data: { action: 'insert', select: '*', filters: [], payload: { id, caption: `Synthetic moderation ${id}`, is_locked: false, media_type: 'image' } } });
  expect(inserted.ok()).toBe(true);
  expect(await rows(request, outsider, 'posts', [{ op: 'eq', column: 'id', value: id }])).toHaveLength(0);
  await login(page, email('admin'));
  await adminQueue(page);
  await decide(page, request, admin, 'posts', id, 'approved');
  const commented = await request.post(`${API}/social/comments`, { headers: outsider.headers, data: { post_id: id, text: `Synthetic comment ${id}`, idempotency_key: randomUUID() } });
  expect(commented.ok()).toBe(true);
  const comment = (await commented.json()).comment;
  await page.getByRole('button', { name: 'Refresh moderation queue', exact: true }).click();
  await decide(page, request, admin, 'post_comments', comment.id, 'approved');
  expect(await rows(request, outsider, 'posts', [{ op: 'eq', column: 'id', value: id }])).toHaveLength(1);
  const rejecting = await request.post(`${API}/admin/moderation/content/review`, { headers: admin.headers, data: { table: 'posts', id, expected_status: 'approved', decision: 'rejected', reason: 'Synthetic QA parent rejection' } });
  expect(rejecting.ok()).toBe(true);
  expect((await rejecting.json()).rejected_comments).toBe(1);
  expect(await rows(request, outsider, 'posts', [{ op: 'eq', column: 'id', value: id }])).toHaveLength(0);
  expect(await rows(request, creator, 'post_comments', [{ op: 'eq', column: 'id', value: comment.id }])).toHaveLength(0);
  const denied = await request.post(`${API}/admin/moderation/content/review`, { headers: outsider.headers, data: { table: 'posts', id, decision: 'approved', reason: 'Spoofed administrator' } });
  expect(denied.status()).toBe(403);
  await page.screenshot({ path: testInfo.outputPath('admin-content-actions.png'), fullPage: true });
});
