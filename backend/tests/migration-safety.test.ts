import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadMigrations, localDatabaseUrl } from '../scripts/migrations.ts';

test('migration tooling accepts only explicitly acknowledged disposable loopback databases', () => {
  for (const url of [undefined, 'postgresql://u@cloud.example.invalid/travel_map_dev',
    'postgresql://u@127.0.0.1/postgres', 'postgresql://u@localhost/poc_candidate_b',
    'postgresql://u@127.0.0.1/travel_map_dev?host=cloud.example.invalid']) {
    assert.throws(() => localDatabaseUrl(url, '1'));
  }
  assert.throws(() => localDatabaseUrl('postgresql://u@127.0.0.1/travel_map_dev', undefined));
  assert.ok(localDatabaseUrl('postgresql://u@127.0.0.1/travel_map_test_e0', '1'));
});

test('migration pairs and checksums are reproducible', async () => {
  const first = await loadMigrations();
  assert.equal(first.length, 7);
  assert.equal(first[0]?.version, '0001_foundation');
  assert.deepEqual(first, await loadMigrations());
  assert.match(first[0]?.checksum ?? '', /^[a-f0-9]{64}$/);
});
