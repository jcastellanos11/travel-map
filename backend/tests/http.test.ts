import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleRequest } from '../src/app.ts';
import { errorResponse } from '../src/shared/http.ts';
import type { AppEnv } from '../src/env.ts';

test('health is liveness only and discloses no infrastructure', async () => {
  const response = await handleRequest(new Request('https://api.example.invalid/health'), { APP_ENV: 'test' });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok' });
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
});

test('all private API paths fail closed, including forged credentials', async () => {
  for (const path of ['/api/v1', '/api/v1/me', '/api/v1/projects', '/api/v1/photos/other/original']) {
    const response = await handleRequest(new Request(`https://api.example.invalid${path}`, {
      headers: { Cookie: '__Host-travel-map-session=forged', Authorization: 'Bearer invented',
        'X-Mock-User': 'owner', 'X-Request-Id': 'caller-controlled' },
    }), { APP_ENV: 'test' });
    assert.equal(response.status, 401);
    const body = await response.json() as { error: { code: string; requestId: string } };
    assert.equal(body.error.code, 'SESSION_REQUIRED');
    assert.equal(body.error.requestId, response.headers.get('X-Request-Id'));
    assert.notEqual(body.error.requestId, 'caller-controlled');
  }
});

test('no PoC harness, debug or login implementation is exposed', async () => {
  for (const path of ['/harness/reset', '/debug', '/not-implemented']) {
    const response = await handleRequest(new Request(`https://api.example.invalid${path}`), { APP_ENV: 'test' });
    assert.equal(response.status, path.startsWith('/api/v1') ? 401 : 404);
    assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  }
});

test('unsupported health methods return normalized 405 with Allow', async () => {
  const response = await handleRequest(new Request('https://api.example.invalid/health', { method: 'POST' }), { APP_ENV: 'test' });
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('Allow'), 'GET');
  assert.equal((await response.json() as { error: { code: string } }).error.code, 'METHOD_NOT_ALLOWED');
});

test('unexpected errors and invalid configuration never disclose internal values', async () => {
  const response = errorResponse(new Error('postgresql://secret-value@example.invalid/private'), 'req_test');
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: { code: 'INTERNAL_ERROR', message: 'Unexpected server error', requestId: 'req_test' } });
  const invalid = await handleRequest(new Request('https://api.example.invalid/health'), { APP_ENV: 'invalid' } as unknown as AppEnv);
  assert.equal(invalid.status, 500);
  assert.ok(!(await invalid.text()).includes('Invalid application environment'));
});
