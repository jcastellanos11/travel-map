import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import pg from 'pg';
import { loadMigrations as loadAllMigrations, localDatabaseUrl, migrate as migrateAll } from '../scripts/migrations.ts';

// Preserve the committed E0 regression independently of E1 migrations.
const loadMigrations = async () => (await loadAllMigrations()).slice(0,1);
const migrate = async (client: pg.Client, direction: 'up'|'down'|'status', migrations = [] as Awaited<ReturnType<typeof loadMigrations>>) => migrateAll(client,direction,migrations.length ? migrations : await loadMigrations());

const supplied = process.env.DATABASE_URL;

test('E0 PostgreSQL: empty database, constraints, RLS, rollback and reapply', {
  skip: !supplied ? 'Set DATABASE_URL to a NEW disposable local DB or run npm run db:local:test with PG_BIN' : false,
}, async (t) => {
  const url = new URL(localDatabaseUrl(supplied, process.env.LOCAL_DATABASE_ONLY));
  // This suite creates/drops its own random database; never empties a supplied DB.
  const database = `travel_map_test_${randomUUID().replaceAll('-', '')}`;
  const adminUrl = new URL(url);
  adminUrl.pathname = '/postgres';
  const admin = new pg.Client({ connectionString: adminUrl.toString(), connectionTimeoutMillis: 5000 });
  const clients: pg.Client[] = [];
  const role = `e0_reader_${randomUUID().replaceAll('-', '')}`;
  let created = false;
  let roleCreated = false;
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${database}`);
    created = true;
    url.pathname = `/${database}`;
    for (let i = 0; i < 2; i++) {
      const client = new pg.Client({ connectionString: url.toString(), connectionTimeoutMillis: 5000 });
      await client.connect();
      clients.push(client);
    }
    const db = clients[0];
    const second = clients[1];
    assert.ok(db && second);
    const version = (await db.query<{ version: string }>('SELECT version()')).rows[0]?.version;
    t.diagnostic(version ?? 'PostgreSQL version unavailable');
    await t.test('fresh DB and two concurrent migration runners apply once', async () => {
      assert.equal((await db.query("SELECT to_regnamespace('travel_map') AS schema")).rows[0].schema, null);
      const changes = await Promise.all([migrate(db, 'up'), migrate(second, 'up')]);
      assert.deepEqual(changes.map((rows) => rows.length).sort(), [0, 1]);
      assert.deepEqual(await migrate(db, 'status'), ['0001_foundation']);
      assert.equal((await db.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='travel_map'")).rows[0].n, 4);
    });
    const owner = randomUUID();
    const member = randomUUID();
    const project = randomUUID();
    await db.query('INSERT INTO travel_map.users(id, supabase_auth_user_id, display_name) VALUES ($1,$2,$3),($4,$5,$6)',
      [owner, randomUUID(), 'Synthetic owner', member, randomUUID(), 'Synthetic member']);
    await db.query('INSERT INTO travel_map.projects(id, owner_user_id, name) VALUES ($1,$2,$3)', [project, owner, 'Synthetic project']);
    await t.test('ownership, membership roles and retained account references are constrained', async () => {
      const denied = (sql: string, params: unknown[] = []) => assert.rejects(db.query(sql, params),
        (error: unknown) => error instanceof pg.DatabaseError && ['23514', '23503', '23505'].includes(error.code ?? ''));
      await denied('INSERT INTO travel_map.project_memberships(project_id,user_id,role) VALUES($1,$2,$3)', [project, owner, 'member']);
      await denied('INSERT INTO travel_map.project_memberships(project_id,user_id,role) VALUES($1,$2,$3)', [project, member, 'owner']);
      await db.query('INSERT INTO travel_map.project_memberships(project_id,user_id,role) VALUES($1,$2,$3)', [project, member, 'member']);
      await denied('UPDATE travel_map.projects SET owner_user_id=$1 WHERE id=$2', [member, project]);
      await denied("UPDATE travel_map.users SET status='deletion_requested' WHERE id=$1", [owner]);
      await denied('DELETE FROM travel_map.users WHERE id=$1', [owner]);
      await denied('INSERT INTO travel_map.projects(owner_user_id,name) VALUES($1,$2)', [randomUUID(), 'Invalid owner']);
      await denied("UPDATE travel_map.projects SET trip_creation_policy='guests' WHERE id=$1", [project]);
    });
    await t.test('sessions accept only a unique digest and coherent lifetimes', async () => {
      const insert = 'INSERT INTO travel_map.app_sessions(user_id,token_digest,expires_at,idle_expires_at) VALUES($1,$2,now()+interval \'1 day\',now()+interval \'30 minutes\')';
      await db.query(insert, [owner, 'a'.repeat(64)]);
      await assert.rejects(db.query(insert, [owner, 'a'.repeat(64)]), { code: '23505' });
      await assert.rejects(db.query(insert, [owner, 'raw-token']), { code: '23514' });
      await assert.rejects(db.query("UPDATE travel_map.app_sessions SET idle_expires_at=expires_at+interval '1 day'"), { code: '23514' });
      const columns = (await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema='travel_map' AND table_name='app_sessions'")).rows;
      assert.ok(!columns.some((column) => ['token', 'access_token', 'refresh_token'].includes(column.column_name)));
    });
    await t.test('unprivileged role is denied schema access; even granted reads remain RLS-denied', async () => {
      await admin.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOBYPASSRLS`);
      roleCreated = true;
      await db.query(`SET ROLE ${role}`);
      try { await assert.rejects(db.query('SELECT * FROM travel_map.users'), { code: '42501' }); }
      finally { await db.query('RESET ROLE'); }
      await db.query('BEGIN');
      try {
        await db.query(`GRANT USAGE ON SCHEMA travel_map TO ${role}`);
        await db.query(`GRANT SELECT ON ALL TABLES IN SCHEMA travel_map TO ${role}`);
        await db.query(`SET LOCAL ROLE ${role}`);
        for (const table of ['users', 'projects', 'project_memberships', 'app_sessions']) {
          assert.equal((await db.query(`SELECT count(*)::int AS n FROM travel_map.${table}`)).rows[0].n, 0);
        }
      } finally { await db.query('ROLLBACK'); }
    });
    await t.test('changed migration content is refused', async () => {
      const migrations = await loadMigrations();
      const first = migrations[0];
      assert.ok(first);
      await assert.rejects(migrate(db, 'up', [{ ...first, checksum: 'changed' }]), /MIGRATION_HISTORY_MISMATCH/);
    });
    await t.test('failed DDL rolls back without a ledger entry', async () => {
      const migrations = await loadMigrations();
      await assert.rejects(migrate(db, 'up', [...migrations, {
        version: '0002_failure', checksum: 'synthetic',
        up: 'CREATE TABLE travel_map.must_rollback(id integer); SELECT missing_e0_function();',
        down: 'DROP TABLE travel_map.must_rollback;',
      }]), { code: '42883' });
      assert.equal((await db.query("SELECT to_regclass('travel_map.must_rollback') AS table")).rows[0].table, null);
      assert.deepEqual(await migrate(db, 'status'), ['0001_foundation']);
    });
    await t.test('down removes foundation only; up recreates a clean schema', async () => {
      assert.deepEqual(await migrate(db, 'down'), ['0001_foundation']);
      assert.equal((await db.query("SELECT to_regnamespace('travel_map') AS schema")).rows[0].schema, null);
      assert.deepEqual(await migrate(db, 'up'), ['0001_foundation']);
      assert.equal((await db.query('SELECT count(*)::int AS n FROM travel_map.users')).rows[0].n, 0);
    });
  } finally {
    for (const client of clients) await client.end();
    try {
      if (created) await admin.query(`DROP DATABASE ${database}`);
      if (roleCreated) await admin.query(`DROP ROLE ${role}`);
    } finally { await admin.end(); }
  }
});
