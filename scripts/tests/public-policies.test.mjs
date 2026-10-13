import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readLegalDocuments, renderPolicy } from '../build-public-policies.mjs';

test('public policies use the app document source and confirmed operator', () => {
  const docs = readLegalDocuments(fs.readFileSync(new URL('../../src/constants/LegalContent.ts', import.meta.url), 'utf8'));
  assert.equal(Object.keys(docs).length, 6);
  for (const key of ['TERMS_OF_SERVICE', 'PRIVACY_POLICY']) {
    const html = renderPolicy(docs[key]);
    assert.ok(html.includes('PAPZ (Pty) Ltd'));
    assert.ok(html.includes('2025/188861/07'));
    assert.equal(html.includes('Papzii (Pty) Ltd'), false);
    assert.ok(html.includes('<h1>'));
  }
});

test('policy renderer escapes raw HTML and renders markdown tables', () => {
  const html = renderPolicy('# Test\n\n<script>alert(1)</script>\n\n| Share | Value |\n|---|---|\n| Creator | 70% |');
  assert.equal(html.includes('<script>'), false);
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('<table>'));
});
