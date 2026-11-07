import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createApiClient } from '../src/api/client.ts';
import type { Place, Visit } from '../src/api/contracts.ts';
import type { VisitCreate } from '../src/api/generated.ts';
import { AppController } from '../src/private/controller.ts';
import AppView from '../src/private/AppView.tsx';
import { placeLabel } from '../src/private/visits/forms.ts';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const time = '2026-11-07T00:00:00Z';
const me = { id: id(1), displayName: 'Synthetic', email: null, csrfToken: 'synthetic-csrf-visits', storage: { usedBytes: 0, reservedBytes: 0, quotaBytes: 500000000 } };
const place = (n = 100): Place => ({ id: id(n), city: 'Springfield', region: n === 100 ? 'IL' : 'MA', countryCode: 'USA', countryName: 'United States', createdAt: time, approximateCoordinates: null, source: { provider: 'synthetic', id: String(n), url: null } });
const visit = (n = 8, trip = 3): Visit => ({ id: id(n), tripId: id(trip), placeId: id(100), place: place(), createdByUserId: id(1), name: `Synthetic Visit ${n}`, date: { mode: 'none', start: null, end: null }, status: 'active', createdAt: time, updatedAt: time, confirmedCoordinates: null, photoCount: 0, previewPhotoId: null });
const page = (items: unknown[] = [], nextCursor: string | null = null) => ({ items, nextCursor });
const failure = (status: number) => Response.json({ error: { code: ({ 400: 'VALIDATION_ERROR', 401: 'SESSION_REQUIRED', 403: 'ACTION_FORBIDDEN', 404: 'RESOURCE_NOT_FOUND', 409: 'OPERATION_CONFLICT', 429: 'RATE_LIMITED', 503: 'DEPENDENCY_UNAVAILABLE' } as Record<number, string>)[status], message: 'INTERNAL PRIVATE DETAIL', requestId: id(90) } }, { status });
type Handler = (path: string, init: RequestInit) => Response | Promise<Response> | undefined;
function setup(handler: Handler = () => undefined) {
  let path = `/app/trips/${id(3)}`;
  const calls: { path: string; init: RequestInit }[] = [];
  const controller = new AppController(createApiClient((async (input, options) => {
    const p = String(input), init = options!; calls.push({ path: p, init });
    const result = await handler(p, init); if (result) return result;
    if (p === '/api/v1/me') return Response.json(me);
    if (p.startsWith('/api/v1/projects?')) return Response.json(page());
    if (/^\/api\/v1\/trips\/[^/]+$/.test(p)) return Response.json({ id: p.split('/').at(-1), projectId: id(2), createdByUserId: id(2), name: 'Authorized Trip', description: null, status: 'active', createdAt: time, updatedAt: time });
    if (p.startsWith(`/api/v1/trips/${id(3)}/visits?`)) return Response.json(page([visit()]));
    if (p.startsWith(`/api/v1/trips/${id(5)}/visits?`)) return Response.json(page([visit(9, 5)]));
    if (p.startsWith('/api/v1/places?')) return Response.json(page([place(), place(101)]));
    if (p === `/api/v1/visits/${id(8)}`) return Response.json(visit());
    if (p === `/api/v1/visits/${id(9)}`) return Response.json(visit(9, 5));
    throw new Error('Unplanned synthetic request');
  }) as typeof fetch), { read: () => path, go: target => { path = target; }, subscribe: () => () => undefined });
  return { controller, calls, setPath: (value: string) => { path = value; } };
}
function scope(controller: AppController) { const state = controller.getSnapshot(); assert.equal(state.phase, 'ready'); if (state.phase !== 'ready' || state.scope.status !== 'trip') throw new Error('Trip not ready'); return state.scope; }
function html(controller: AppController) { return renderToStaticMarkup(createElement(AppView, { state: controller.getSnapshot(), actions: controller, onLogin: () => undefined })); }
const input: VisitCreate = { placeId: id(100), name: null, date: { mode: 'none', start: null, end: null } };
const tick = () => new Promise<void>(done => setImmediate(done));
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
async function creating(h: ReturnType<typeof setup>) { await h.controller.verify(); h.controller.openVisitEditor('create'); await h.controller.searchPlaces('USA', 'Springfield'); }

