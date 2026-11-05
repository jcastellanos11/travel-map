import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { handleRequest } from '../src/app.ts';
import { randomToken, digest } from '../src/modules/identity/security.ts';
test('invitation landing is anonymous context-free, no-store and narrowly nonce-protected', async () => {
  const response = await handleRequest(new Request('https://example.invalid/invite'), { APP_ENV: 'test' });
  assert.equal(response.status, 200); assert.equal(response.headers.get('Referrer-Policy'), 'no-referrer');
  assert.ok(response.headers.get('Cache-Control')!.includes('no-store'));
  const policy = response.headers.get('Content-Security-Policy')!; assert.ok(policy.includes("default-src 'none'") && policy.includes("connect-src 'self'") && !policy.includes('unsafe-inline'));
  const text = await response.text(); assert.ok(text.includes('history.replaceState') && text.includes("method:'POST'") && text.includes('noopener noreferrer'));
  assert.equal((await handleRequest(new Request('https://example.invalid/invite?token=forbidden'), { APP_ENV: 'test' })).status, 400);
  const tokens = new Set(Array.from({ length: 100 }, () => randomToken())); assert.equal(tokens.size, 100); for (const token of tokens) assert.match(await digest(token), /^[a-f0-9]{64}$/);
});
test('E2.3 migration checksums remain immutable', async () => {
  for (const [part, hash] of [['up', 'f1440f5200b245820b6c4656ab20f93cdf48617ec92de4e34f4731810a171924'], ['down', 'bc9de096c27499ce9ef09cc1c135bca93616aba848e1c4eeee1133f79a79df38']]) assert.equal(createHash('sha256').update(await readFile(new URL(`../migrations/0005_membership_management.${part}.sql`, import.meta.url))).digest('hex'), hash);
});
