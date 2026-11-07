import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { createTestHarness } from 'wrangler';
const origin = 'https://127.0.0.1:8789';
const config = {
  name: 'travel-map-frontend-asset-test',
  main: fileURLToPath(new URL('../src/index.ts', import.meta.url)),
  compatibility_date: '2026-10-30',
  compatibility_flags: ['nodejs_compat'],
  vars: { APP_ENV: 'dev', APP_ORIGIN: origin },
  dev: { ip: '127.0.0.1', local_protocol: 'https' as const },
  assets: { directory: fileURLToPath(new URL('../.local/e31-assets/', import.meta.url)) },
};

test('real workerd asset rewrites serve root, application deep links and invalid app routes without redirects', async () => {
  const runtime = createTestHarness({ workers: [{ config }] });
  try {
    await runtime.listen();
    for (const path of ['/', '/app', '/app/', '/app/projects/00000000-0000-4000-8000-000000000002', '/app/trips/00000000-0000-4000-8000-000000000003', '/app/invalid']) {
      const response = await runtime.fetch(origin + path, { redirect: 'manual' });
      assert.equal(response.status, 200, path);
      assert.match(response.headers.get('Content-Type') ?? '', /text\/html/);
      assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
      const csp = response.headers.get('Content-Security-Policy') ?? '';
      assert.ok(csp.includes("connect-src 'self'")); assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval|geoboundaries/);
      assert.match(await response.text(), /Travel Map — Your journeys/);
    }
  } finally { await runtime.close(); }
});
test('real asset integration preserves API JSON, invitation, diagnostic, demo and docs boundaries', async () => {
  const runtime = createTestHarness({ workers: [{ config }] });
  try {
    await runtime.listen();
    for (const path of ['/api/v1/me', '/api/v1/unknown', '/api/v1/projects']) {
      const response = await runtime.fetch(origin + path); assert.equal(response.status, 401);
      assert.match(response.headers.get('Content-Type') ?? '', /application\/json/);
      assert.equal(response.headers.get('Content-Security-Policy'), "default-src 'none'; frame-ancestors 'none'");
    }
    for (const path of ['/api', '/outside-app-unknown']) {
      const response = await runtime.fetch(origin + path); assert.equal(response.status, 404);
      assert.match(response.headers.get('Content-Type') ?? '', /application\/json/);
    }
    for (const path of ['/health', '/invite', '/api-docs', '/openapi.json', '/__local/integration/', '/demo/']) assert.equal((await runtime.fetch(origin + path)).status, 200, path);
    const app = await (await runtime.fetch(origin + '/app')).text();
    for (const match of app.matchAll(/(?:src|href)="(\/demo\/assets\/[^"]+)"/g)) assert.equal((await runtime.fetch(origin + match[1])).status, 200, match[1]);
  } finally { await runtime.close(); }
});
test('default production configuration binds no frontend/debug assets and exposes no documentation', async () => {
  const source = await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  assert.ok(!('assets' in JSON.parse(source)));
  const runtime = createTestHarness({ workers: [{ configPath: new URL('../wrangler.jsonc', import.meta.url), env: 'test', prebuiltWorkerDir: new URL('../dist/', import.meta.url), vars: { APP_ENV: 'prod' }, secrets: {} }] });
  try {
    await runtime.listen();
    for (const path of ['/app', '/app/trips/00000000-0000-4000-8000-000000000003', '/__local/integration/', '/api-docs', '/openapi.json']) assert.equal((await runtime.fetch(origin + path)).status, 404, path);
  } finally { await runtime.close(); }
});
