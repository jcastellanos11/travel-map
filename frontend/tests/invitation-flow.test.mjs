// Synthetic DOM/HTTP simulation of the EXISTING server-owned landing script.
// This is not a browser, Google login, SQL single-use or real-account E2E test.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import { invitationLanding } from '../../backend/src/modules/invitations/landing.ts';

const token = 'Q'.repeat(43);
async function landing(handler, fragment = token) {
  const response = invitationLanding(), html = await response.text(), calls = [], history = [];
  const controls = { redeem: {}, result: { textContent: '' } };
  const location = { hash: `#${fragment}` };
  const script = html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)?.[1]; assert.ok(script);
  const context = {
    location, history: { replaceState: (state, title, path) => { history.push({ state, title, path }); location.hash = ''; } },
    document: { getElementById: id => controls[id] },
    fetch: async (path, options = {}) => { calls.push({ path, options }); return handler(path, options); },
    console: new Proxy({}, { get: () => () => { throw Error('Unexpected logging'); } }),
    get localStorage() { throw Error('Unexpected persistent token storage'); },
    get sessionStorage() { throw Error('Unexpected persistent token storage'); },
  };
  vm.runInNewContext(script, context);
  return { response, html, calls, history, controls, location, accept: () => controls.redeem.onclick() };
}
test('existing /invite removes the fragment before any request and redeems only on explicit action', async () => {
  const page = await landing(() => Response.json({}));
  assert.equal(page.location.hash, ''); assert.equal(page.history.length, 1); assert.equal(page.history[0].path, '/invite');
  assert.equal(page.calls.length, 0); assert.ok(!page.html.includes(token));
});
test('existing invitation OAuth continuation is a separate tab with unchanged Google entry and no bearer state', async () => {
  const page = await landing(() => new Response(null, { status: 401 }));
  assert.match(page.html, /href="\/api\/v1\/auth\/google\/start" target="_blank" rel="noopener noreferrer"/);
  await page.accept(); assert.equal(page.calls.length, 1); assert.equal(page.calls[0].path, '/api/v1/me');
  assert.match(page.controls.result.textContent, /Sign in using the Google link, then return/);
});
test('original invitation tab keeps memory-only continuation while another tab signs in', async () => {
  let authenticated = false;
  const page = await landing(path => path === '/api/v1/me'
    ? authenticated ? Response.json({ csrfToken: 'synthetic-landing-csrf' }) : new Response(null, { status: 401 })
    : Response.json({ scopeType: 'trip', scopeId: 'synthetic-scope', result: 'access_granted' }));
  await page.accept(); authenticated = true; await page.accept();
  const mutation = page.calls.find(call => call.path === '/api/v1/invitations/redeem'); assert.ok(mutation);
  assert.equal(mutation.options.method, 'POST'); assert.equal(mutation.options.credentials, 'same-origin');
  assert.equal(mutation.options.headers['X-CSRF-Token'], 'synthetic-landing-csrf');
  assert.deepEqual(JSON.parse(mutation.options.body), { token });
  assert.match(page.controls.result.textContent, /Access granted/);
});
test('existing-access response explicitly says the single-use invitation was consumed', async () => {
  const page = await landing(path => Response.json(path === '/api/v1/me' ? { csrfToken: 'synthetic' } : { result: 'already_has_access' }));
  await page.accept(); assert.match(page.controls.result.textContent, /already have access.*consumed/);
});
for (const label of ['invalid', 'expired', 'revoked', 'consumed']) test(`${label} redemption response remains generic and reveals no private scope`, async () => {
  const page = await landing(path => path === '/api/v1/me' ? Response.json({ csrfToken: 'synthetic' }) : Response.json({ error: { code: 'INVITATION_INVALID', message: 'PRIVATE NEVER DISPLAY' } }, { status: 400 }));
  await page.accept(); assert.equal(page.controls.result.textContent, 'Invitation unavailable or already used.');
  assert.ok(!page.controls.result.textContent.includes(token));
});
test('redemption throttling uses safe feedback and never retries automatically', async () => {
  const page = await landing(path => path === '/api/v1/me' ? Response.json({ csrfToken: 'synthetic' }) : new Response(null, { status: 429 }));
  await page.accept(); assert.equal(page.controls.result.textContent, 'Please try again later.'); assert.equal(page.calls.length, 2);
});
test('reloading without a fragment cannot recover or redeem the bearer token', async () => {
  const page = await landing(() => { throw Error('Should not fetch'); }, '');
  await page.accept(); assert.equal(page.calls.length, 0); assert.match(page.controls.result.textContent, /Open a valid invitation link/);
});
test('existing landing uses nonce-only CSP and has no automatic scoped navigation or inspection contract', async () => {
  const page = await landing(path => Response.json(path === '/api/v1/me' ? { csrfToken: 'synthetic' } : { scopeType: 'trip', scopeId: 'PRIVATE_SCOPE', result: 'access_granted' }));
  const csp = page.response.headers.get('Content-Security-Policy'); assert.match(csp, /script-src 'nonce-[a-f0-9]+'/); assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
  await page.accept(); assert.ok(!page.controls.result.textContent.includes('PRIVATE_SCOPE')); assert.equal(page.history.length, 1);
  // Frontend-only E3.5 cannot change this server page: scoped redirect remains a
  // documented blocker, not an invented passing navigation test.
});
