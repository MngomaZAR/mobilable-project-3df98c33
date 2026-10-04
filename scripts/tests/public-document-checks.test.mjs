import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkPublicDocuments, publicDocuments } from '../lib/public-document-checks.mjs';

const page = (status = 200, body = '<h1>Papzi policy</h1>', contentType = 'text/html', url) => ({
  ok: status >= 200 && status < 300,
  status, url,
  headers: new Headers({ 'content-type': contentType }),
  text: async () => body,
});

test('probes each public document without credentials and with a timeout', async () => {
  const calls = [];
  const results = await checkPublicDocuments(async (url, options) => {
    calls.push(url);
    assert.equal(options.headers.Accept, 'text/html');
    assert.equal(options.signal instanceof AbortSignal, true);
    assert.equal(options.headers.Authorization, undefined);
    return page();
  });
  assert.deepEqual(calls, publicDocuments.map(document => document.url));
  assert.equal(results.every(result => result.ok), true);
});

test('a 404 privacy page fails even when terms are reachable', async () => {
  const results = await checkPublicDocuments(async url => page(url.endsWith('/privacy') ? 404 : 200));
  assert.equal(results[0].ok, false);
  assert.equal(results[0].reason, 'HTTP 404');
  assert.equal(results[1].ok, true);
});

test('login, off-site and downgraded redirects do not establish availability', async () => {
  for (const url of ['https://papzii.co.za/login', 'https://example.com/privacy', 'http://papzii.co.za/privacy']) {
    const results = await checkPublicDocuments(async () => page(200, '<h1>Sign in</h1>', 'text/html', url));
    assert.equal(results.every(result => !result.ok), true);
  }
});

test('same-document trailing slash redirects remain valid', async () => {
  const results = await checkPublicDocuments(async url => page(200, '<h1>Policy</h1>', 'text/html; charset=utf-8', url + '/'));
  assert.equal(results.every(result => result.ok), true);
});

test('JSON and empty responses do not establish public legal pages', async () => {
  for (const response of [page(200, '{}', 'application/json'), page(200, '  ')]) {
    const results = await checkPublicDocuments(async () => response);
    assert.equal(results.every(result => !result.ok), true);
  }
});

test('a timeout is recorded without suppressing checks on the other document', async () => {
  const results = await checkPublicDocuments(async url => {
    if (url.endsWith('/privacy')) throw new Error('private network details');
    return page();
  });
  assert.equal(results[0].reason, 'unreachable or timed out');
  assert.equal(results[1].ok, true);
  assert.equal(JSON.stringify(results).includes('private network'), false);
});
