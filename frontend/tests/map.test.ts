import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createApiClient } from '../src/api/client.ts';
import { AppController } from '../src/private/controller.ts';
import AppView from '../src/private/AppView.tsx';
import { adaptMarker, emptyFilters, groupVisits, matchesProjection, mergeMapVisits, validateFilters } from '../src/private/map/model.ts';
import type { MapVisit } from '../src/private/map/model.ts';
import type { MapMarker } from '../src/api/generated.ts';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const time = '2026-11-07T00:00:00Z';
const me = { id: id(1), displayName: 'Synthetic', email: null, csrfToken: 'synthetic-map-csrf', storage: { usedBytes: 0, reservedBytes: 0, quotaBytes: 500000000 } };
const project = (n = 2) => ({ id: id(n), ownerUserId: id(1), name: `Map Project ${n}`, tripCreationPolicy: 'admins_only', status: 'active', createdAt: time });
const trip = (n = 3) => ({ id: id(n), projectId: id(n === 5 ? 4 : 2), createdByUserId: id(1), name: `Map Trip ${n}`, description: null, status: 'active', createdAt: time, updatedAt: time });
function marker(n = 8, tripId = 3): MapMarker {
  return { visitId: id(n), tripId: id(tripId), place: { id: id(100), countryCode: 'COL', countryName: 'Colombia', city: 'Synthetic locality', region: null, approximateCoordinates: { lat: 4.61, lng: -74.08 }, source: { id: null, provider: null, url: null }, createdAt: time }, date: { mode: 'none', start: null, end: null }, confirmedCoordinates: null, photoCount: 0, previewPhotoId: null, createdAt: time };
}
const visit = (n = 8, tripId = 3) => ({ id: id(n), tripId: id(tripId), placeId: id(100), place: marker().place, name: `Map Visit ${n}`, createdByUserId: id(1), date: marker().date, status: 'active', confirmedCoordinates: null, photoCount: 0, previewPhotoId: null, createdAt: time, updatedAt: time });
const page = (items: unknown[] = [], nextCursor: string | null = null) => ({ items, nextCursor });
const failure = (status: number) => Response.json({ error: { code: ({ 400: 'VALIDATION_ERROR', 401: 'SESSION_REQUIRED', 403: 'ACTION_FORBIDDEN', 404: 'RESOURCE_NOT_FOUND', 409: 'OPERATION_CONFLICT', 429: 'RATE_LIMITED', 503: 'DEPENDENCY_UNAVAILABLE' } as Record<number, string>)[status], message: 'PRIVATE NEVER DISPLAY', requestId: id(90) } }, { status });
type Handler = (path: string, init: RequestInit) => Response | Promise<Response> | undefined;
function setup(path = `/app/trips/${id(3)}`, handler: Handler = () => undefined) {
  const calls: { path: string; init: RequestInit }[] = [];
  const controller = new AppController(createApiClient((async (input, options) => {
    const p = String(input), init = options!; calls.push({ path: p, init });
    const response = await handler(p, init); if (response) return response;
    if (p === '/api/v1/me') return Response.json(me);
    if (p.startsWith('/api/v1/projects?')) return Response.json(page([project(), project(4)]));
    if (/\/map\?/.test(p)) return Response.json(page([marker(p.includes(id(5)) || p.includes(id(4)) ? 9 : 8, p.includes(id(5)) || p.includes(id(4)) ? 5 : 3)]));
    if (/\/visits\?/.test(p)) return Response.json(page());
    if (/\/trips\?/.test(p)) return Response.json(page([trip(), trip(6)]));
    if (/^\/api\/v1\/projects\/[^/]+$/.test(p)) return Response.json(project(Number(p.slice(-12))));
    if (/^\/api\/v1\/trips\/[^/]+$/.test(p)) return Response.json(trip(Number(p.slice(-12))));
    if (/^\/api\/v1\/visits\/[^/]+$/.test(p)) return Response.json(visit(Number(p.slice(-12)), Number(p.slice(-12)) === 9 ? 5 : 3));
    if (p === '/api/v1/auth/logout') return new Response(null, { status: 204 });
    throw new Error('Unplanned synthetic map request');
  }) as typeof fetch), { read: () => path, go: target => { path = target; }, subscribe: () => () => undefined });
  return { controller, calls, setPath: (value: string) => { path = value; } };
}
function ready(controller: AppController) { const state = controller.getSnapshot(); if (state.phase !== 'ready') throw new Error('Not ready'); return state; }
function map(controller: AppController) { const value = ready(controller).map; if (value.status !== 'ready') throw new Error('Map not ready'); return value; }
function html(controller: AppController) { return renderToStaticMarkup(createElement(AppView, { state: controller.getSnapshot(), actions: controller, onLogin: () => undefined })); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
const tick = () => new Promise<void>(done => setImmediate(done));
const pixel = (point: [number, number, number?]) => ({ x: point[1] * 100, y: point[0] * 100 });

test('adapter separates DTOs from Leaflet presentation and uses latitude-longitude order', () => {
  const source = marker(); const result = adaptMarker({ ...source, place: { ...source.place, approximateCoordinates: { lat: 12.34, lng: -56.78 } } });
  assert.deepEqual(result.position, [12.34, -56.78]); assert.equal(result.visitId, source.visitId); assert.equal(result.tripId, source.tripId); assert.equal(result.placeId, source.place.id);
  assert.ok(!('confirmedCoordinates' in result)); assert.ok(!('photoCount' in result)); assert.ok(!('source' in result));
});
test('missing coordinates remain unlocated while missing required fields fail closed', () => {
  const source = marker(); const unlocated = adaptMarker({ ...source, place: { ...source.place, approximateCoordinates: null } });
  assert.equal(unlocated.position, null); assert.deepEqual(groupVisits([unlocated], pixel), []);
  const { approximateCoordinates: unused, ...place } = source.place; void unused;
  assert.throws(() => adaptMarker({ ...source, place }));
});
test('invalid, unpaired, nonfinite and out-of-range points never become markers', () => {
  for (const point of [{ lat: NaN, lng: 0 }, { lat: Infinity, lng: 0 }, { lat: 0, lng: -Infinity }, { lat: 91, lng: 0 }, { lat: 0, lng: -181 }, { lat: 0 }, { lng: 0 }, { lat: '1', lng: 1 }]) assert.throws(() => adaptMarker({ ...marker(), place: { ...marker().place, approximateCoordinates: point } }));
  assert.deepEqual(adaptMarker({ ...marker(), place: { ...marker().place, approximateCoordinates: { lat: -90, lng: 180 } } }).position, [-90, 180]);
});
test('precise Visit coordinates and malformed dates/identity cannot enter presentation state', () => {
  assert.throws(() => adaptMarker({ ...marker(), confirmedCoordinates: { lat: 1, lng: 1 } }));
  assert.throws(() => adaptMarker({ ...marker(), visitId: 'invented' }));
  assert.throws(() => adaptMarker({ ...marker(), date: { mode: 'single', start: '2025-02-29', end: '2025-02-29' } }));
});
test('same Place across Trips remains independent in a deterministic coordinate group', () => {
  const visits = [adaptMarker(marker(10, 6)), adaptMarker(marker(8)), adaptMarker(marker(9))];
  const groups = groupVisits(visits, pixel); assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].visits.map(v => v.visitId), [id(8), id(9), id(10)]);
  assert.deepEqual(groups[0].position, visits[1].position); assert.equal(groups[0].visits[2].tripId, id(6));
  assert.deepEqual(groupVisits([...visits].reverse(), pixel), groups);
});
test('nearby screen-space positions group without centroid/jitter and separate at higher zoom', () => {
  const a = adaptMarker(marker()), b: MapVisit = { ...adaptMarker(marker(9)), position: [4.62, -74.08] };
  const low = groupVisits([a, b], pixel); assert.equal(low.length, 1); assert.deepEqual(low[0].position, a.position);
  assert.equal(groupVisits([a, b], p => ({ x: p[1] * 10000, y: p[0] * 10000 })).length, 2);
});
test('date-line and signed-zero positions do not invent duplicate spatial identities', () => {
  const a: MapVisit = { ...adaptMarker(marker()), position: [0, -180] }, b: MapVisit = { ...adaptMarker(marker(9)), position: [0, 180] };
  assert.equal(groupVisits([a, b], p => ({ x: p[1], y: p[0] }), 360).length, 1);
  assert.deepEqual(adaptMarker({ ...marker(), place: { ...marker().place, approximateCoordinates: { lat: -0, lng: -0 } } }).position, [0, 0]);
});
test('page merging deduplicates by Visit, never by Place; conflicting ancestry is rejected', () => {
  const a = adaptMarker(marker()), b = adaptMarker(marker(9));
  assert.equal(mergeMapVisits([a], [a, b]).length, 2);
  assert.throws(() => mergeMapVisits([a], [{ ...a, tripId: id(5) }]));
});
test('local 100-Visit adaptation/grouping preserves all identities without a browser performance claim', context => {
  const started = performance.now();
  const items = Array.from({ length: 100 }, (_, i) => adaptMarker({ ...marker(1000 + i, i % 2 ? 3 : 6), place: { ...marker().place, id: id(100 + i % 6), approximateCoordinates: { lat: 4 + i % 6, lng: -74 } } }));
  const groups = groupVisits(items, pixel);
  assert.equal(groups.flatMap(g => g.visits).length, 100); assert.equal(new Set(groups.flatMap(g => g.visits.map(v => v.visitId))).size, 100);
  context.diagnostic(`100 synthetic Visits: ${(performance.now() - started).toFixed(2)} ms in local Node (not Leaflet/browser/4G NFR evidence).`);
});
for (const kind of ['project', 'trip'] as const) test(`${kind} map loads only its authorized endpoint with bounded first page`, async () => {
  const h = setup(`/app/${kind === 'project' ? 'projects' : 'trips'}/${id(kind === 'project' ? 2 : 3)}`); await h.controller.verify();
  const data = map(h.controller); assert.equal(data.scope.kind, kind); assert.equal(data.visits.length, 1);
  const calls = h.calls.filter(c => c.path.includes('/map?')); assert.equal(calls.length, 1); assert.equal(new URL(calls[0].path, 'https://local.invalid').searchParams.get('limit'), '100');
  assert.equal(calls[0].init.credentials, 'same-origin');
});
test('home has no all-Projects map query or invented projection', async () => {
  const h = setup('/app'); await h.controller.verify(); assert.equal(ready(h.controller).map.status, 'idle'); assert.ok(!h.calls.some(c => c.path.includes('/map')));
});
test('empty map and unlocated Visits remain truthful and selectable through accessible controls', async () => {
  const empty = setup(undefined, p => p.includes('/map?') ? Response.json(page()) : undefined); await empty.controller.verify(); assert.match(html(empty.controller), /No matching Visits/);
  const h = setup(undefined, p => p.includes('/map?') ? Response.json(page([{ ...marker(), place: { ...marker().place, approximateCoordinates: null } }])) : undefined);
  await h.controller.verify(); assert.match(html(h.controller), /1 without catalog coordinates|coordinates unavailable/);
  await h.controller.openMapVisit(id(8)); const scope = ready(h.controller).scope; assert.ok(scope.status === 'trip' && scope.selection.status === 'ready');
  assert.equal(map(h.controller).camera, undefined);
});
test('group click reveals each Visit without automatically choosing one or fetching details', async () => {
  const h = setup(undefined, p => p.includes('/map?') ? Response.json(page([marker(), marker(10)])) : undefined);
  await h.controller.verify(); const before = h.calls.length; h.controller.showMapGroup([id(8), id(10)]);
  assert.equal(h.calls.length, before); assert.deepEqual(map(h.controller).groupIds, [id(8), id(10)]);
  assert.match(html(h.controller), /Choose a Visit — 2 selected/);
  await h.controller.openMapVisit(id(10)); const scope = ready(h.controller).scope;
  assert.ok(scope.status === 'trip' && scope.selection.status === 'ready' && scope.selection.visit.id === id(10));
});
test('a Trip map Visit beyond the loaded E3.3 page opens without scanning Visit pages', async () => {
  const h = setup(); await h.controller.verify(); await h.controller.openMapVisit(id(8));
  assert.equal(h.calls.filter(c => c.path.includes('/visits?')).length, 1);
  assert.equal(h.calls.filter(c => c.path === `/api/v1/visits/${id(8)}`).length, 1);
  assert.equal(map(h.controller).selectedVisitId, id(8));
});
test('Project marker verifies Trip and actor then opens beyond both loaded Trip map/list pages', async () => {
  const h = setup(`/app/projects/${id(2)}`, p => p.includes(`/trips/${id(3)}/map?`) ? Response.json(page([], 'more-trip-map')) : undefined);
  await h.controller.verify(); await h.controller.openMapVisit(id(8));
  assert.equal(ready(h.controller).route.kind, 'trip');
  const scope = ready(h.controller).scope; assert.ok(scope.status === 'trip' && scope.selection.status === 'ready');
  assert.equal(h.calls.filter(c => c.path.includes('/visits?')).length, 1);
  assert.equal(h.calls.filter(c => c.path.includes(`/trips/${id(3)}/map?`)).length, 1);
  assert.match(html(h.controller), /selected Visit is outside the loaded map results/);
});
test('unproven Visit IDs never become direct requests', async () => {
  const h = setup(); await h.controller.verify(); const before = h.calls.length;
  await h.controller.openMapVisit(id(999)); await h.controller.selectVisit(id(999)); h.controller.showMapGroup([id(999)]);
  assert.equal(h.calls.length, before); assert.deepEqual(map(h.controller).groupIds, []);
});
test('malformed Project map ancestry cannot open a Visit in another Project', async () => {
  const h = setup(`/app/projects/${id(2)}`, p => p.includes(`/projects/${id(2)}/map?`) ? Response.json(page([marker(9, 5)])) : undefined);
  await h.controller.verify(); await h.controller.openMapVisit(id(9));
  assert.ok(!h.calls.some(c => c.path === `/api/v1/visits/${id(9)}`));
});
test('fresh Visit endpoint ancestry is checked even with valid map provenance', async () => {
  const h = setup(undefined, p => p === `/api/v1/visits/${id(8)}` ? Response.json(visit(8, 5)) : undefined);
  await h.controller.verify(); await h.controller.openMapVisit(id(8)); assert.equal(h.controller.getSnapshot().phase, 'unavailable');
});
test('Project marker navigation intent is discarded when the verified account changes', async () => {
  let actor = 1;
  const h = setup(`/app/projects/${id(2)}`, p => p === '/api/v1/me' ? Response.json({ ...me, id: id(actor) }) : undefined);
  await h.controller.verify(); actor = 99; await h.controller.openMapVisit(id(8));
  assert.equal(ready(h.controller).user.id, id(99));
  assert.ok(!h.calls.some(c => c.path === `/api/v1/visits/${id(8)}`));
});
test('a newer navigation cancels the one-use Project marker detail intent', async () => {
  const delayed = deferred<Response>();
  const h = setup(`/app/projects/${id(2)}`, p => p === `/api/v1/trips/${id(3)}` ? delayed.promise : undefined);
  await h.controller.verify(); const pending = h.controller.openMapVisit(id(8)); await tick();
  await h.controller.navigate(`/app/trips/${id(5)}`); delayed.resolve(Response.json(trip())); await pending;
  assert.equal(map(h.controller).scope.id, id(5));
  assert.ok(!h.calls.some(c => c.path === `/api/v1/visits/${id(8)}`));
});
for (const status of [403, 404]) test(`live Visit ${status} after marker selection discards the previous map proof`, async () => {
  const h = setup(undefined, p => p === `/api/v1/visits/${id(8)}` ? failure(status) : undefined);
  await h.controller.verify(); await h.controller.openMapVisit(id(8));
  const state = ready(h.controller); assert.equal(state.map.status, 'idle'); assert.equal(state.scope.status, 'error');
  assert.doesNotMatch(html(h.controller), /Synthetic locality|Map Visit|PRIVATE NEVER DISPLAY/);
});
test('Trip-only Guest loads no parent/sibling/roster/Project-map requests or Trip filter', async () => {
  const h = setup(undefined, p => p.startsWith('/api/v1/projects?') ? Response.json(page()) : undefined);
  await h.controller.verify(); await h.controller.openMapVisit(id(8));
  assert.ok(!h.calls.some(c => /\/projects\/|\/members|\/invitations/.test(c.path)));
  assert.doesNotMatch(html(h.controller), /map-trip|All authorized Project Trips|Map Project/);
});
test('country and Project Trip filters are sent to SQL endpoints and reset uses no stale cursor', async () => {
  const h = setup(`/app/projects/${id(2)}`); await h.controller.verify();
  await h.controller.loadMap(false, { ...emptyFilters, countryCode: ' col ', tripId: id(3) });
  const url = new URL(h.calls.at(-1)!.path, 'https://local.invalid'); assert.equal(url.searchParams.get('countryCode'), 'COL'); assert.equal(url.searchParams.get('tripId'), id(3));
  await h.controller.loadMap(false, emptyFilters); const reset = new URL(h.calls.at(-1)!.path, 'https://local.invalid'); assert.equal(reset.searchParams.get('countryCode'), null); assert.equal(reset.searchParams.get('cursor'), null);
});
test('invalid country, Trip-only Trip filters, reversed/invalid dates fail before any map request', async () => {
  const h = setup(); await h.controller.verify(); const before = h.calls.length;
  for (const filters of [{ ...emptyFilters, countryCode: 'CO' }, { ...emptyFilters, tripId: id(3) }, { ...emptyFilters, from: '2025-02-29' }, { ...emptyFilters, from: '2024-03-01', to: '2024-02-29' }]) await h.controller.loadMap(false, filters);
  assert.equal(h.calls.length, before); assert.equal(ready(h.controller).map.status, 'error');
});
test('calendar overlap defense is inclusive and undated data is accepted only without date bounds', () => {
  const row = adaptMarker({ ...marker(), date: { mode: 'range', start: '2024-02-29', end: '2024-03-01' } });
  const scope = { kind: 'trip' as const, id: id(3) };
  for (const filters of [{ ...emptyFilters, from: '2024-03-01' }, { ...emptyFilters, to: '2024-02-29' }, { ...emptyFilters, from: '2024-03-01', to: '2024-03-01' }]) assert.ok(matchesProjection(row, scope, filters));
  assert.ok(!matchesProjection(row, scope, { ...emptyFilters, from: '2024-03-02' }));
  assert.ok(matchesProjection(adaptMarker(marker()), scope, emptyFilters)); assert.ok(!matchesProjection(adaptMarker(marker()), scope, { ...emptyFilters, to: '2024-03-01' }));
  assert.ok(validateFilters({ ...emptyFilters, to: '2024-02-29' }, 'trip').value);
});
for (const side of ['from', 'to'] as const) test(`one-sided ${side} query uses server-filtered data, not a local filtered cache`, async () => {
  const row = { ...marker(), date: { mode: 'single', start: '2024-02-29', end: '2024-02-29' } };
  const h = setup(undefined, p => p.includes('/map?') ? Response.json(page(new URL(p, 'https://local.invalid').searchParams.has(side) ? [row] : [marker(), row])) : undefined);
  await h.controller.verify(); await h.controller.loadMap(false, { ...emptyFilters, [side]: '2024-02-29' });
  assert.equal(map(h.controller).visits.length, 1); assert.equal(new URL(h.calls.at(-1)!.path, 'https://local.invalid').searchParams.get(side), '2024-02-29');
});
test('a contradictory filtered response fails closed rather than hiding unauthorized or unmatching data locally', async () => {
  const h = setup(); await h.controller.verify(); await h.controller.loadMap(false, { ...emptyFilters, from: '2024-02-29' });
  assert.equal(h.controller.getSnapshot().phase, 'unavailable');
});
test('map pagination is explicit, opaque, deduplicated and groups are based only on loaded pages', async () => {
  const h = setup(undefined, p => p.includes('/map?') ? Response.json(p.includes('cursor=') ? page([marker(), marker(10)]) : page([marker()], 'opaque+map/=')) : undefined);
  await h.controller.verify(); assert.equal(h.calls.filter(c => c.path.includes('/map?')).length, 1);
  assert.match(html(h.controller), /More results remain unloaded/); await h.controller.loadMap(true);
  assert.deepEqual(map(h.controller).visits.map(v => v.visitId), [id(8), id(10)]);
  assert.equal(new URL(h.calls.at(-1)!.path, 'https://local.invalid').searchParams.get('cursor'), 'opaque+map/=');
  assert.equal(groupVisits(map(h.controller).visits, pixel)[0].visits.length, 2);
});
test('first 100-Visit response does not trigger an automatic next-page loop', async () => {
  const h = setup(undefined, p => p.includes('/map?') ? Response.json(page(Array.from({ length: 100 }, (_, i) => marker(1000 + i)), 'more')) : undefined);
  await h.controller.verify(); assert.equal(map(h.controller).visits.length, 100); assert.equal(h.calls.filter(c => c.path.includes('/map?')).length, 1);
});
test('stale filter response and previous cursor cannot overwrite a newer filter', async () => {
  const old = deferred<Response>(); let delaying = false;
  const h = setup(undefined, p => p.includes('/map?') && delaying ? p.includes('countryCode=COL') ? old.promise : Response.json(page()) : undefined);
  await h.controller.verify(); delaying = true;
  const pending = h.controller.loadMap(false, { ...emptyFilters, countryCode: 'COL' }); await tick();
  await h.controller.loadMap(false, { ...emptyFilters, countryCode: 'USA' }); old.resolve(Response.json(page([marker()], 'old-cursor'))); await pending;
  assert.equal(map(h.controller).filters.countryCode, 'USA'); assert.equal(map(h.controller).visits.length, 0); assert.equal(map(h.controller).nextCursor, null);
  assert.ok(h.calls.find(c => c.path.includes('countryCode=COL'))?.init.signal?.aborted);
});
for (const kind of ['projects', 'trips']) test(`rapid ${kind} switching cannot restore old markers`, async () => {
  const old = deferred<Response>(); const first = id(kind === 'projects' ? 2 : 3), second = id(kind === 'projects' ? 4 : 5);
  const h = setup(`/app/${kind}/${first}`, p => p.includes(`/${kind}/${first}/map?`) ? old.promise : undefined);
  const initial = h.controller.verify(); await tick(); await h.controller.navigate(`/app/${kind}/${second}`); old.resolve(Response.json(page([marker()]))); await initial;
  assert.equal(map(h.controller).scope.id, second); assert.deepEqual(map(h.controller).visits.map(v => v.visitId), [id(9)]);
});
for (const status of [401, 403, 404, 503]) test(`map ${status} clears affected private data and preserves safe session semantics`, async () => {
  let denied = false;
  const h = setup(undefined, p => p.includes('/map?') && denied ? failure(status) : undefined);
  await h.controller.verify(); denied = true; await h.controller.loadMap();
  const state = h.controller.getSnapshot();
  if (status === 401) assert.equal(state.phase, 'anonymous');
  else if (status === 503) assert.equal(state.phase, 'unavailable');
  else assert.ok(state.phase === 'ready' && state.map.status === 'idle' && state.scope.status === 'error');
  assert.doesNotMatch(html(h.controller), /Synthetic locality|Map Visit|PRIVATE NEVER DISPLAY|You have signed out/);
});
for (const status of [400, 429]) test(`map ${status} presents a recoverable error without retaining markers or raw server messages`, async () => {
  let denied = false;
  const h = setup(undefined, p => p.includes('/map?') && denied ? failure(status) : undefined);
  await h.controller.verify(); denied = true; await h.controller.loadMap();
  assert.equal(ready(h.controller).map.status, 'error'); assert.match(html(h.controller), /Retry map/);
  assert.doesNotMatch(html(h.controller), /Synthetic locality|PRIVATE NEVER DISPLAY/);
  denied = false; await h.controller.loadMap(); assert.equal(map(h.controller).visits.length, 1);
});
test('network failure hides the projection and does not claim logout', async () => {
  const h = setup(undefined, p => { if (p.includes('/map?')) throw new Error('postgresql://synthetic-secret'); });
  await h.controller.verify(); assert.equal(h.controller.getSnapshot().phase, 'unavailable'); assert.match(html(h.controller), /Could not reach/); assert.doesNotMatch(html(h.controller), /synthetic-secret|signed out/);
});
test('scope/country contradictions and unauthorized map Trip filters fail safely', async () => {
  const foreign = setup(undefined, p => p.includes('/map?') ? Response.json(page([marker(9, 5)])) : undefined);
  await foreign.controller.verify(); assert.equal(foreign.controller.getSnapshot().phase, 'unavailable');
  const h = setup(`/app/projects/${id(2)}`, p => p.includes('tripId=') ? failure(404) : undefined);
  await h.controller.verify(); await h.controller.loadMap(false, { ...emptyFilters, tripId: id(999) }); assert.ok(ready(h.controller).scope.status === 'error');
});
test('suspension/logout/account replacement and unmount cannot resurrect an in-flight map', async () => {
  for (const action of ['suspend', 'logout', 'dispose', 'account']) {
    const delayed = deferred<Response>(); let delaying = false, actor = 1;
    const h = setup(undefined, p => p === '/api/v1/me' ? Response.json({ ...me, id: id(actor) }) : p.includes('/map?') && delaying ? delayed.promise : undefined);
    await h.controller.verify(); delaying = true; const pending = h.controller.loadMap(); await tick();
    if (action === 'suspend') h.controller.suspend(); else if (action === 'logout') await h.controller.logout(); else if (action === 'dispose') h.controller.dispose(); else { delaying = false; actor = 99; await h.controller.verify(); }
    delayed.resolve(Response.json(page([marker(777)]))); await pending;
    assert.ok(!JSON.stringify(h.controller.getSnapshot()).includes(id(777)));
    if (action === 'account') assert.equal(ready(h.controller).user.id, id(99));
  }
});
test('History refresh drops selection and reloads the correct scope with no private-data persistence', async () => {
  const h = setup(); await h.controller.verify(); h.controller.showMapGroup([id(8)]);
  h.setPath(`/app/projects/${id(2)}`); await h.controller.verify(); assert.equal(map(h.controller).scope.kind, 'project');
  h.setPath(`/app/trips/${id(3)}`); await h.controller.verify(); assert.equal(map(h.controller).scope.kind, 'trip'); assert.deepEqual(map(h.controller).groupIds, []);
});
test('camera commands are explicit and pagination/access refresh do not reuse stale commands', async () => {
  const h = setup(); await h.controller.verify(); assert.equal(map(h.controller).camera, undefined);
  h.controller.fitMap(); const fit = map(h.controller).camera!; assert.equal(fit.kind, 'fit');
  h.controller.showMapGroup([id(8)]); assert.equal(map(h.controller).camera?.kind, 'point');
  await h.controller.verify(); assert.equal(map(h.controller).camera, undefined);
});
test('filter controls and equivalent Visit choices are labelled and contain no private media or guessed context', async () => {
  const h = setup(`/app/projects/${id(2)}`); await h.controller.verify(); const view = html(h.controller);
  for (const field of ['map-country', 'map-trip', 'map-from', 'map-to']) { assert.ok(view.includes(`for="${field}"`)); assert.ok(view.includes(`id="${field}"`)); }
  assert.match(view, /Browse loaded map Visits|Reset map filters|Approximate catalog locations/);
  assert.doesNotMatch(view, /synthetic-map-csrf|photoCount|previewPhotoId|images\/|PRIVATE NEVER DISPLAY/);
});
