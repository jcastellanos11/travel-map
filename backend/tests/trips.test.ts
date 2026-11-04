import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { tripInput } from '../src/modules/trips/validation.ts';
import { tripRoute } from '../src/modules/trips/routes.ts';
import { PostgresRepository } from '../src/infrastructure/postgres.ts';
import type { JsonObject } from '../src/infrastructure/postgres.ts';
import { HttpError } from '../src/shared/http.ts';
import { paginationQuery } from '../src/shared/pagination.ts';

function input(value: unknown, contentType = 'application/json'): Request {
  return new Request('https://api.example.invalid/api/v1/trips/synthetic', {
    method: 'PATCH', headers: { 'Content-Type': contentType }, body: JSON.stringify(value),
  });
}

test('trip text validation normalizes names and preserves optional Unicode descriptions', async () => {
  assert.deepEqual(await tripInput(input({ name: '  Journey  ' }), false), { name: 'Journey' });
  assert.deepEqual(await tripInput(input({ description: 'Line one\n🌎\tLine two' }), true), { description: 'Line one\n🌎\tLine two' });
  assert.deepEqual(await tripInput(input({ description: null }), true), { description: null });
  assert.equal((await tripInput(input({ name: '🌎'.repeat(200), description: '🌎'.repeat(2000) }), false)).name, '🌎'.repeat(200));
});

test('trip validation rejects mass assignment, malformed JSON/types and invalid text', async () => {
  const bad = [null, [], 'text', {}, { name: null }, { name: 1 }, { name: ' ' }, { name: '\n' },
    { name: 'a'.repeat(201) }, { name: 'a\nb' }, { name: '\ud800' }, { name: 'a', description: '\u0000' },
    { name: 'a', description: '\udc00' }, { name: 'a', description: [] }, { name: 'a', description: 2 },
    { name: 'a', description: 'a'.repeat(2001) }];
  for (const value of bad) await assert.rejects(tripInput(input(value), false), { status: 400 });
  for (const key of ['id', 'projectId', 'ownerId', 'ownerUserId', 'createdByUserId', 'creatorId', 'role', 'status', 'createdAt', 'archivedAt']) {
    await assert.rejects(tripInput(input({ name: 'Journey', [key]: crypto.randomUUID() }), false), { status: 400 });
    await assert.rejects(tripInput(input({ [key]: 'crafted' }), true), { status: 400 });
  }
  await assert.rejects(tripInput(input({}), true), { status: 400 });
  await assert.rejects(tripInput(input({ name: 'a' }, 'text/plain'), false), { status: 400 });
  for (const body of ['{', ' '.repeat(16385), 'null']) {
    await assert.rejects(tripInput(new Request('https://api.example.invalid', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
    }), false), { status: 400 });
  }
});

class ResultRepository extends PostgresRepository {
  readonly result: JsonObject;
  constructor(result: JsonObject) { super('unused'); this.result = result; }
  override async query<T>(): Promise<T> { return this.result as T; }
}

test('trip RPC errors use safe whitelisted outcomes while preserving E1 classification', async () => {
  for (const [code, status] of Object.entries({ SESSION_REQUIRED: 401, RESOURCE_NOT_FOUND: 404,
    ACTION_FORBIDDEN: 403, VALIDATION_ERROR: 400, OPERATION_CONFLICT: 409, DEPENDENCY_UNAVAILABLE: 503 })) {
    const repo = new ResultRepository({ error: code, message: 'private SQL detail' });
    await assert.rejects(repo.call('synthetic', 'trips.get'), error => error instanceof HttpError
      && error.status === status && !error.message.includes('private SQL detail'));
  }
  await assert.rejects(new ResultRepository({ error: 'private SQL detail' }).call('synthetic', 'trips.get'), { status: 404 });
  await assert.rejects(new ResultRepository({ error: 'ACTION_FORBIDDEN' }).call('synthetic', 'projects.get'), { status: 404 });
});

test('trip route rejects malformed identifiers and has no membership/lifecycle endpoints', async () => {
  const repository = new ResultRepository({});
  const url = 'https://api.example.invalid';
  await assert.rejects(tripRoute(new Request(`${url}/api/v1/trips/not-a-uuid`), repository, 'synthetic'), { status: 404 });
  assert.equal(await tripRoute(new Request(`${url}/api/v1/trips/${crypto.randomUUID()}/archive`, { method: 'POST' }), repository, 'synthetic'), null);
  assert.equal(await tripRoute(new Request(`${url}/api/v1/trips/${crypto.randomUUID()}/members`), repository, 'synthetic'), null);
});

test('shared pagination rejects malformed and duplicate filters without changing project behavior', () => {
  assert.equal(paginationQuery(new URL('https://api.example.invalid')).limit, 25);
  for (const query of ['limit=0', 'limit=101', 'limit=1&limit=2', 'cursor=bad', 'countryCode=COL']) {
    assert.throws(() => paginationQuery(new URL(`https://api.example.invalid?${query}`)), { status: 400 });
  }
});

test('committed E0/E1 migration bytes remain immutable', async () => {
  const expected: Record<string, string> = {
    '0001_foundation.up.sql': '57261cce6c7b80a117f90578475d52133d4e82da28852f466da5a854ca439e38',
    '0001_foundation.down.sql': '8553a47f001bc0baa563495d161da3247531b9da20f8894f32db8bb2cf21e233',
    '0002_identity.up.sql': '067272925375df072fcd1fa8d72852465cc82061280b52344dd2b51f0f9134c7',
    '0002_identity.down.sql': '8608e578cf926b79391d4f683515ff952d417df084c05f3173437471c6bb32b8',
  };
  for (const [file, hash] of Object.entries(expected)) {
    assert.equal(createHash('sha256').update(await readFile(new URL(`../migrations/${file}`, import.meta.url))).digest('hex'), hash);
  }
});
