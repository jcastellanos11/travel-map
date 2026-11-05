import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { calendar, geographyQuery, visitDate, visitInput } from '../src/modules/geography/validation.ts';
import { geographyRoute } from '../src/modules/geography/routes.ts';
import type { IdentityRepository } from '../src/infrastructure/postgres.ts';
const input = (data: unknown) => new Request('https://app.example.invalid', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
test('calendar validation rejects normalization and preserves explicit calendar semantics', () => {
  for (const value of ['2024-02-29', '2000-02-29', '0001-01-01', '9999-12-31']) assert.ok(calendar(value));
  for (const value of ['1900-02-29', '2025-02-29', '2024-04-31', '2026-00-01', '2026-13-01', '0000-01-01', '2026-1-01', '2026-01-01T00:00:00Z', '', null]) assert.equal(calendar(value), false);
  assert.ok(visitDate({ mode: 'none', start: null, end: null }));
  assert.ok(visitDate({ mode: 'single', start: '2024-02-29', end: '2024-02-29' }));
  assert.ok(visitDate({ mode: 'range', start: '2024-02-29', end: '2024-03-01' }));
  for (const value of [null, {}, [], { mode: 'none', start: null }, { mode: 'none', start: '2024-01-01', end: null }, { mode: 'single', start: '2024-01-01', end: null }, { mode: 'range', start: '2024-03-01', end: '2024-02-29' }, { mode: 'single', start: '2024-03-01', end: '2024-03-02' }]) assert.equal(visitDate(value), false);
});
test('Visit input is explicit place UUID only, strict fields, bounded JSON, no exact point consent inference', async () => {
  const placeId = randomUUID(); assert.deepEqual(await visitInput(input({ placeId, name: '  City  ' }), false), { placeId, name: 'City' });
  assert.deepEqual(await visitInput(input({ name: null }), true), { name: null });
  for (const data of [null, [], {}, { place: { city: 'Springfield' } }, { placeId: 'ambiguous' }, { placeId, name: '' }, { placeId, name: 'a'.repeat(201) }, { placeId, name: '\ud800' }, { placeId, name: 'A\nB' }, { placeId, name: '\u0000' }, { placeId, date: { mode: 'single', start: '2025-02-29', end: '2025-02-29' } }]) await assert.rejects(visitInput(input(data), false), { status: 400 });
  for (const key of ['tripId', 'projectId', 'createdByUserId', 'role', 'status', 'createdAt', 'exactCoordinates', 'latitude', 'longitude', 'description']) await assert.rejects(visitInput(input({ placeId, [key]: 'forged' }), false), { status: 400 });
  for (const point of [{ lat: 4, lng: -74 }, { lat: 91, lng: 0 }, { lat: 1 }, { lat: 0, lng: 181 }, { lat: Infinity, lng: 0 }, [0, 0], 'confirmed']) await assert.rejects(visitInput(input({ placeId, confirmedCoordinates: point }), false), { status: 400 });
  await assert.rejects(visitInput(input({}), true), { status: 400 });
  for (const body of ['{', ' '.repeat(16385)]) await assert.rejects(visitInput(new Request('https://app.example.invalid', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }), false), { status: 400 });
});
test('Places and map query validation bounds filters and rejects extra, repeated and malformed parameters', () => {
  assert.equal(geographyQuery(new URL('https://app.example.invalid?countryCode=COL&query=Bog'), 'places').data.countryCode, 'COL');
  assert.equal(geographyQuery(new URL('https://app.example.invalid?from=2024-02-29'), 'tripMap').data.from, '2024-02-29');
  for (const query of ['countryCode=CO', 'countryCode=col', 'countryCode=COL&query='+ 'a'.repeat(101), 'countryCode=COL&query=x&query=y', 'countryCode=COL&actorId=123']) assert.throws(() => geographyQuery(new URL(`https://app.example.invalid?${query}`), 'places'));
  assert.throws(() => geographyQuery(new URL('https://app.example.invalid'), 'places'));
  for (const query of ['from=2025-02-29', 'from=2026-01-02&to=2026-01-01', 'tripId=bad', 'limit=101', 'countryCode=COL&countryCode=USA', 'cursor=bad']) assert.throws(() => geographyQuery(new URL(`https://app.example.invalid?${query}`), 'projectMap'));
  assert.throws(() => geographyQuery(new URL(`https://app.example.invalid?tripId=${randomUUID()}`), 'tripMap'));
});
test('map cursors use visitId and scope fields are server supplied; deferred routes stay absent', async () => {
  const tripId = randomUUID(), visitId = randomUUID(); const calls: unknown[] = [];
  const repo = { call: async (_token: string, action: string, data: unknown) => { calls.push({ action, data }); return { items: [1, 2].map(() => ({ visitId, tripId, createdAt: '2026-01-01T00:00:00+00:00', photoCount: 0 })) }; } } as unknown as IdentityRepository;
  const response = await geographyRoute(new Request(`https://app.example.invalid/api/v1/trips/${tripId}/map?limit=1`), repo, 'opaque');
  const page = await response!.json() as { items: Record<string, unknown>[]; nextCursor: string };
  assert.equal(page.items.length, 1); assert.equal(page.items[0]!.id, undefined); assert.ok(page.nextCursor);
  assert.equal(geographyQuery(new URL(`https://app.example.invalid?cursor=${page.nextCursor}`), 'tripMap').data.cursorId, visitId);
  assert.deepEqual(calls, [{ action: 'maps.trip', data: { limit: 1, tripId } }]);
  assert.equal(await geographyRoute(new Request(`https://app.example.invalid/api/v1/visits/${visitId}`, { method: 'DELETE' }), repo, 'opaque'), null);
});
test('E2.1 migration bytes remain immutable', async () => {
  for (const [file, expected] of [['0003_trips_authorization.up.sql', 'eb25f5973b4001a507c959e97ba2e87fbf690043a6f3784e5018bd28efce6266'], ['0003_trips_authorization.down.sql', '5e2ebc7711503bdbc8ea758039bac3407d0436c1c4892a592e39ed537d96194d']]) assert.equal(createHash('sha256').update(await readFile(new URL(`../migrations/${file}`, import.meta.url))).digest('hex'), expected);
});
