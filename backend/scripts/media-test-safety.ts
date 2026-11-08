import type pg from 'pg';
import { resolve } from 'node:path';

// No .env loading or caller URL override. This marker is created only by the NEW
// native E4.1 cluster launcher, not inferred from a friendly database name.
export function mediaTestUrl(value: string | undefined, local: string | undefined): URL {
  if (!value || local !== '1') throw new Error('E41_DISPOSABLE_REQUIRED');
  const url = new URL(value);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname !== '127.0.0.1'
    || !url.port || url.port === '57422' || !/^\/travel_map_test_e41_[a-f0-9]+$/.test(url.pathname)
    || url.search || url.hash || url.password || url.username !== 'e41_harness') {
    throw new Error('E41_DISPOSABLE_REQUIRED');
  }
  return url;
}

export async function assertMediaTestCluster(client: pg.Client, expectedDatabase: string, expectedOwner = 'e41_harness'): Promise<void> {
  const marker = process.env.E41_CLUSTER_MARKER;
  const directory = process.env.E41_CLUSTER_DIRECTORY;
  if (!marker || !/^[a-f0-9]{32}$/.test(marker) || !directory
    || !/^travel_map_test_e41_[a-f0-9]+$/.test(expectedDatabase)) throw new Error('E41_MARKER_REQUIRED');
  const root = resolve(new URL('../.local/', import.meta.url).pathname);
  if (!resolve(directory).startsWith(root + '/e41-')) throw new Error('E41_CLUSTER_DIRECTORY_REQUIRED');
  const row = (await client.query<{ name: string; address: string; port: number; directory: string; marker: string; owner: string; database_owner: string; version: number; comment: string | null }>(`
    SELECT current_database() name,host(inet_server_addr()) address,inet_server_port() port,
    current_setting('data_directory') directory,current_setting('travel_map.e41_marker',true) marker,
    current_user owner,pg_get_userbyid(datdba) database_owner,current_setting('server_version_num')::int version,
    shobj_description(oid,'pg_database') comment
    FROM pg_database WHERE datname=current_database()`)).rows[0];
  if (!row || row.name !== expectedDatabase || row.address !== '127.0.0.1' || row.port === 57422
    || resolve(row.directory) !== resolve(directory, 'data') || row.marker !== marker
    || row.owner !== 'e41_harness' || row.database_owner !== expectedOwner || row.version < 170000
    || row.comment !== `travel-map:e41:disposable:${marker}`) {
    throw new Error('E41_CLUSTER_IDENTITY_MISMATCH');
  }
}
