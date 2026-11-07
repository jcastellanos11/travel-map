import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApiClient, ApiError, paginatedPath } from '../src/api/client.ts';
import { decodeDto } from '../src/api/contracts.ts';
const id = '00000000-0000-4000-8000-000000000001';
const project = { id, ownerUserId: id, name: 'Synthetic Project', tripCreationPolicy: 'admins_only', status: 'active', createdAt: '2026-11-07T00:00:00Z' };
const me = { id, displayName: 'Synthetic', email: null, csrfToken: 'synthetic-secret-a', storage: { usedBytes: 0, reservedBytes: 0, quotaBytes: 500000000 } };
const json = (body: unknown, status = 200) => Response.json(body, { status });
const errorBody = (code: string) => ({ error: { code, message: 'PRIVATE INTERNAL DETAIL', requestId: id } });
const client = (handler: (input: RequestInfo | URL, options?: RequestInit) => Promise<Response>) => createApiClient(handler as typeof fetch);
test('typed GET validates generated Project DTO and same-origin request options', async () => {
  const api = client(async (path, options) => { assert.equal(path, '/api/v1/projects/' + id); assert.equal(options?.credentials, 'same-origin'); assert.equal(options?.cache, 'no-store'); assert.equal(options?.redirect, 'error'); assert.equal(new Headers(options?.headers).get('Cookie'), null); return json(project); });
  assert.deepEqual(await api.get('/api/v1/projects/' + id, 'Project'), project);
});
for (const [status, code, kind] of [[401, 'SESSION_REQUIRED', 'unauthenticated'], [403, 'ACTION_FORBIDDEN', 'forbidden'], [404, 'RESOURCE_NOT_FOUND', 'not_found'], [400, 'VALIDATION_ERROR', 'validation'], [409, 'OPERATION_CONFLICT', 'conflict'], [429, 'RATE_LIMITED', 'rate_limited'], [503, 'DEPENDENCY_UNAVAILABLE', 'unavailable']] as const) {
  test(`normalizes ${status} without reflecting private server messages`, async () => {
    const api = client(async () => json(errorBody(code), status));
    await assert.rejects(api.get('/api/v1/projects/' + id, 'Project'), e => e instanceof ApiError && e.status === status && e.kind === kind && e.code === code && e.requestId === id && !e.message.includes('PRIVATE'));
  });
}
test('network failure becomes safe network error without original credential-bearing cause', async () => {
  const api = client(async () => { throw new Error('postgresql://synthetic:secret@invalid'); });
  await assert.rejects(api.currentUser(), e => e instanceof ApiError && e.kind === 'network' && !JSON.stringify(e).includes('secret') && !e.message.includes('postgres'));
});
test('HTML, malformed JSON, null and contradictory DTOs never become successful data', async () => {
  for (const response of [new Response('<html>login</html>', { headers: { 'Content-Type': 'text/html' } }), new Response('{', { headers: { 'Content-Type': 'application/json' } }), json(null), json({ ...project, status: 'invented' }), json({ ...project, name: 7 }), json({ ...project, csrfToken: 'unexpected' }), new Response(null, { status: 204 })]) {
    const api = client(async () => response);
    await assert.rejects(api.get('/api/v1/projects/' + id, 'Project'), e => e instanceof ApiError && e.kind === 'protocol');
  }
});
test('malformed error envelope is sanitized and server code format is bounded', async () => {
  for (const data of [{ error: { code: 'postgres://secret' } }, { error: 'PRIVATE' }, {}, null]) await assert.rejects(client(async () => json(data, 503)).currentUser(), e => e instanceof ApiError && e.kind === 'protocol' && !e.message.includes('PRIVATE'));
});
test('204 mutation succeeds with fresh in-memory CSRF and no cookies or Origin set by client', async () => {
  const seen: RequestInit[] = [], paths: string[] = [];
  const api = client(async (path, options) => { paths.push(String(path)); seen.push(options!); return paths.length === 1 ? json(me) : new Response(null, { status: 204 }); });
  assert.equal(await api.mutate('POST', '/api/v1/projects/' + id + '/leave'), undefined);
  assert.deepEqual(paths, ['/api/v1/me', '/api/v1/projects/' + id + '/leave']);
  const headers = new Headers(seen[1].headers); assert.equal(headers.get('X-CSRF-Token'), me.csrfToken); assert.equal(headers.get('Cookie'), null); assert.equal(headers.get('Origin'), null); assert.equal(seen[1].credentials, 'same-origin');
});
test('mutation DTO is validated and CSRF is reacquired for each session without caching', async () => {
  let reads = 0, writes = 0;
  const api = client(async (path, init) => {
    if (path === '/api/v1/me') { reads++; return json({ ...me, csrfToken: 'synthetic-' + reads }); }
    writes++; assert.equal(new Headers(init?.headers).get('X-CSRF-Token'), 'synthetic-' + reads); assert.equal(init?.body, JSON.stringify({ name: 'Synthetic' })); return json(project);
  });
  for (let n = 0; n < 2; n++) assert.deepEqual(await api.mutate('POST', '/api/v1/projects', { name: 'Synthetic' }, { response: 'Project' }), project);
  assert.equal(reads, 2); assert.equal(writes, 2);
});
test('public currentUser strips CSRF and a denied session never sends a mutation', async () => {
  const api = client(async () => json(me)); const user = await api.currentUser(); assert.ok(!('csrfToken' in user)); assert.ok(!JSON.stringify(user).includes(me.csrfToken));
  let attempts = 0; const denied = client(async () => { attempts++; return json(errorBody('SESSION_REQUIRED'), 401); });
  await assert.rejects(denied.mutate('POST', '/api/v1/projects', {}, { response: 'Project' }), { status: 401 }); assert.equal(attempts, 1);
});
test('session and mutation transport never touch persistent browser stores or log credentials', async () => {
  const stores = ['localStorage', 'sessionStorage', 'document'] as const;
  const descriptors = stores.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
  const originalConsole = globalThis.console;
  let logCalls = 0;
  try {
    for (const name of stores) Object.defineProperty(globalThis, name, { configurable: true, get() { throw new Error('Credential persistence or cookie access is forbidden'); } });
    const record = () => { logCalls++; };
    globalThis.console = { ...originalConsole, log: record, info: record, debug: record, warn: record, error: record };
    const api = client(async path => path === '/api/v1/me' ? json(me) : new Response(null, { status: 204 }));
    assert.ok(!('csrfToken' in await api.currentUser()));
    await api.mutate('POST', '/api/v1/projects/' + id + '/leave');
    assert.equal(logCalls, 0);
  } finally {
    globalThis.console = originalConsole;
    stores.forEach((name, index) => {
      if (descriptors[index]) Object.defineProperty(globalThis, name, descriptors[index]!);
      else Reflect.deleteProperty(globalThis, name);
    });
  }
});
test('pagination preserves opaque cursor and empty pages; no cross-scope accumulation', async () => {
  const cursor = 'synthetic+cursor/=';
  const path = paginatedPath('/api/v1/projects?limit=2', { limit: 1, cursor }); assert.equal(new URL(path, 'https://same.invalid').searchParams.get('cursor'), cursor);
  assert.deepEqual(await client(async () => json({ items: [project], nextCursor: cursor })).get(path, 'ProjectPage'), { items: [project], nextCursor: cursor });
  assert.deepEqual(await client(async () => json({ items: [], nextCursor: null })).get('/api/v1/projects', 'ProjectPage'), { items: [], nextCursor: null });
  assert.throws(() => paginatedPath('/api/v1/projects', { limit: 101 }), ApiError);
});
test('AbortSignal cancels before fetch, in flight, and between CSRF acquisition and mutation', async () => {
  const before = new AbortController(); before.abort(); let calls = 0;
  const idle = client(async () => { calls++; return json(me); }); await assert.rejects(idle.currentUser({ signal: before.signal }), { name: 'AbortError' }); assert.equal(calls, 0);
  const controller = new AbortController();
  const pending = client(async (_path, init) => new Promise((_resolve, reject) => { assert.equal(init?.signal, controller.signal); init?.signal?.addEventListener('abort', () => reject(init.signal!.reason), { once: true }); }));
  const request = pending.currentUser({ signal: controller.signal }); controller.abort(); await assert.rejects(request, { name: 'AbortError' });
  const between = new AbortController(); let sent = 0; const changing = client(async () => { sent++; between.abort(); return json(me); });
  await assert.rejects(changing.mutate('POST', '/api/v1/projects', {}, { signal: between.signal, response: 'Project' }), { name: 'AbortError' }); assert.equal(sent, 1);
});
test('absolute, protocol-relative, traversal and non-API paths are rejected before network', async () => {
  let calls = 0; const api = client(async () => { calls++; return json(project); });
  for (const path of ['https://other.invalid/api/v1/projects', '//other.invalid/api/v1/projects', '/api/v1/../../outside', '/api/v1/%2e%2e/%2e%2e/outside', '/api/v1/projects#token', '/api/v1/\\other', '/health']) await assert.rejects(api.get(path, 'Project'), ApiError);
  assert.equal(calls, 0);
});
test('health shares transport and never probes private readiness or credentials', async () => {
  const api = client(async (path, init) => { assert.equal(path, '/health'); assert.equal(init?.credentials, 'same-origin'); return json({ status: 'ok' }); }); await api.health();
});
test('geography DTOs are API contracts without Leaflet or implied parent Project visibility', () => {
  const place = { id, countryCode: 'COL', countryName: 'Colombia', city: 'Synthetic', region: null, createdAt: project.createdAt, approximateCoordinates: null, source: { provider: null, id: null, url: null } };
  const visit = { id, tripId: id, placeId: id, createdByUserId: id, name: null, status: 'active', place, confirmedCoordinates: null, date: { mode: 'none', start: null, end: null }, photoCount: 0, previewPhotoId: null, createdAt: project.createdAt, updatedAt: project.createdAt };
  assert.deepEqual(decodeDto('Visit', visit), visit); assert.throws(() => decodeDto('Visit', { ...visit, confirmedCoordinates: { lat: 1, lng: 1 } }));
});
