import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calendar, canonicalDate, dateLabel, visitForm } from '../src/private/visits/forms.ts';
import type { Place } from '../src/api/contracts.ts';
const place: Place = { id: '00000000-0000-4000-8000-000000000100', city: 'Synthetic', region: null, countryCode: 'COL', countryName: 'Colombia', createdAt: '2026-11-07T00:00:00Z', approximateCoordinates: null, source: { id: null, provider: null, url: null } };
test('Gregorian leap years including century exceptions', () => {
  for (const day of ['2024-02-29', '2000-02-29', '0004-02-29', '2400-02-29']) assert.ok(calendar(day));
  for (const day of ['2025-02-29', '1900-02-29', '2100-02-29']) assert.ok(!calendar(day));
});
test('calendar boundaries reject normalization, timestamps and invalid/unsupported dates', () => {
  for (const day of ['0001-01-01', '0099-12-31', '9999-12-31']) assert.ok(calendar(day));
  for (const day of ['', '0000-01-01', '10000-01-01', '2026-00-01', '2026-13-01', '2026-01-00', '2026-01-32', '2026-04-31', '2026-2-01', '2026-01-01T00:00:00Z', ' 2026-01-01']) assert.ok(!calendar(day), day);
});
test('none mode emits null boundaries even after date controls were previously filled', () => {
  assert.deepEqual(canonicalDate('none', '2024-02-29', '2025-02-30'), { mode: 'none', start: null, end: null });
});
test('single mode repeats the exact calendar string; ranges preserve inclusive equal boundaries', () => {
  assert.deepEqual(canonicalDate('single', '2024-02-29', ''), { mode: 'single', start: '2024-02-29', end: '2024-02-29' });
  assert.deepEqual(canonicalDate('range', '2024-02-29', '2024-02-29'), { mode: 'range', start: '2024-02-29', end: '2024-02-29' });
});
test('range requires both valid boundaries in order; unknown modes fail closed', () => {
  for (const [mode, start, end] of [['range', '2024-03-01', '2024-02-29'], ['range', '', '2024-02-29'], ['range', '2024-02-29', ''], ['range', '2024-02-29', '2024-02-30'], ['single', '', ''], ['invented', '2024-01-01', '2024-01-01']]) assert.equal(canonicalDate(mode, start, end), undefined);
});
test(`calendar JSON/form/display round trip is stable (TZ=${process.env.TZ ?? 'host'})`, () => {
  for (const day of ['0001-01-01', '0099-12-31', '2024-02-29', '2026-01-01', '9999-12-31']) {
    const result = visitForm({ place, name: '', mode: 'single', start: day, end: '' }).value!;
    const decoded = JSON.parse(JSON.stringify(result));
    assert.equal(decoded.date.start, day); assert.equal(decoded.date.end, day); assert.equal(dateLabel(decoded.date), day);
  }
});
test('date labels display canonical strings without timezone conversion', () => {
  assert.equal(dateLabel({ mode: 'none', start: null, end: null }), 'No date');
  assert.equal(dateLabel({ mode: 'range', start: '2024-02-29', end: '2024-03-01' }), '2024-02-29 – 2024-03-01 (inclusive)');
});
test('Visit form constructs only catalog ID/name/date and validates names/Place selection', () => {
  assert.deepEqual(visitForm({ place, name: '  Memory  ', mode: 'none', start: '', end: '' }).value, { placeId: place.id, name: 'Memory', date: { mode: 'none', start: null, end: null } });
  assert.ok(visitForm({ place, name: '😀'.repeat(200), mode: 'none', start: '', end: '' }).value);
  for (const name of ['x'.repeat(201), 'bad\nname', '\0', '\ud800']) assert.ok(visitForm({ place, name, mode: 'none', start: '', end: '' }).errors.name);
  assert.ok(visitForm({ place: null, name: '', mode: 'none', start: '', end: '' }).errors.place);
  assert.ok(visitForm({ place: { ...place, id: 'invented' }, name: '', mode: 'none', start: '', end: '' }).errors.place);
});
