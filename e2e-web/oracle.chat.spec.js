const { test, expect } = require('@playwright/test');

test.describe.configure({ timeout: 120000 });
const API = 'http://127.0.0.1:18000';
const password = 'QA-only-not-a-real-user-2026!';

async function expectWrappedMessage(message) {
  await expect.poll(() => message.evaluate(element => {
    const bubble = element.parentElement;
    const bounds = bubble.getBoundingClientRect();
    const style = getComputedStyle(bubble);
    const textBounds = element.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(element);
    const lines = [...range.getClientRects()].filter(rect => rect.width > 0);
    const left = bounds.left + parseFloat(style.paddingLeft) + parseFloat(style.borderLeftWidth);
    const right = bounds.right - parseFloat(style.paddingRight) - parseFloat(style.borderRightWidth);
    return {
      wrapped: lines.length > 1 && textBounds.height >= parseFloat(getComputedStyle(element).lineHeight) * 2 - 1,
      withinBubble: element.scrollWidth <= element.clientWidth + 1
        && lines.every(rect => rect.left >= left - 1 && rect.right <= right + 1
          && rect.top >= bounds.top - 1 && rect.bottom <= bounds.bottom + 1),
      withinViewport: bounds.left >= -1 && bounds.right <= innerWidth + 1,
    };
  }), { message: 'Long message text must wrap inside its bubble without clipping' }).toEqual({
    wrapped: true, withinBubble: true, withinViewport: true,
  });
}

for (const [width, actorIndex] of [[390, 80], [1440, 81]]) {
  test(`Oracle inbox and send persist on ${width}px`, async ({ page, request }, testInfo) => {
    const login = await request.post(`${API}/auth/sign-in`, { data: { email: `qa-client-${actorIndex}@example.invalid`, password } });
    expect(login.ok()).toBe(true);
    const authorization = `Bearer ${(await login.json()).session.access_token}`;
    const options = { headers: { authorization } };
    const start = await request.post(`${API}/functions/conversation-start`, {
      ...options, data: { participant_id: `qa-photographer-${actorIndex}` },
    });
    expect(start.ok()).toBe(true);
    const conversation = await start.json();
    const incomingKey = `QA incoming ${Date.now()}-${width}`;
    const incoming = `${incomingKey} Load shoot ${'0123456789abcdef'.repeat(40)}`;
    const seeded = await request.post(`${API}/functions/chat-messages`, {
      ...options, data: { action: 'send', conversation_id: conversation.id, text: incoming, client_message_id: incomingKey },
    });
    expect(seeded.ok()).toBe(true);

    await page.setViewportSize({ width, height: 844 });
    await page.route(/https:\/\/.*(?:nip\.io|supabase\.co|nhost\.run)\//, route => route.abort());
    const crashes = [];
    page.on('pageerror', error => crashes.push(error.message));
    await page.goto('/');
    await page.getByPlaceholder('Email address').fill(`qa-photographer-${actorIndex}@example.invalid`);
    await page.getByPlaceholder('Password').fill(password);
    await page.getByText('Sign In', { exact: true }).last().click();
    await page.getByRole('tab', { name: /Chat/ }).click({ timeout: 40000 });
    const conversationCard = page.getByRole('button').filter({ has: page.getByText(incoming, { exact: true }) });
    const cardLabel = await conversationCard.getAttribute('aria-label');
    expect(cardLabel).toMatch(/^Open conversation with .+/);
    const title = cardLabel.replace('Open conversation with ', '');
    await conversationCard.click();
    const input = page.getByPlaceholder('Type a message...');
    await expect(input).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole('heading', { name: title, exact: true }).filter({ visible: true })).toBeVisible();
    // Stack navigation retains the hidden inbox preview behind the thread.
    const visibleMessage = body => page.getByText(body, { exact: true }).filter({ visible: true });
    await expect(visibleMessage(incoming)).toHaveCount(1);
    await expect(visibleMessage(incoming)).toBeVisible();
    await expectWrappedMessage(visibleMessage(incoming));
    const outgoing = `QA browser reply ${Date.now()}-${width} ${'fedcba9876543210'.repeat(40)}`;
    await input.fill(outgoing);
    await expect(input).toHaveValue(outgoing);
    const sent = page.waitForResponse(response => response.url() === `${API}/functions/chat-messages`
      && response.request().postDataJSON()?.action === 'send');
    await page.getByLabel('Send message', { exact: true }).click();
    expect((await sent).ok()).toBe(true);
    await expect(input).toHaveValue('');
    await expect(visibleMessage(outgoing)).toHaveCount(1);
    await expect(visibleMessage(outgoing)).toBeVisible();
    await expectWrappedMessage(visibleMessage(outgoing));
    const received = await request.post(`${API}/functions/chat-messages`, {
      ...options, data: { action: 'list', conversation_id: conversation.id },
    });
    expect(received.ok()).toBe(true);
    const messages = (await received.json()).messages;
    expect(messages.filter(message => message.body === outgoing)).toHaveLength(1);
    expect(messages.find(message => message.body === incoming).read_at).toBeTruthy();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2)).toBe(false);
    await page.screenshot({ path: testInfo.outputPath(`chat-${width}.png`), fullPage: true });
    expect(crashes).toEqual([]);
  });
}
