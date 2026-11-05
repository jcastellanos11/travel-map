import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import SwaggerParser from '@apidevtools/swagger-parser';
import { handleRequest } from '../src/app.ts';
import { documentationRoute } from '../src/modules/documentation/routes.ts';
import type { AppEnv } from '../src/env.ts';
import type { IdentityRepository, JsonObject } from '../src/infrastructure/postgres.ts';
import { csrf, SESSION_COOKIE } from '../src/modules/identity/security.ts';
const document = JSON.parse(await readFile(new URL('../openapi.json', import.meta.url), 'utf8'));
const origin = 'https://127.0.0.1:8789';
test('OpenAPI 3.1 validates with all internal refs and unique operation IDs', async () => {
  await SwaggerParser.validate(structuredClone(document));
  const ids = Object.values(document.paths as Record<string, Record<string, { operationId: string }>>).flatMap(p => Object.values(p).map(o => o.operationId));
  assert.equal(ids.length, 38); assert.equal(new Set(ids).size, ids.length);
  assert.equal(document.components.securitySchemes.SessionCookie.name, SESSION_COOKIE);
});
test('documentation route and validation source drift requires reviewed OpenAPI update', async () => {
  const hashes = JSON.parse(await readFile(new URL('../openapi.sources.json', import.meta.url), 'utf8')) as Record<string, string>;
  for (const file of await readdir(new URL('../src/', import.meta.url), { recursive: true })) if (/(routes|validation|types)\.ts$/.test(file)) assert.ok(hashes['src/' + file], `New source ${file}: review OpenAPI coverage`);
  for (const [path, hash] of Object.entries(hashes)) assert.equal(createHash('sha256').update(await readFile(new URL('../' + path, import.meta.url))).digest('hex'), hash, `${path} changed: review DTOs/routes and OpenAPI, then refresh reviewed hash`);
});
test('documented private method/path pairs hit implemented domain routes with real request validation', async () => {
  const token = 'a'.repeat(43), uuid = '00000000-0000-4000-8000-000000000001';
  const env: AppEnv = { APP_ENV: 'test', APP_ORIGIN: origin, SUPABASE_URL: 'http://127.0.0.1:59999', SUPABASE_PUBLISHABLE_KEY: 'synthetic', DATABASE_URL: 'postgresql://unused@127.0.0.1/travel_map_test_docs', OAUTH_COOKIE_KEY: 'a'.repeat(64) };
  const tracking = { action: '' };
  const repository: IdentityRepository = { begin: async () => false, consume: async () => false, complete: async () => false, call: async (_token, name) => { tracking.action = name; return { items: [] }; } };
  function sample(schema: JsonObject): unknown {
    if (schema.$ref) return sample(document.components.schemas[(schema.$ref as string).split('/').at(-1)!]);
    if (schema.oneOf) return sample((schema.oneOf as JsonObject[])[0]!);
    if (schema.anyOf) return null;
    if (schema.const !== undefined) return schema.const;
    if (schema.enum) return (schema.enum as unknown[])[0];
    if (schema.type === 'object') return Object.fromEntries(((schema.required as string[]).length ? schema.required as string[] : Object.keys(schema.properties as object).slice(0, Number(schema.minProperties ?? 0))).map(k => [k, k === 'token' ? token : sample((schema.properties as Record<string, JsonObject>)[k]!)]));
    if (schema.format === 'uuid') return uuid;
    return 'Documentation test';
  }
  for (const [path, methods] of Object.entries(document.paths as Record<string, Record<string, { requestBody?: { content: Record<string, { schema: JsonObject }> } }>>)) for (const [method, operation] of Object.entries(methods)) {
    if (!path.startsWith('/api/v1/') || ['/api/v1/auth/google/start', '/api/v1/auth/callback'].includes(path)) continue;
    const url = new URL(path.replaceAll(/\{[^}]+\}/g, uuid), origin); if (path === '/api/v1/places') url.search = '?countryCode=COL';
    tracking.action = ''; const body = operation.requestBody ? sample(operation.requestBody.content['application/json']!.schema) : undefined;
    const headers = { Cookie: `${SESSION_COOKIE}=${token}`, Origin: origin, 'X-CSRF-Token': await csrf(token), 'Content-Type': 'application/json' };
    const response = await handleRequest(new Request(url, { method: method.toUpperCase(), headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), env, { repository, provider: {} as never });
    assert.ok(response.status >= 200 && response.status < 300, `${method} ${path}: ${response.status}`);
    assert.ok(tracking.action && (tracking.action !== 'me' || path === '/api/v1/me'), `${method} ${path} fell through to unknown route`);
  }
});
test('documentation is dev-only HTTPS loopback, safe headers, prod and test always hidden', async () => {
  for (const path of ['/api-docs', '/openapi.json', '/api-docs/init.js', '/api-docs/swagger-ui.js', '/api-docs/swagger-ui.css']) {
    for (const APP_ENV of ['prod', 'test'] as const) assert.equal((await handleRequest(new Request(origin + path), { APP_ENV })).status, 404);
    assert.equal((await handleRequest(new Request('https://remote.invalid' + path), { APP_ENV: 'dev' })).status, 404);
    assert.equal((await handleRequest(new Request('http://127.0.0.1' + path), { APP_ENV: 'dev' })).status, 404);
  }
  const html = await documentationRoute(new Request(origin + '/api-docs'), { APP_ENV: 'dev' }); assert.equal(html!.status, 200);
  assert.ok(html!.headers.get('Content-Security-Policy')!.includes("script-src 'self'")); assert.equal(html!.headers.get('Referrer-Policy'), 'no-referrer');
  assert.equal((await handleRequest(new Request(origin + '/api-docs?url=https://evil.invalid'), { APP_ENV: 'dev' })).status, 404);
});
test('Swagger transport keeps CSRF out of request state, redacts me, blocks token/external flows', async () => {
  const script = await (await documentationRoute(new Request(origin + '/api-docs/init.js'), { APP_ENV: 'dev' }))!.text();
  let options: Record<string, unknown> = {}; const requests: Request[] = [];
  const window = { fetch: async (input: RequestInfo | URL) => { const request = input instanceof Request ? input : new Request(new URL(String(input), origin)); requests.push(request); return Response.json(request.url.endsWith('/openapi.json') ? structuredClone(document) : request.url.endsWith('/me') ? { id: 'synthetic', csrfToken: 'sensitive-synthetic-csrf' } : { ok: true }); } };
  vm.runInNewContext(script, { window, location: { origin }, URL, Request, Response, Headers, SwaggerUIBundle: (value: Record<string, unknown>) => { options = value; } });
  const original = { url: origin + '/api/v1/projects', method: 'POST', headers: {} };
  const intercepted = (options.requestInterceptor as (r: typeof original) => typeof original)(original); assert.deepEqual(intercepted.headers, {});
  await window.fetch(new Request(original.url, { method: 'POST', body: '{}' }));
  assert.equal(requests.at(-1)!.headers.get('X-CSRF-Token'), 'sensitive-synthetic-csrf'); assert.deepEqual(original.headers, {});
  const me = await window.fetch(origin + '/api/v1/me'); assert.ok(!(await me.text()).includes('csrf'));
  await assert.rejects(window.fetch('https://external.invalid/')); await assert.rejects(window.fetch(origin + '/api/v1/invitations/redeem'));
  const uiSpec=await (await window.fetch(origin+'/openapi.json')).json() as typeof document;
  assert.equal(uiSpec.components.parameters.csrf.schema.default,'automatic');
  assert.equal(document.components.parameters.csrf.schema.default,undefined);
  assert.equal(options.parameterMacro, undefined);
  assert.equal(options.persistAuthorization, false); assert.equal(options.validatorUrl, null);
  assert.doesNotMatch(script, /localStorage|sessionStorage|console\.|document\.cookie/);
});
test('actual workerd serves bundled local Swagger assets with unchanged private API CSP', async () => {
  const { createTestHarness } = await import('wrangler');
  const runtime = createTestHarness({ workers: [{ configPath: new URL('../wrangler.jsonc', import.meta.url), env: 'test', prebuiltWorkerDir: new URL('../dist/', import.meta.url), vars: { APP_ENV: 'dev', APP_ORIGIN: origin }, secrets: {} }] });
  try {
    await runtime.listen();
    for (const path of ['/api-docs', '/openapi.json', '/api-docs/swagger-ui.css', '/api-docs/swagger-ui.js', '/api-docs/init.js']) {
      const response = await runtime.fetch(origin + path); assert.equal(response.status, 200, path); assert.ok((await response.text()).length > 100); assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
    }
    const api = await runtime.fetch(origin + '/api/v1/me'); assert.equal(api.status, 401); assert.equal(api.headers.get('Content-Security-Policy'), "default-src 'none'; frame-ancestors 'none'");
  } finally { await runtime.close(); }
});
test('actual Swagger OpenAPI 3.1 resolver expands every operation without undefined macro nodes', async () => {
  const { default: SwaggerUIBundle } = await import('swagger-ui-dist/swagger-ui-bundle.js');
  const swagger = SwaggerUIBundle as unknown as (options: unknown) => { fn: { resolveSubtree: (spec: unknown, path: string[], options: unknown) => Promise<{ errors: unknown[] }> } };
  // Disable only browser config persistence in this DOM-free resolver test.
  const ui = swagger({ dom_id: null, validatorUrl: null, plugins: [() => ({ statePlugins: { configs: { wrapActions: { loaded: () => () => {} } } } })] });
  const options = { baseDoc: origin + '/openapi.json' };
  await assert.rejects(ui.fn.resolveSubtree(structuredClone(document), ['paths', '/api/v1/projects', 'get'], { ...options, parameterMacro: () => undefined }), (e: unknown) => e instanceof Error && e.stack!.includes('computeEdges'));
  for (const [path, methods] of Object.entries(document.paths)) for (const method of Object.keys(methods as object)) {
    const result = await ui.fn.resolveSubtree(structuredClone(document), ['paths', path, method], options);
    assert.equal(result.errors.length, 0, method + ' ' + path);
  }
});
