import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import type { Client } from 'pg';

const migrationDir = new URL('../migrations/', import.meta.url);
const localNames = /^(travel_map_dev|travel_map_test_[a-z0-9_]+)$/;

export function localDatabaseUrl(value: string | undefined, confirmation: string | undefined): string {
  if (!value || confirmation !== '1') throw new Error('LOCAL_DATABASE_REQUIRED');
  const url = new URL(value);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || !localNames.test(url.pathname.slice(1))
    || url.search || url.hash) {
    throw new Error('DISPOSABLE_LOOPBACK_DATABASE_REQUIRED');
  }
  return url.toString();
}

export interface Migration {
  version: string;
  up: string;
  down: string;
  checksum: string;
}

export async function loadMigrations(directory: URL = migrationDir): Promise<Migration[]> {
  const files = await readdir(directory);
  const versions = files.filter((file) => /^\d{4}_[a-z0-9_]+\.up\.sql$/.test(file)).sort();
  if (!versions.length) throw new Error('MIGRATIONS_MISSING');
  const migrations: Migration[] = [];
  for (const file of versions) {
    const version = file.replace('.up.sql', '');
    const up = await readFile(new URL(file, directory), 'utf8');
    const down = await readFile(new URL(`${version}.down.sql`, directory), 'utf8');
    const checksum = createHash('sha256').update(up).update('\0').update(down).digest('hex');
    migrations.push({ version, up, down, checksum });
  }
  return migrations;
}

interface Applied { version: string; checksum: string }

export async function migrate(client: Client, direction: 'up' | 'down' | 'status',
  migrations: Migration[] = []): Promise<string[]> {
  const available = migrations.length ? migrations : await loadMigrations();
  // One session, one advisory lock: independent migration processes serialize.
  await client.query('SELECT pg_advisory_lock(714023, 0)');
  try {
    const exists = await client.query<{ present: string | null }>(
      "SELECT to_regclass('travel_map_migrations.applied')::text AS present");
    if (!exists.rows[0]?.present && direction !== 'up') return [];
    if (!exists.rows[0]?.present) {
      await client.query(`BEGIN;
        CREATE SCHEMA travel_map_migrations;
        REVOKE ALL ON SCHEMA travel_map_migrations FROM PUBLIC;
        CREATE TABLE travel_map_migrations.applied (
          version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
        );
        REVOKE ALL ON travel_map_migrations.applied FROM PUBLIC;
        COMMIT;`);
    }
    const applied = (await client.query<Applied>(
      'SELECT version, checksum FROM travel_map_migrations.applied ORDER BY version')).rows;
    for (const [index, row] of applied.entries()) {
      if (available[index]?.version !== row.version || available[index]?.checksum !== row.checksum) {
        throw new Error('MIGRATION_HISTORY_MISMATCH');
      }
    }
    if (direction === 'status') return applied.map((row) => row.version);
    const pending = direction === 'up' ? available.slice(applied.length)
      : available.slice(Math.max(0, applied.length - 1), applied.length);
    const changed: string[] = [];
    for (const migration of pending) {
      await client.query('BEGIN');
      try {
        await client.query(direction === 'up' ? migration.up : migration.down);
        if (direction === 'up') {
          await client.query('INSERT INTO travel_map_migrations.applied(version, checksum) VALUES ($1, $2)',
            [migration.version, migration.checksum]);
        } else {
          await client.query('DELETE FROM travel_map_migrations.applied WHERE version = $1', [migration.version]);
        }
        await client.query('COMMIT');
        changed.push(migration.version);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
    return changed;
  } finally {
    // ROLLBACK also clears a failed metadata-bootstrap transaction, if any.
    await client.query('ROLLBACK');
    await client.query('SELECT pg_advisory_unlock(714023, 0)');
  }
}
