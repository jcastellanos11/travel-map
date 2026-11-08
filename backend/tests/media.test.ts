import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { mediaTestUrl } from '../scripts/media-test-safety.ts';
import { MAX_BATCH_FILES, MAX_INPUT_FILE_BYTES, USER_MEDIA_QUOTA_BYTES, TRASH_RETENTION_SECONDS, MEDIA_VARIANTS } from '../src/modules/media/types.ts';

test('E4.1 exact decimal policy and fixed sanitized variants', () => {
  assert.deepEqual([MAX_BATCH_FILES, MAX_INPUT_FILE_BYTES, USER_MEDIA_QUOTA_BYTES, TRASH_RETENTION_SECONDS], [10, 20000000, 500000000, 2592000]);
  assert.deepEqual(MEDIA_VARIANTS, ['archival', 'display', 'thumbnail']);
});
test('E4.1 test target rejects persistent/hosted/override/unknown environments before connecting', () => {
  const allowed = 'postgresql://e41_harness@127.0.0.1:59998/travel_map_test_e41_abcdef';
  assert.equal(mediaTestUrl(allowed, '1').port, '59998');
  for (const value of [undefined, allowed.replace('59998', '57422'), allowed.replace('127.0.0.1', 'localhost'),
    allowed.replace('127.0.0.1', 'remote.supabase.co'), allowed.replace('travel_map_test_e41_abcdef', 'travel_map_dev'),
    allowed.replace('travel_map_test_e41_abcdef', 'travel_map_test_arbitrary'), allowed+'?host=remote.invalid',
    allowed.replace('e41_harness@', 'e41_harness:password@')]) assert.throws(() => mediaTestUrl(value, '1'));
  assert.throws(() => mediaTestUrl(allowed, undefined));
});
test('E4.1 does not add media HTTP paths, object/processor bindings or experiment imports', async () => {
  const spec = JSON.parse(await readFile(new URL('../openapi.json', import.meta.url), 'utf8')) as { paths: Record<string, unknown> };
  assert.ok(!Object.keys(spec.paths).some(p => /photos|upload-operations|\/media\//.test(p)));
  const config = await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  assert.doesNotMatch(config, /r2_buckets|"images"|MEDIA_PROCESSOR/);
  const app = await readFile(new URL('../src/app.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(app, /modules\/media|spikes\//);
});
test('E4.1 reversible migration refuses content loss and maintenance RPC is a separate boundary', async () => {
  const up = await readFile(new URL('../migrations/0007_media_foundation.up.sql', import.meta.url), 'utf8');
  const down = await readFile(new URL('../migrations/0007_media_foundation.down.sql', import.meta.url), 'utf8');
  assert.match(up, /CREATE FUNCTION travel_map_jobs.claim/); assert.match(up, /CREATE FUNCTION travel_map_jobs.record/);
  assert.match(down, /EXISTS\(SELECT 1 FROM travel_map.photos\)/); assert.match(down, /shobj_description/);
  assert.match(up, /SET search_path=pg_catalog/); assert.doesNotMatch(up, /CREATE ROLE|BYPASSRLS|GRANT ALL/);
});

test('E4.1 preserves committed 0001–0006 pair checksums', async () => {
  const { loadMigrations } = await import('../scripts/migrations.ts');
  assert.deepEqual((await loadMigrations()).slice(0, 6).map(({version,checksum}) => ({version,checksum})), [
  {
    "version": "0001_foundation",
    "checksum": "9db8495dfc9b55a8f05b339868e22f7d8eed5edc2f7584790b4bdc2023e30a84"
  },
  {
    "version": "0002_identity",
    "checksum": "5cb3d3cd60a301dc2b4ceac92fa738861a52d09002eec98e5e8f3fa41d799d09"
  },
  {
    "version": "0003_trips_authorization",
    "checksum": "bf47fb199f80c9e6637c33d6d25a87f64b1d696f0cc7f046e33ee4fa7a9b22d9"
  },
  {
    "version": "0004_places_visits",
    "checksum": "ce3f119b38b476605caff2266fbd36032d1cf690459085b717f0283c5680003c"
  },
  {
    "version": "0005_membership_management",
    "checksum": "2b4e63ca9a405803a89c57fa419a953fd11ee17d0d07792ecce981f66b41298f"
  },
  {
    "version": "0006_invitations",
    "checksum": "fca00c9eea8307382f44bdbe9c1b6f73795ee0e6f630233ddb119bd386c6a889"
  }
]);
});
