import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTestHarness } from 'wrangler';

test('built Worker starts in actual local workerd and enforces HTTP boundary', async () => {
  const runtime = createTestHarness({
    workers: [{
      configPath: new URL('../wrangler.jsonc', import.meta.url),
      env: 'test',
      prebuiltWorkerDir: new URL('../dist/', import.meta.url),
      secrets: {},
    }],
  });
  try {
    await runtime.listen();
    const healthy = await runtime.fetch('/health');
    assert.equal(healthy.status, 200);
    assert.deepEqual(await healthy.json(), { status: 'ok' });
    const privateRead = await runtime.fetch('/api/v1/me', {
      headers: { Cookie: '__Host-travel-map-session=forged' },
    });
    assert.equal(privateRead.status, 401);
    assert.equal(privateRead.headers.get('Cache-Control'), 'private, no-store');
    assert.equal((await runtime.fetch('/harness/reset')).status, 404);
  } finally {
    await runtime.close();
  }
});
