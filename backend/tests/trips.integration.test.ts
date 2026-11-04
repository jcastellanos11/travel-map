import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import pg from 'pg';
import { createTestHarness } from 'wrangler';
import { handleRequest } from '../src/app.ts';
import type { AppEnv } from '../src/env.ts';
import type { Trip } from '../src/modules/trips/types.ts';
import { csrf, digest, randomToken, SESSION_COOKIE } from '../src/modules/identity/security.ts';
import { loadMigrations, localDatabaseUrl, migrate } from '../scripts/migrations.ts';
import type { Migration } from '../scripts/migrations.ts';

interface Actor { id: string; token: string; digest: string; csrf: string }
interface Page { items: Trip[]; nextCursor: string | null }
const supplied = process.env.DATABASE_URL;

test('E2.1 trips: disposable PostgreSQL, non-superuser owner, HTTP and SQL isolation', {
  skip: !supplied ? 'Run npm run db:local:test with PG_BIN' : false,
}, async t => {
  const base = new URL(localDatabaseUrl(supplied, process.env.LOCAL_DATABASE_ONLY));
  const database = `travel_map_test_${randomUUID().replaceAll('-', '')}`;
  const ownerRole = `e21_owner_${randomUUID().replaceAll('-', '')}`;
  const apiRole = `e21_api_${randomUUID().replaceAll('-', '')}`;
  const adminUrl = new URL(base); adminUrl.pathname = '/postgres';
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  let db: pg.Client | undefined;
  let runtime: pg.Client | undefined;
  let created = false;
  const roles: string[] = [];
  const guardDatabases: string[] = [];
  try {
    await admin.query(`CREATE ROLE ${ownerRole} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT`);
    roles.push(ownerRole);
    await admin.query(`CREATE DATABASE ${database} OWNER ${ownerRole}`); created = true;
    const url = new URL(base); url.pathname = `/${database}`;
    db = new pg.Client({ connectionString: url.toString() }); await db.connect();
    const sql = db;
    const migrations = await loadMigrations();
    const e1 = migrations.slice(0, 2);
    const e21 = migrations[2]; assert.ok(e21);
    const ownedMigration = async (direction: 'up' | 'down', set: Migration[] = migrations) => {
      await sql.query(`SET ROLE ${ownerRole}`);
      try { return await migrate(sql, direction, set); }
      finally { await sql.query('RESET ROLE'); }
    };
    await ownedMigration('up', e1);
    await admin.query(`CREATE ROLE ${apiRole} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT`);
    roles.push(apiRole);
    await sql.query(`GRANT USAGE ON SCHEMA travel_map TO ${apiRole}`);
    await sql.query(`GRANT EXECUTE ON FUNCTION travel_map.oauth_begin(text,text), travel_map.oauth_consume(text),
      travel_map.login_complete(text,jsonb,text,text), travel_map.api_call(text,text,jsonb) TO ${apiRole}`);
    const apiUrl = new URL(url); apiUrl.username = apiRole; apiUrl.password = '';
    runtime = new pg.Client({ connectionString: apiUrl.toString() }); await runtime.connect();
    const rpc = runtime;
    const env: AppEnv = { APP_ENV: 'test', APP_ORIGIN: 'https://app.example.invalid',
      SUPABASE_URL: 'http://127.0.0.1:59999', SUPABASE_PUBLISHABLE_KEY: 'synthetic-public',
      DATABASE_URL: apiUrl.toString(), OAUTH_COOKIE_KEY: 'a'.repeat(64) };
    const seed = async (label: string): Promise<Actor> => {
      const id = randomUUID(), token = randomToken(), hashed = await digest(token);
      await sql.query('INSERT INTO travel_map.users(id,supabase_auth_user_id,display_name) VALUES($1,$2,$3)', [id, randomUUID(), `Synthetic ${label}`]);
      await sql.query("INSERT INTO travel_map.app_sessions(user_id,token_digest,expires_at,idle_expires_at) VALUES($1,$2,now()+interval '1 day',now()+interval '30 minutes')", [id, hashed]);
      return { id, token, digest: hashed, csrf: await csrf(token) };
    };
    let owner = await seed('owner');
    const adminActor = await seed('admin'), member = await seed('member'), guest = await seed('guest');
    const foreign = await seed('foreign owner'), removed = await seed('removed member'), inactive = await seed('inactive account');
    const parent = randomUUID(), otherParent = randomUUID();
    await sql.query('INSERT INTO travel_map.projects(id,owner_user_id,name) VALUES($1,$2,$3),($4,$5,$3)',
      [parent, owner.id, 'Colombia journey', otherParent, foreign.id]);
    for (const [actor, role] of [[adminActor, 'admin'], [member, 'member'], [removed, 'member'], [inactive, 'member']] as const) {
      await sql.query('INSERT INTO travel_map.project_memberships(project_id,user_id,role) VALUES($1,$2,$3)', [parent, actor.id, role]);
    }
    const request = (path: string, actor?: Actor, method = 'GET', body?: unknown, headers: Record<string, string> = {}) =>
      handleRequest(new Request(new URL(path, env.APP_ORIGIN), {
        method,
        headers: { ...(actor ? { Cookie: `${SESSION_COOKIE}=${actor.token}` } : {}),
          ...(!['GET', 'HEAD'].includes(method) && actor ? { Origin: env.APP_ORIGIN!, 'X-CSRF-Token': actor.csrf } : {}),
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }), env);
    const call = async (actor: Actor, action: string, data: unknown = {}) =>
      (await rpc.query('SELECT travel_map.api_call($1,$2,$3) AS result', [actor.digest, action, JSON.stringify(data)])).rows[0].result;
    const fingerprint = async () => (await sql.query("SELECT pg_get_functiondef(oid) AS definition,proacl::text AS acl,proowner::text AS owner FROM pg_proc WHERE oid='travel_map.api_call(text,text,jsonb)'::regprocedure")).rows[0];
    const originalRpc = await fingerprint();

    await t.test('migration refuses a different owner before changing schema or ACL', async () => {
      await assert.rejects(migrate(sql, 'up'), { code: '42501' });
      assert.equal((await sql.query("SELECT to_regclass('travel_map.trips') AS value")).rows[0].value, null);
      assert.deepEqual(await fingerprint(), originalRpc);
    });
    await t.test('migration preflight rejects weakened RLS and direct runtime grants', async () => {
      await sql.query('ALTER TABLE travel_map.users NO FORCE ROW LEVEL SECURITY');
      try { await assert.rejects(ownedMigration('up'), { code: '42501' }); }
      finally { await sql.query('ALTER TABLE travel_map.users FORCE ROW LEVEL SECURITY'); }
      await sql.query(`GRANT SELECT ON travel_map.users TO ${apiRole}`);
      try { await assert.rejects(ownedMigration('up'), { code: '42501' }); }
      finally { await sql.query(`REVOKE SELECT ON travel_map.users FROM ${apiRole}`); }
      assert.equal((await sql.query('SELECT count(*)::int AS n FROM travel_map_migrations.applied')).rows[0].n, 2);
    });
    await t.test('failed migration atomically restores original dispatcher and existing project', async () => {
      await assert.rejects(ownedMigration('up', [...e1, { ...e21, checksum: 'failure-injection',
        up: `${e21.up}\nSELECT missing_e21_function();` }]), { code: '42883' });
      assert.equal((await sql.query("SELECT to_regclass('travel_map.trips') AS value")).rows[0].value, null);
      assert.deepEqual(await fingerprint(), originalRpc);
      assert.equal((await request(`/api/v1/projects/${parent}`, owner)).status, 200);
    });
    await t.test('unsafe owner default privileges abort without exposing new private objects', async () => {
      await sql.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${ownerRole} IN SCHEMA travel_map GRANT EXECUTE ON FUNCTIONS TO ${apiRole}`);
      try {
        await assert.rejects(ownedMigration('up'), { code: '42501' });
        assert.equal((await sql.query("SELECT to_regclass('travel_map.trips') AS value")).rows[0].value, null);
        assert.deepEqual(await fingerprint(), originalRpc);
      } finally {
        await sql.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${ownerRole} IN SCHEMA travel_map REVOKE EXECUTE ON FUNCTIONS FROM ${apiRole}`);
      }
    });
    await t.test('forward migration preserves populated E1 data, owner, ACL and all existing RPCs', async () => {
      assert.deepEqual(await ownedMigration('up'), ['0003_trips_authorization']);
      const current = await fingerprint();
      assert.equal(current.owner, originalRpc.owner); assert.equal(current.acl, originalRpc.acl);
      assert.equal((await request('/api/v1/me', owner)).status, 200);
      assert.equal((await request(`/api/v1/projects/${parent}`, owner)).status, 200);
      const flags = (await sql.query('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=$1', [ownerRole])).rows[0];
      assert.deepEqual(flags, { rolsuper: false, rolbypassrls: false });
    });
    let first = '', second = '', memberTrip = '', foreignTrip = '';
    await t.test('Owner creates multiple independent trips with server-derived creator and DTO', async () => {
      for (const description of [null, 'Same country; independent trip']) {
        const response = await request(`/api/v1/projects/${parent}/trips`, owner, 'POST', { name: '  Colombia  ', description });
        assert.equal(response.status, 201);
        const trip = await response.json() as Trip;
        assert.equal(trip.projectId, parent); assert.equal(trip.createdByUserId, owner.id);
        assert.equal(trip.name, 'Colombia'); assert.equal(trip.description, description); assert.equal(trip.status, 'active');
        assert.match(trip.createdAt, /(?:Z|\+00:00)$/);
        if (!first) first = trip.id; else second = trip.id;
      }
      assert.notEqual(first, second);
      assert.equal((await request(`/api/v1/trips/${first}`, owner)).status, 200);
      assert.equal((await request(`/api/v1/trips/${second}`, owner)).status, 200);
      foreignTrip = (await (await request(`/api/v1/projects/${otherParent}/trips`, foreign, 'POST', { name: 'Colombia' })).json() as Trip).id;
    });
    await t.test('Admin creates, lists, reads and edits only within its project', async () => {
      assert.equal((await request(`/api/v1/projects/${parent}/trips`, adminActor, 'POST', { name: 'Admin trip' })).status, 201);
      assert.equal((await request(`/api/v1/projects/${parent}/trips`, adminActor)).status, 200);
      assert.equal((await request(`/api/v1/trips/${first}`, adminActor)).status, 200);
      const update = await request(`/api/v1/trips/${first}`, adminActor, 'PATCH', { name: 'Updated', description: 'One\nTwo' });
      assert.equal(update.status, 200); assert.equal((await update.json() as Trip).description, 'One\nTwo');
      assert.equal((await request(`/api/v1/trips/${first}`, owner, 'PATCH', { description: null })).status, 200);
      assert.equal((await request(`/api/v1/trips/${foreignTrip}`, adminActor, 'PATCH', { name: 'Denied' })).status, 404);
    });
    await t.test('Members inherit all project trips without duplicate trip-membership rows', async () => {
      assert.equal((await request(`/api/v1/trips/${first}`, member)).status, 200);
      assert.equal((await request(`/api/v1/trips/${second}`, member)).status, 200);
      assert.equal((await request(`/api/v1/projects/${parent}/trips`, member)).status, 200);
      assert.equal((await sql.query('SELECT count(*)::int AS n FROM travel_map.trip_memberships')).rows[0].n, 0);
    });
    await t.test('Member creation respects policy; authorship never grants Trip editing (P-03)', async () => {
      assert.equal((await request(`/api/v1/projects/${parent}/trips`, member, 'POST', { name: 'Denied' })).status, 403);
      await sql.query("UPDATE travel_map.projects SET trip_creation_policy='all_project_members' WHERE id=$1", [parent]);
      const created = await request(`/api/v1/projects/${parent}/trips`, member, 'POST', { name: 'Member-created' });
      assert.equal(created.status, 201); const trip = await created.json() as Trip; memberTrip = trip.id;
      assert.equal(trip.createdByUserId, member.id);
      assert.equal((await request(`/api/v1/trips/${memberTrip}`, member, 'PATCH', { name: 'Denied' })).status, 403);
      assert.equal((await call(member, 'trips.update', { id: memberTrip, name: 'Denied' })).error, 'ACTION_FORBIDDEN');
      await sql.query("UPDATE travel_map.projects SET trip_creation_policy='admins_only' WHERE id=$1", [parent]);
    });
    await t.test('Guest sees only its explicit trip, cannot enumerate parent or create/edit', async () => {
      await sql.query('INSERT INTO travel_map.trip_memberships(trip_id,user_id) VALUES($1,$2)', [first, guest.id]);
      assert.equal((await request(`/api/v1/trips/${first}`, guest)).status, 200);
      for (const path of [`/api/v1/projects/${parent}/trips`, `/api/v1/trips/${second}`, `/api/v1/trips/${foreignTrip}`]) {
        assert.equal((await request(path, guest)).status, 404);
      }
      assert.equal((await request(`/api/v1/projects/${parent}/trips`, guest, 'POST', { name: 'Denied' })).status, 404);
      assert.equal((await request(`/api/v1/trips/${first}`, guest, 'PATCH', { name: 'Denied' })).status, 403);
      const dto = await (await request(`/api/v1/trips/${first}`, guest)).json() as Record<string, unknown>;
      for (const key of ['ownerUserId', 'members', 'email', 'tripCount', 'projectName']) assert.ok(!Object.hasOwn(dto, key));
    });
    await t.test('Revoked guest never overrides active inherited access; revoked grants alone deny', async () => {
      await sql.query("INSERT INTO travel_map.trip_memberships(trip_id,user_id,status,revoked_at) VALUES($1,$2,'revoked',clock_timestamp())", [first, member.id]);
      assert.equal((await request(`/api/v1/trips/${first}`, member)).status, 200);
      await sql.query("UPDATE travel_map.trip_memberships SET status='revoked',revoked_at=clock_timestamp() WHERE user_id=$1", [guest.id]);
      assert.equal((await request(`/api/v1/trips/${first}`, guest)).status, 404);
      await sql.query("UPDATE travel_map.project_memberships SET status='revoked',revoked_at=clock_timestamp() WHERE user_id=$1", [removed.id]);
      assert.equal((await request(`/api/v1/trips/${first}`, removed)).status, 404);
      assert.equal((await request(`/api/v1/projects/${parent}/trips`, removed)).status, 404);
      await sql.query("UPDATE travel_map.users SET status='deletion_requested' WHERE id=$1", [inactive.id]);
      assert.equal((await request(`/api/v1/trips/${first}`, inactive)).status, 401);
      await assert.rejects(sql.query("UPDATE travel_map.trip_memberships SET status='inactive' WHERE user_id=$1", [guest.id]), { code: '23514' });
      await assert.rejects(sql.query("UPDATE travel_map.trip_memberships SET role='admin' WHERE user_id=$1", [guest.id]), { code: '23514' });
    });
    await t.test('Inactive parent and trip lifecycle states are hidden without deletion', async () => {
      for (const status of ['archived', 'deletion_requested', 'deleted']) {
        await sql.query("UPDATE travel_map.projects SET status=$2,archived_at=CASE WHEN $2='archived' THEN clock_timestamp() ELSE NULL END,deleted_at=CASE WHEN $2='deleted' THEN clock_timestamp() ELSE NULL END WHERE id=$1", [parent, status]);
        assert.equal((await request(`/api/v1/trips/${first}`, owner)).status, 404);
        assert.equal((await request(`/api/v1/projects/${parent}/trips`, member)).status, 404);
        assert.equal((await request(`/api/v1/projects/${parent}/trips`, adminActor, 'POST', { name: 'Denied' })).status, 404);
      }
      await sql.query("UPDATE travel_map.projects SET status='active',archived_at=NULL,deleted_at=NULL WHERE id=$1", [parent]);
      await sql.query("UPDATE travel_map.trips SET status='archived',archived_at=clock_timestamp() WHERE id=$1", [first]);
      assert.equal((await request(`/api/v1/trips/${first}`, owner)).status, 404);
      const list = await (await request(`/api/v1/projects/${parent}/trips`, owner)).json() as Page;
      assert.ok(!list.items.some(trip => trip.id === first));
      await sql.query("UPDATE travel_map.trips SET status='active',archived_at=NULL WHERE id=$1", [first]);
    });
    await t.test('Cross-project IDs and identical geographic labels never grant access', async () => {
      for (const action of ['trips.get', 'trips.update']) {
        const result = await call(member, action, { id: foreignTrip, ...(action === 'trips.update' ? { name: 'Colombia' } : {}) });
        assert.equal(result.error, 'RESOURCE_NOT_FOUND');
      }
      assert.equal((await call(foreign, 'trips.list', { projectId: parent })).error, 'RESOURCE_NOT_FOUND');
      assert.equal((await call(foreign, 'trips.create', { projectId: parent, name: 'Colombia' })).error, 'RESOURCE_NOT_FOUND');
      const other = await request(`/api/v1/trips/${foreignTrip}`, owner), unknown = await request(`/api/v1/trips/${randomUUID()}`, owner);
      assert.equal(other.status, 404); assert.equal(unknown.status, 404);
      assert.equal((await other.json() as { error: { message: string } }).error.message, (await unknown.json() as { error: { message: string } }).error.message);
    });
    await t.test('HTTP and SQL reject malformed payloads, privileged fields and immutable associations', async () => {
      for (const key of ['projectId', 'createdByUserId', 'ownerUserId', 'role', 'status', 'createdAt']) {
        assert.equal((await request(`/api/v1/projects/${parent}/trips`, owner, 'POST', { name: 'Bad', [key]: foreign.id })).status, 400);
        assert.equal((await request(`/api/v1/trips/${first}`, owner, 'PATCH', { [key]: foreign.id })).status, 400);
      }
      for (const payload of [{}, { name: '' }, { name: 1 }, { name: 'a'.repeat(201) }, { name: 'a', description: [] }]) {
        assert.equal((await request(`/api/v1/projects/${parent}/trips`, owner, 'POST', payload)).status, 400);
        assert.equal((await call(owner, 'trips.create', { projectId: parent, ...payload })).error, 'VALIDATION_ERROR');
      }
      for (const payload of [{ id: first }, { id: first, actorId: foreign.id }, { id: first, projectId: otherParent }, { id: first, description: 'a'.repeat(2001) }]) {
        assert.equal((await call(owner, 'trips.update', payload)).error, 'VALIDATION_ERROR');
      }
      assert.equal((await call(owner, 'trips.list', { projectId: parent, limit: 101 })).error, 'VALIDATION_ERROR');
      assert.equal((await call(owner, 'trips.list', { projectId: parent, cursorTime: 'invalid', cursorId: randomUUID() })).error, 'VALIDATION_ERROR');
      assert.equal((await call(owner, 'trips.get', [])).error, 'VALIDATION_ERROR');
      await assert.rejects(sql.query('DELETE FROM travel_map.projects WHERE id=$1', [parent]), { code: '23503' });
      await assert.rejects(sql.query('DELETE FROM travel_map.users WHERE id=$1', [member.id]), { code: '23503' });
    });
    await t.test('Pagination is deterministic for tied timestamps and scoped before the limit', async () => {
      await sql.query("UPDATE travel_map.trips SET created_at='2026-01-01T00:00:00Z'");
      const seen: string[] = []; let cursor: string | null = null;
      do {
        const response = await request(`/api/v1/projects/${parent}/trips?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, owner);
        assert.equal(response.status, 200); const page = await response.json() as Page;
        assert.ok(page.items.every(trip => trip.projectId === parent));
        seen.push(...page.items.map(trip => trip.id)); cursor = page.nextCursor;
      } while (cursor);
      const expected = (await sql.query('SELECT id FROM travel_map.trips WHERE project_id=$1 ORDER BY created_at,id', [parent])).rows.map(row => row.id);
      assert.deepEqual(seen, expected); assert.equal(new Set(seen).size, seen.length); assert.ok(!seen.includes(foreignTrip));
      assert.equal((await request(`/api/v1/projects/${parent}/trips?limit=101`, owner)).status, 400);
    });
    await t.test('Runtime has exactly four RPCs, forced RLS and no direct table/helper privileges', async () => {
      const granted = (await rpc.query("SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='travel_map' AND has_function_privilege(current_user,p.oid,'EXECUTE') ORDER BY p.proname")).rows.map(row => row.proname);
      assert.deepEqual(granted, ['api_call', 'login_complete', 'oauth_begin', 'oauth_consume']);
      for (const table of ['trips', 'trip_memberships']) {
        const posture = (await rpc.query("SELECT relrowsecurity,relforcerowsecurity,has_table_privilege(current_user,oid,'SELECT,INSERT,UPDATE,DELETE') AS direct FROM pg_class WHERE oid=$1::regclass", [`travel_map.${table}`])).rows[0];
        assert.deepEqual(posture, { relrowsecurity: true, relforcerowsecurity: true, direct: false });
        await assert.rejects(rpc.query(`SELECT * FROM travel_map.${table}`), { code: '42501' });
        await assert.rejects(rpc.query(`DELETE FROM travel_map.${table}`), { code: '42501' });
      }
      await assert.rejects(rpc.query('SELECT travel_map.trips_action($1,$2,$3)', [owner.id, 'trips.get', JSON.stringify({ id: first })]), { code: '42501' });
      await assert.rejects(rpc.query('SELECT travel_map.trip_dto(NULL::travel_map.trips)'), { code: '42501' });
      await sql.query('BEGIN');
      try {
        await sql.query(`GRANT SELECT ON travel_map.trips TO ${apiRole}`); await sql.query(`SET LOCAL ROLE ${apiRole}`);
        assert.equal((await sql.query('SELECT count(*)::int AS n FROM travel_map.trips')).rows[0].n, 0);
      } finally { await sql.query('ROLLBACK'); }
    });
    await t.test('All mutation routes preserve Origin/CSRF validation and security headers', async () => {
      for (const [path, method] of [[`/api/v1/projects/${parent}/trips`, 'POST'], [`/api/v1/trips/${first}`, 'PATCH']]) {
        for (const headers of [{ Origin: 'https://other.example.invalid' }, { 'X-CSRF-Token': 'invalid' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
          assert.equal((await request(path!, owner, method, { name: 'Denied' }, headers)).status, 403);
        }
      }
      const response = await request(`/api/v1/trips/${first}`, owner);
      assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
      assert.equal(response.headers.get('Content-Security-Policy'), "default-src 'none'; frame-ancestors 'none'");
      assert.equal((await request(`/api/v1/trips/${first}`)).status, 401);
    });
    const waitForLock = async () => {
      for (let i = 0; i < 200; i++) {
        await sql.query('SELECT pg_stat_clear_snapshot()');
        const waiting = (await sql.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND application_name='travel-map-api' AND wait_event_type='Lock'")).rows[0].n;
        if (waiting) return;
        await new Promise(done => setTimeout(done, 10));
      }
      assert.fail('Expected bounded lock wait was not observed');
    };
    await t.test('Concurrent independent edits are serialized without mixing payloads', async () => {
      const responses = await Promise.all([
        request(`/api/v1/trips/${first}`, owner, 'PATCH', { name: 'Atomic one', description: 'one' }),
        request(`/api/v1/trips/${first}`, adminActor, 'PATCH', { name: 'Atomic two', description: 'two' }),
      ]);
      assert.ok(responses.every(response => response.status === 200));
      const final = await (await request(`/api/v1/trips/${first}`, owner)).json() as Trip;
      assert.ok((final.name === 'Atomic one' && final.description === 'one') || (final.name === 'Atomic two' && final.description === 'two'));
    });
    await t.test('Creation rechecks policy after a concurrent parent lock', async () => {
      await sql.query("UPDATE travel_map.projects SET trip_creation_policy='all_project_members' WHERE id=$1", [parent]);
      await sql.query('BEGIN'); let pending: Promise<Response> | undefined;
      try {
        await sql.query('SELECT 1 FROM travel_map.projects WHERE id=$1 FOR UPDATE', [parent]);
        pending = request(`/api/v1/projects/${parent}/trips`, member, 'POST', { name: 'Must not be created' });
        await waitForLock();
        await sql.query("UPDATE travel_map.projects SET trip_creation_policy='admins_only' WHERE id=$1", [parent]); await sql.query('COMMIT');
        assert.equal((await pending).status, 403);
      } finally { await sql.query('ROLLBACK'); await pending; }
    });
    await t.test('Revocation racing with a read is rechecked under membership row locks', async () => {
      await sql.query('BEGIN'); let pending: Promise<Response> | undefined;
      try {
        await sql.query('SELECT 1 FROM travel_map.project_memberships WHERE project_id=$1 AND user_id=$2 FOR UPDATE', [parent, member.id]);
        pending = request(`/api/v1/trips/${memberTrip}`, member); await waitForLock();
        await sql.query("UPDATE travel_map.project_memberships SET status='revoked',revoked_at=clock_timestamp() WHERE project_id=$1 AND user_id=$2", [parent, member.id]);
        await sql.query('COMMIT'); assert.equal((await pending).status, 404);
      } finally { await sql.query('ROLLBACK'); await pending; }
      assert.equal((await request(`/api/v1/trips/${memberTrip}`, member, 'PATCH', { name: 'Authorship is not access' })).status, 404);
    });
    await t.test('Actual workerd routes use the same guarded SQL for Trip creation, list, read and patch', async () => {
      const harness = createTestHarness({ workers: [{ configPath: new URL('../wrangler.jsonc', import.meta.url), env: 'test',
        prebuiltWorkerDir: new URL('../dist/', import.meta.url), vars: { APP_ENV: 'test', APP_ORIGIN: env.APP_ORIGIN!, SUPABASE_URL: env.SUPABASE_URL! },
        secrets: { DATABASE_URL: apiUrl.toString(), SUPABASE_PUBLISHABLE_KEY: 'synthetic-public', OAUTH_COOKIE_KEY: env.OAUTH_COOKIE_KEY! },
      }] });
      try {
        await harness.listen();
        const headers = { Cookie: `${SESSION_COOKIE}=${owner.token}`, Origin: env.APP_ORIGIN!, 'X-CSRF-Token': owner.csrf, 'Content-Type': 'application/json' };
        const createdTrip = await harness.fetch(`${env.APP_ORIGIN}/api/v1/projects/${parent}/trips`, { method: 'POST', headers, body: '{"name":"Workerd trip"}' });
        assert.equal(createdTrip.status, 201); const trip = await createdTrip.json() as Trip;
        assert.equal((await harness.fetch(`${env.APP_ORIGIN}/api/v1/projects/${parent}/trips`, { headers })).status, 200);
        assert.equal((await harness.fetch(`${env.APP_ORIGIN}/api/v1/trips/${trip.id}`, { headers })).status, 200);
        assert.equal((await harness.fetch(`${env.APP_ORIGIN}/api/v1/trips/${trip.id}`, { method: 'PATCH', headers, body: '{"description":"Edited"}' })).status, 200);
      } finally { await harness.close(); }
    });
    await t.test('Invalid, expired and revoked sessions cannot use new actions; E1 logout still revokes', async () => {
      assert.equal((await call({ ...owner, digest: await digest(randomToken()) }, 'trips.get', { id: first })).error, 'SESSION_REQUIRED');
      const expired = await seed('expiry');
      await sql.query("UPDATE travel_map.app_sessions SET created_at=now()-interval '2 hours',last_seen_at=now()-interval '2 hours',expires_at=now()-interval '1 hour',idle_expires_at=now()-interval '1 hour' WHERE token_digest=$1", [expired.digest]);
      assert.equal((await request(`/api/v1/trips/${first}`, expired)).status, 401);
      assert.equal((await request('/api/v1/auth/logout', owner, 'POST')).status, 204);
      assert.equal((await request('/api/v1/me', owner)).status, 401);
      assert.equal((await request(`/api/v1/trips/${first}`, owner)).status, 401);
      const token = randomToken();
      await sql.query("INSERT INTO travel_map.app_sessions(user_id,token_digest,expires_at,idle_expires_at) VALUES($1,$2,now()+interval '1 day',now()+interval '30 minutes')", [owner.id, await digest(token)]);
      owner = { id: owner.id, token, digest: await digest(token), csrf: await csrf(token) };
    });
    await t.test('Reverse migration restores exact E1 dispatcher/ACL and preserves existing E1 records', async () => {
      const before = (await sql.query('SELECT count(*)::int AS n FROM travel_map.projects')).rows[0].n;
      assert.deepEqual(await ownedMigration('down'), ['0003_trips_authorization']);
      assert.deepEqual(await fingerprint(), originalRpc);
      assert.equal((await sql.query('SELECT count(*)::int AS n FROM travel_map.projects')).rows[0].n, before);
      assert.equal((await request('/api/v1/me', owner)).status, 200);
      assert.equal((await request(`/api/v1/projects/${parent}`, owner)).status, 200);
      assert.equal((await sql.query("SELECT to_regclass('travel_map.trips') AS value")).rows[0].value, null);
      assert.deepEqual(await ownedMigration('up'), ['0003_trips_authorization']);
      assert.equal((await sql.query('SELECT count(*)::int AS n FROM travel_map.trips')).rows[0].n, 0);
    });
    await t.test('Fresh forward migration works and destructive down refuses a non-test database name', async () => {
      const name = `travel_map_guard_${randomUUID().replaceAll('-', '')}`;
      await admin.query(`CREATE DATABASE ${name} OWNER ${ownerRole}`); guardDatabases.push(name);
      const guardUrl = new URL(url); guardUrl.pathname = `/${name}`;
      const guard = new pg.Client({ connectionString: guardUrl.toString() }); await guard.connect();
      try {
        await guard.query(`SET ROLE ${ownerRole}`); assert.equal((await migrate(guard, 'up')).length, 3);
        await assert.rejects(migrate(guard, 'down'), { code: '42501' });
        assert.equal((await guard.query('SELECT count(*)::int AS n FROM travel_map_migrations.applied')).rows[0].n, 3);
      } finally { await guard.end(); }
    });
  } finally {
    await runtime?.end(); await db?.end();
    try {
      for (const name of guardDatabases) await admin.query(`DROP DATABASE ${name}`);
      if (created) await admin.query(`DROP DATABASE ${database}`);
      for (const role of roles.reverse()) await admin.query(`DROP ROLE ${role}`);
    } finally { await admin.end(); }
  }
});