test('Place search uses required country, bounded pagination and literal encoded query', async () => {
  const h = setup(); await creating(h);
  const search = h.calls.find(c => c.path.startsWith('/api/v1/places?'))!;
  assert.equal(new URL(search.path, 'https://local.invalid').searchParams.get('countryCode'), 'USA');
  assert.equal(new URL(search.path, 'https://local.invalid').searchParams.get('query'), 'Springfield');
  assert.equal(new URL(search.path, 'https://local.invalid').searchParams.get('limit'), '25');
  assert.equal(search.init.credentials, 'same-origin'); assert.equal(scope(h.controller).catalog.status, 'ready');
});
test('homonymous catalog Places retain distinct IDs/regions and are never auto-selected or merged', async () => {
  const h = setup(); await creating(h); const catalog = scope(h.controller).catalog;
  assert.equal(catalog.status, 'ready'); if (catalog.status === 'ready') assert.deepEqual(catalog.results.page.items.map(p => p.id), [id(100), id(101)]);
  assert.notEqual(placeLabel(place()), placeLabel(place(101)));
  assert.match(html(h.controller), /region IL/); assert.match(html(h.controller), /region MA/);
  assert.doesNotMatch(html(h.controller), /checked=""|worldwide|synthetic-csrf-visits/);
});
test('empty catalog and unsupported country fail without creating Places or Visits', async () => {
  const empty = setup(p => p.startsWith('/api/v1/places?') ? Response.json(page()) : undefined);
  await creating(empty); assert.match(html(empty.controller), /No catalog matches/);
  const denied = setup(p => p.startsWith('/api/v1/places?') ? failure(400) : undefined);
  await creating(denied); assert.match(html(denied.controller), /unavailable in the controlled catalog/);
  assert.ok([...empty.calls, ...denied.calls].every(c => c.init.method === 'GET'));
});
test('invalid search input fails locally without any catalog request', async () => {
  const h = setup(); await h.controller.verify(); h.controller.openVisitEditor('create');
  for (const [country, query] of [['US', ''], ['usa', ''], ['USA', 'x'.repeat(101)], ['USA', 'bad\nquery']]) await h.controller.searchPlaces(country, query);
  assert.equal(h.calls.filter(c => c.path.startsWith('/api/v1/places')).length, 0);
});
test('Place pagination uses only the current search cursor and retains independent identities', async () => {
  const h = setup(p => p.startsWith('/api/v1/places?') ? Response.json(p.includes('cursor=') ? page([place(101)]) : page([place()], 'place-cursor')) : undefined);
  await creating(h); await h.controller.searchPlaces('USA', 'Springfield', true);
  const catalog = scope(h.controller).catalog; if (catalog.status !== 'ready') throw new Error();
  assert.equal(catalog.results.page.items.length, 2);
  const before = h.calls.length; await h.controller.searchPlaces('COL', '', true); assert.equal(h.calls.length, before);
});
test('outdated catalog responses and explicit cancellation cannot overwrite a new search', async () => {
  const old = deferred<Response>();
  const h = setup(p => p.includes('query=old') ? old.promise : undefined);
  await h.controller.verify(); h.controller.openVisitEditor('create');
  const pending = h.controller.searchPlaces('USA', 'old'); await tick();
  h.controller.clearPlaces(); await h.controller.searchPlaces('USA', 'Springfield');
  old.resolve(Response.json(page([place(102)]))); await pending;
  const catalog = scope(h.controller).catalog; if (catalog.status !== 'ready') throw new Error();
  assert.equal(catalog.query, 'Springfield'); assert.ok(!catalog.results.page.items.some(p => p.id === id(102)));
  assert.ok(h.calls.find(c => c.path.includes('query=old'))?.init.signal?.aborted);
});
test('catalog results with contradictory country fail closed', async () => {
  const h = setup(p => p.startsWith('/api/v1/places?') ? Response.json(page([{ ...place(), countryCode: 'COL' }])) : undefined);
  await creating(h); assert.equal(h.controller.getSnapshot().phase, 'unavailable');
});
for (const mode of ['none', 'single', 'range'] as const) test(`Guest creates Visit with ${mode} dates and refreshes only the authorized Trip list`, async () => {
  const date = mode === 'none' ? { mode, start: null, end: null } : mode === 'single' ? { mode, start: '2024-02-29', end: '2024-02-29' } : { mode, start: '2024-02-29', end: '2024-03-01' };
  const h = setup((p, init) => p === `/api/v1/trips/${id(3)}/visits` && init.method === 'POST' ? Response.json({ ...visit(10), date }, { status: 201 }) : undefined);
  await creating(h); await h.controller.saveVisit({ ...input, date });
  assert.equal(scope(h.controller).saved, 'Visit created.');
  const post = h.calls.find(c => c.init.method === 'POST')!;
  assert.deepEqual(JSON.parse(String(post.init.body)), { ...input, date });
  assert.equal(new Headers(post.init.headers).get('X-CSRF-Token'), me.csrfToken);
  assert.equal(h.calls.filter(c => c.path.startsWith(`/api/v1/trips/${id(3)}/visits?`)).length, 2);
  assert.ok(!h.calls.some(c => /\/projects\/|\/members|\/map/.test(c.path)));
});
test('no Visit mutation is automatic; unknown/missing Place IDs and invalid dates never send POST', async () => {
  const h = setup(); await creating(h);
  await h.controller.saveVisit({ ...input, placeId: id(999) });
  await h.controller.saveVisit({ ...input, placeId: '' });
  await h.controller.saveVisit({ ...input, date: { mode: 'range', start: '2024-03-01', end: '2024-02-29' } });
  await h.controller.saveVisit({ ...input, date: { mode: 'single', start: '2025-02-29', end: '2025-02-29' } });
  assert.ok(h.calls.every(c => c.init.method === 'GET'));
  assert.match(html(h.controller), /Select an existing catalog Place/);
});
test('creator identity, ancestry, status and precise GPS never enter a Visit mutation payload', async () => {
  const h = setup((p, init) => p.endsWith('/visits') && init.method === 'POST' ? Response.json(visit(10), { status: 201 }) : undefined);
  await creating(h);
  const crafted = { ...input, createdByUserId: id(99), tripId: id(5), projectId: id(99), status: 'deleted', role: 'admin', confirmedCoordinates: { lat: 1, lng: 1 } };
  // Simulate an untyped caller attempting fields excluded by the generated DTO.
  await h.controller.saveVisit(crafted as unknown as VisitCreate);
  assert.deepEqual(JSON.parse(String(h.calls.find(c => c.init.method === 'POST')!.init.body)), input);
});
test('Visit list retains repeated Place identities as separate Visits and paginates by Visit ID', async () => {
  const h = setup(p => p.includes(`/trips/${id(3)}/visits?`) ? Response.json(p.includes('cursor=') ? page([visit(10)]) : page([visit()], 'visit-cursor')) : undefined);
  await h.controller.verify(); await h.controller.loadVisits(true);
  const list = scope(h.controller).visits; if (list.status !== 'ready') throw new Error();
  assert.deepEqual(list.page.items.map(v => v.id), [id(8), id(10)]);
  assert.equal(list.page.items[0].placeId, list.page.items[1].placeId);
});
test('empty Trip Visit list displays an honest empty state', async () => {
  const h = setup(p => p.includes('/visits?') ? Response.json(page()) : undefined);
  await h.controller.verify(); assert.match(html(h.controller), /No Visits in this Trip yet/);
});
test('details load only a selected ID from the current authorized Trip page', async () => {
  const h = setup(); await h.controller.verify(); await h.controller.selectVisit(id(8));
  assert.equal(scope(h.controller).selection.status, 'ready'); assert.match(html(h.controller), /Visit details/);
  const before = h.calls.length; await h.controller.selectVisit(id(9));
  assert.equal(h.calls.length, before); assert.equal(scope(h.controller).selection.status, 'error');
  assert.doesNotMatch(html(h.controller), /Synthetic Visit 9|Visit details/);
});
test('foreign Visits in list/detail responses are never displayed under the current Trip', async () => {
  for (const kind of ['list', 'detail']) {
    const h = setup(p => kind === 'list' && p.includes('/visits?') ? Response.json(page([visit(9, 5)])) : kind === 'detail' && p === `/api/v1/visits/${id(8)}` ? Response.json(visit(8, 5)) : undefined);
    await h.controller.verify(); if (kind === 'detail') await h.controller.selectVisit(id(8));
    assert.equal(h.controller.getSnapshot().phase, 'unavailable'); assert.doesNotMatch(html(h.controller), /Synthetic Visit/);
  }
});
test('creator edits only supported Visit fields, preserving immutable identity and refreshing list', async () => {
  const h = setup((p, init) => p === `/api/v1/visits/${id(8)}` && init.method === 'PATCH' ? Response.json({ ...visit(), name: 'Edited' }) : undefined);
  await h.controller.verify(); await h.controller.selectVisit(id(8)); h.controller.openVisitEditor('edit');
  await h.controller.saveVisit({ ...input, name: 'Edited' });
  assert.equal(scope(h.controller).saved, 'Visit updated.');
  const patch = h.calls.find(c => c.init.method === 'PATCH')!; assert.deepEqual(JSON.parse(String(patch.init.body)), { name: 'Edited' });
  assert.match(html(h.controller), /Edited/);
});
test('unchanged edit emits no empty PATCH and unmodified fields are not overwritten', async () => {
  // PostgreSQL JSONB may serialize keys in a different order from form construction.
  const h = setup(p => p === `/api/v1/visits/${id(8)}` ? Response.json({ ...visit(), date: { end: null, mode: 'none', start: null } }) : undefined);
  await h.controller.verify(); await h.controller.selectVisit(id(8)); h.controller.openVisitEditor('edit');
  await h.controller.saveVisit({ ...input, name: visit().name });
  assert.ok(!h.calls.some(c => c.init.method === 'PATCH'));
  assert.match(html(h.controller), /Change a Visit field/);
});
test('edit can change catalog Place and full calendar range without resending unchanged name', async () => {
  const date = { mode: 'range' as const, start: '2024-02-29', end: '2024-03-01' };
  const h = setup((p, init) => p === `/api/v1/visits/${id(8)}` && init.method === 'PATCH' ? Response.json({ ...visit(), placeId: id(101), place: place(101), date }) : undefined);
  await h.controller.verify(); await h.controller.selectVisit(id(8)); h.controller.openVisitEditor('edit'); await h.controller.searchPlaces('USA', 'Springfield');
  await h.controller.saveVisit({ placeId: id(101), name: visit().name, date });
  assert.deepEqual(JSON.parse(String(h.calls.find(c => c.init.method === 'PATCH')!.init.body)), { placeId: id(101), date });
  const selection = scope(h.controller).selection; if (selection.status !== 'ready') throw new Error();
  assert.equal(selection.visit.placeId, id(101)); assert.deepEqual(selection.visit.date, date);
});
test('unknown Admin capability is explained and Owner/Admin success remains server-authoritative', async () => {
  const h = setup((p, init) => p === `/api/v1/visits/${id(8)}` ? Response.json({ ...visit(), createdByUserId: id(99), ...(init.method === 'PATCH' ? { name: 'Admin edit' } : {}) }) : undefined);
  await h.controller.verify(); await h.controller.selectVisit(id(8)); assert.match(html(h.controller), /Edit Visit \(Owner\/Admin only\)/);
  h.controller.openVisitEditor('edit'); await h.controller.saveVisit({ ...input, name: 'Admin edit' });
  assert.equal(scope(h.controller).saved, 'Visit updated.'); assert.ok(!h.calls.some(c => /\/projects\/|\/members/.test(c.path)));
});
for (const status of [403, 404]) test(`Visit edit ${status} clears private Visit context and exposes only safe feedback`, async () => {
  const h = setup((p, init) => p === `/api/v1/visits/${id(8)}` && init.method === 'PATCH' ? failure(status) : undefined);
  await h.controller.verify(); await h.controller.selectVisit(id(8)); h.controller.openVisitEditor('edit'); await h.controller.saveVisit(input);
  const state = h.controller.getSnapshot(); assert.ok(state.phase === 'ready' && state.scope.status === 'error');
  assert.doesNotMatch(html(h.controller), /Synthetic Visit|INTERNAL PRIVATE DETAIL|visit-form/);
  assert.match(html(h.controller), status === 403 ? /This action is not allowed/ : /Resource not available/);
});
for (const status of [400, 409, 429]) test(`Visit save ${status} remains recoverable without automatic retry`, async () => {
  const h = setup((p, init) => p.endsWith('/visits') && init.method === 'POST' ? failure(status) : undefined);
  await creating(h); await h.controller.saveVisit(input);
  assert.equal(scope(h.controller).editor, 'create'); assert.equal(h.calls.filter(c => c.init.method === 'POST').length, 1);
});
test('stale Trip A list/detail/catalog/save cannot repopulate Trip B after switching', async () => {
  for (const kind of ['list', 'detail', 'catalog', 'save']) {
    const delayed = deferred<Response>(); let delay = false;
    const h = setup((p, init) => delay && (kind === 'list' && p.includes(`/trips/${id(3)}/visits?`) || kind === 'detail' && p === `/api/v1/visits/${id(8)}` || kind === 'catalog' && p.startsWith('/api/v1/places?') || kind === 'save' && init.method === 'POST') ? delayed.promise : undefined);
    await creating(h); delay = true;
    const old = kind === 'list' ? h.controller.loadVisits() : kind === 'detail' ? h.controller.selectVisit(id(8)) : kind === 'catalog' ? h.controller.searchPlaces('USA', 'old') : h.controller.saveVisit(input);
    await tick(); await h.controller.navigate(`/app/trips/${id(5)}`);
    delayed.resolve(Response.json(kind === 'list' ? page([visit()]) : kind === 'catalog' ? page([place(102)]) : visit())); await old;
    const current = scope(h.controller); assert.equal(current.trip.id, id(5)); assert.equal(current.selection.status, 'none'); assert.equal(current.catalog.status, 'idle');
    assert.doesNotMatch(html(h.controller), /Synthetic Visit 8|Visit created/);
  }
});
test('401 from catalog/list/details/save expires session and discards all private state', async () => {
  for (const kind of ['catalog', 'list', 'detail', 'save']) {
    let deny = false; const h = setup((p, init) => deny && (kind === 'catalog' && p.startsWith('/api/v1/places?') || kind === 'list' && p.includes('/visits?') || kind === 'detail' && p.includes('/api/v1/visits/') || kind === 'save' && init.method === 'POST') ? failure(401) : undefined);
    await creating(h); deny = true;
    if (kind === 'catalog') await h.controller.searchPlaces('USA', 'x'); else if (kind === 'list') await h.controller.loadVisits(); else if (kind === 'detail') await h.controller.selectVisit(id(8)); else await h.controller.saveVisit(input);
    assert.equal(h.controller.getSnapshot().phase, 'anonymous'); assert.doesNotMatch(html(h.controller), /Synthetic Visit|catalog-place|visit-name/);
  }
});
for (const kind of ['network', '503']) test(`${kind} during Visit read hides private data without claiming expiration`, async () => {
  const h = setup(p => { if (p.includes('/visits?')) { if (kind === 'network') throw new Error('private-internal-network-detail'); return failure(503); } });
  await h.controller.verify(); assert.equal(h.controller.getSnapshot().phase, 'unavailable');
  assert.match(html(h.controller), kind === 'network' ? /Could not reach/ : /temporarily unavailable/);
  assert.doesNotMatch(html(h.controller), /You have signed out|private-internal|INTERNAL PRIVATE DETAIL/);
});
test('Trip refresh/History navigation resets Visit selection/editor and reauthorizes the list', async () => {
  const h = setup(); await h.controller.verify(); await h.controller.selectVisit(id(8)); h.controller.openVisitEditor('edit');
  h.setPath(`/app/trips/${id(5)}`); await h.controller.verify(); assert.equal(scope(h.controller).selection.status, 'none');
  h.setPath(`/app/trips/${id(3)}`); await h.controller.verify(); assert.equal(scope(h.controller).editor, 'closed');
  assert.match(html(h.controller), /Synthetic Visit 8/); assert.doesNotMatch(html(h.controller), /Visit details|Save Visit changes/);
});
test('Visit form is labelled, bounded, explicit and offers no description, GPS, media or lifecycle controls', async () => {
  const h = setup(); await creating(h); const view = html(h.controller);
  for (const field of ['visit-country', 'visit-place-query', 'visit-name', 'visit-date-mode']) { assert.ok(view.includes(`for="${field}"`)); assert.ok(view.includes(`id="${field}"`)); }
  assert.match(view, /Create Visit|No date|Single date|inclusive|GeoNames/);
  assert.doesNotMatch(view, /type="file"|visit-description|confirmedCoordinates|photoCount|input[^>]+(?:latitude|longitude)|Delete Visit|Restore Visit|synthetic-csrf-visits/);
});
