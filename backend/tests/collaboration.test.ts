import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { collaborationInput } from '../src/modules/collaboration/validation.ts';
import { PostgresRepository } from '../src/infrastructure/postgres.ts';
import type { JsonObject } from '../src/infrastructure/postgres.ts';
const request = (body: unknown) => new Request('https://example.invalid', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
test('E2.3 partial settings preserve unspecified values and reject privileged fields', async () => {
  assert.deepEqual(await collaborationInput(request({ name: '  Trip 🌍  ' }), true), { name: 'Trip 🌍' });
  assert.deepEqual(await collaborationInput(request({ tripCreationPolicy: 'all_project_members' }), true), { tripCreationPolicy: 'all_project_members' });
  for (const value of [null, [], {}, { name: null }, { name: 2 }, { name: ' ' }, { name: '\ud800' }, { name: 'a\nb' }, { name: 'a'.repeat(201) }, { tripCreationPolicy: null }, { tripCreationPolicy: 'anyone' }, { name: 'x'.repeat(5000) }]) await assert.rejects(collaborationInput(request(value), true), { status: 400 });
  for (const key of ['ownerUserId', 'createdByUserId', 'role', 'status', 'archivedAt', 'userId', 'id', 'memberships']) await assert.rejects(collaborationInput(request({ name: 'x', [key]: 'forged' }), true), { status: 400 });
});
test('E2.3 dedicated actions reject caller-selected roles/actors and malformed bodies', async () => {
  assert.deepEqual(await collaborationInput(new Request('https://example.invalid', { method: 'POST' }), false), {});
  assert.deepEqual(await collaborationInput(request({}), false), {});
  assert.deepEqual(await collaborationInput(new Request('https://example.invalid', { method: 'POST', body: '' }), false), {});
  for (const value of [{ role: 'admin' }, { actorId: 'x' }, [], null]) await assert.rejects(collaborationInput(request(value), false), { status: 400 });
  await assert.rejects(collaborationInput(new Request('https://example.invalid', { method: 'PATCH', body: '{' }), true), { status: 400 });
});
test('E2.3 errors expose only static safe domain responses', async () => {
  class Stub extends PostgresRepository { value: JsonObject = {}; override async query<T>(): Promise<T> { return this.value as T; } }
  const repo = new Stub('postgresql://unused');
  for (const [error, status] of Object.entries({ ACTION_FORBIDDEN: 403, VALIDATION_ERROR: 400, OPERATION_CONFLICT: 409, RESOURCE_NOT_FOUND: 404, SESSION_REQUIRED: 401, DEPENDENCY_UNAVAILABLE: 503, 'private SQL diagnostic': 404 })) {
    repo.value = { error, message: 'sensitive SQL' };
    await assert.rejects(repo.call('unused', 'collaboration.remove'), (e: unknown) => { const value = e as { status: number; message: string }; return value.status === status && !value.message.includes('sensitive'); });
  }
});
test('E2.2 migration bytes remain unchanged by E2.3', async () => {
  for (const [suffix, checksum] of [['up', '3c0899ac30ef9eee524fdca6a3f778eaac9a42dfd67d0efa3a8b1390d5688d01'], ['down', 'e7fcc4d925817d97ff7cbbb6efbacf5a881b1e815afbd1dd18add55e7d5d5ef7']]) {
    assert.equal(createHash('sha256').update(await readFile(new URL(`../migrations/0004_places_visits.${suffix}.sql`, import.meta.url))).digest('hex'), checksum);
  }
});
