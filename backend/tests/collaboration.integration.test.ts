import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import pg from 'pg';
import { createTestHarness } from 'wrangler';
import { handleRequest } from '../src/app.ts';
import type { AppEnv } from '../src/env.ts';
import { csrf, digest, randomToken, SESSION_COOKIE } from '../src/modules/identity/security.ts';
import { loadMigrations, localDatabaseUrl, migrate } from '../scripts/migrations.ts';
import type { Migration } from '../scripts/migrations.ts';
interface Actor { id: string; token: string; hash: string; csrf: string }
const supplied = process.env.DATABASE_URL;
test('E2.3: native membership lifecycle, SQL isolation, concurrency and migration safety', { skip: !supplied ? 'Run db:local:test with PG_BIN' : false }, async t => {
  const base = new URL(localDatabaseUrl(supplied, process.env.LOCAL_DATABASE_ONLY));
  assert.match(base.pathname, /^\/travel_map_test_[a-z0-9_]+$/);
  const suffix = randomUUID().replaceAll('-', ''), database = `travel_map_test_${suffix}`, ownerRole = `e23_owner_${suffix}`, apiRole = `e23_api_${suffix}`;
  const adminUrl = new URL(base); adminUrl.pathname = '/postgres';
  const admin = new pg.Client({ connectionString: adminUrl.toString() }); await admin.connect();
  let db: pg.Client | undefined, runtime: pg.Client | undefined, created = false;
  const roles: string[] = [], guardDatabases: string[] = [];
  try {
    await admin.query(`CREATE ROLE ${ownerRole} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT`); roles.push(ownerRole);
    await admin.query(`CREATE DATABASE ${database} OWNER ${ownerRole}`); created = true;
    const url = new URL(base); url.pathname = `/${database}`;
    db = new pg.Client({ connectionString: url.toString() }); await db.connect(); const sql = db;
    const all = (await loadMigrations()).slice(0, 5), previous = all.slice(0, 4), migration = all[4]; assert.ok(migration); assert.equal(all.length, 5);
    const owned = async (direction: 'up' | 'down', set: Migration[] = all) => { await sql.query(`SET ROLE ${ownerRole}`); try { return await migrate(sql, direction, set); } finally { await sql.query('RESET ROLE'); } };
    await owned('up', previous);
    await admin.query(`CREATE ROLE ${apiRole} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT`); roles.push(apiRole);
    await sql.query(`GRANT USAGE ON SCHEMA travel_map TO ${apiRole}`);
    await sql.query(`GRANT EXECUTE ON FUNCTION travel_map.oauth_begin(text,text),travel_map.oauth_consume(text),travel_map.login_complete(text,jsonb,text,text),travel_map.api_call(text,text,jsonb) TO ${apiRole}`);
    const apiUrl = new URL(url); apiUrl.username = apiRole; apiUrl.password = '';
    runtime = new pg.Client({ connectionString: apiUrl.toString() }); await runtime.connect(); const rpc = runtime;
    const env: AppEnv = { APP_ENV: 'test', APP_ORIGIN: 'https://app.example.invalid', SUPABASE_URL: 'http://127.0.0.1:59999', SUPABASE_PUBLISHABLE_KEY: 'synthetic-public', DATABASE_URL: apiUrl.toString(), OAUTH_COOKIE_KEY: 'd'.repeat(64) };
    const seed = async (name: string): Promise<Actor> => { const id = randomUUID(), token = randomToken(), hash = await digest(token);
      await sql.query('INSERT INTO travel_map.users(id,supabase_auth_user_id,display_name) VALUES($1,$2,$3)', [id, randomUUID(), `Synthetic ${name}`]);
      await sql.query("INSERT INTO travel_map.app_sessions(user_id,token_digest,expires_at,idle_expires_at) VALUES($1,$2,now()+interval '1 day',now()+interval '30 minutes')", [id, hash]);
      return { id, token, hash, csrf: await csrf(token) }; };
    const owner = await seed('owner'), adminActor = await seed('admin'), member = await seed('member'), guest = await seed('guest'), foreign = await seed('foreign');
    const call = async (actor: Actor, action: string, data: unknown = {}) => (await rpc.query('SELECT travel_map.api_call($1,$2,$3) AS result', [actor.hash, action, JSON.stringify(data)])).rows[0].result;
    const headers = (actor: Actor, method: string, data?: unknown) => ({ Cookie: `${SESSION_COOKIE}=${actor.token}`, ...(!['GET', 'HEAD'].includes(method) ? { Origin: env.APP_ORIGIN!, 'X-CSRF-Token': actor.csrf } : {}), ...(data === undefined ? {} : { 'Content-Type': 'application/json' }) });
    const request = (path: string, actor: Actor = owner, method = 'GET', data?: unknown, override: Record<string, string> = {}) => handleRequest(new Request(new URL(path, env.APP_ORIGIN), { method, headers: { ...headers(actor, method, data), ...override }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) }), env);
    // Fixtures are admin-only writes in this random disposable database, never API backdoors.
    const fixture = async () => {
      const project = randomUUID(), trip = randomUUID(), second = randomUUID();
      await sql.query('INSERT INTO travel_map.projects(id,owner_user_id,name) VALUES($1,$2,$3)', [project, owner.id, 'Private name sentinel']);
      for (const [actor, role] of [[adminActor, 'admin'], [member, 'member']] as const) await sql.query('INSERT INTO travel_map.project_memberships(project_id,user_id,role) VALUES($1,$2,$3)', [project, actor.id, role]);
      for (const id of [trip, second]) await sql.query('INSERT INTO travel_map.trips(id,project_id,created_by_user_id,name) VALUES($1,$2,$3,$4)', [id, project, member.id, 'Retained Trip']);
      for (const id of [trip, second]) for (const actor of [member, guest]) await sql.query('INSERT INTO travel_map.trip_memberships(trip_id,user_id) VALUES($1,$2)', [id, actor.id]);
      const visit = randomUUID();
      await sql.query("INSERT INTO travel_map.visits(id,trip_id,place_id,created_by_user_id) VALUES($1,$2,'44576a98-98a4-55e0-b879-360717211efb',$3)", [visit, trip, member.id]);
      return { project, trip, second, visit };
    };
    const before = await fixture();
    const fingerprint = async () => (await sql.query("SELECT pg_get_functiondef(oid) definition,proacl::text acl,proowner::text owner FROM pg_proc WHERE oid='travel_map.api_call(text,text,jsonb)'::regprocedure")).rows[0];
    const original = await fingerprint();
    await t.test('migration refuses wrong owner, RLS/ACL/helper drift without repair', async () => {
      await assert.rejects(migrate(sql, 'up'), { code: '42501' });
      await sql.query('ALTER TABLE travel_map.visits NO FORCE ROW LEVEL SECURITY');
      try { await assert.rejects(owned('up'), { code: '42501' }); } finally { await sql.query('ALTER TABLE travel_map.visits FORCE ROW LEVEL SECURITY'); }
      await sql.query(`GRANT SELECT ON travel_map.visits TO ${apiRole}`);
      try { await assert.rejects(owned('up'), { code: '42501' }); } finally { await sql.query(`REVOKE SELECT ON travel_map.visits FROM ${apiRole}`); }
      await sql.query(`GRANT EXECUTE ON FUNCTION travel_map.geography_action(uuid,text,jsonb) TO ${apiRole}`);
      try { await assert.rejects(owned('up'), { code: '42501' }); } finally { await sql.query(`REVOKE EXECUTE ON FUNCTION travel_map.geography_action(uuid,text,jsonb) FROM ${apiRole}`); }
      assert.deepEqual(await fingerprint(), original);
    });
    await t.test('failed migration and unsafe default ACL atomically restore schema, ledger and dispatcher', async () => {
      await assert.rejects(owned('up', [...previous, { ...migration, checksum: 'failure', up: `${migration.up}\nSELECT missing_e23_function();` }]), { code: '42883' });
      await sql.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${ownerRole} IN SCHEMA travel_map GRANT EXECUTE ON FUNCTIONS TO ${apiRole}`);
      try { await assert.rejects(owned('up'), { code: '42501' }); } finally { await sql.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${ownerRole} IN SCHEMA travel_map REVOKE EXECUTE ON FUNCTIONS FROM ${apiRole}`); }
      assert.equal((await sql.query("SELECT to_regclass('travel_map.domain_audit_events') x")).rows[0].x, null);
      assert.equal((await sql.query('SELECT count(*)::int n FROM travel_map_migrations.applied')).rows[0].n, 4);
      assert.deepEqual(await fingerprint(), original);
    });
    await t.test('0005 upgrades populated E2.2 with existing content, sessions and ownership intact', async () => {
      assert.deepEqual(await owned('up'), ['0005_membership_management']);
      const current = await fingerprint(); assert.equal(current.owner, original.owner); assert.equal(current.acl, original.acl);
      assert.equal((await request(`/api/v1/visits/${before.visit}`, member)).status, 200);
      assert.equal((await request('/api/v1/me')).status, 200);
    });
    await t.test('Owner/Admin roster is minimal, bounded and deterministic; Member/Guest/foreign denied', async () => {
      for (const actor of [owner, adminActor]) {
        const first = await request(`/api/v1/projects/${before.project}/members?limit=1`, actor); assert.equal(first.status, 200);
        const page = await first.json() as { items: { userId: string }[]; nextCursor: string }; assert.equal(page.items.length, 1); assert.ok(page.nextCursor);
        const next = await (await request(`/api/v1/projects/${before.project}/members?limit=1&cursor=${encodeURIComponent(page.nextCursor)}`, actor)).json() as { items: { userId: string }[] };
        assert.notEqual(page.items[0]!.userId, next.items[0]!.userId);
        const full = await (await request(`/api/v1/projects/${before.project}/members`, actor)).json() as { items: Record<string, unknown>[] };
        assert.equal(full.items.length, 3); assert.equal(full.items.filter(x => x.role === 'owner').length, 1);
        for (const item of full.items) assert.deepEqual(Object.keys(item).sort(), ['createdAt', 'displayName', 'role', 'userId']);
      }
      for (const [actor, status] of [[member, 403], [guest, 404], [foreign, 404]] as const) assert.equal((await request(`/api/v1/projects/${before.project}/members`, actor)).status, status);
      assert.equal((await request(`/api/v1/projects/${before.project}/members?limit=101`)).status, 400);
      assert.equal((await call(owner, 'collaboration.members', { id: before.project, limit: 0 })).error, 'VALIDATION_ERROR');
    });
    await t.test('Owner promotes/demotes active members; only correct transitions accepted', async () => {
      const f = await fixture(), path = `/api/v1/projects/${f.project}/members/${member.id}`;
      assert.equal((await request(`${path}/promote-admin`, owner, 'POST')).status, 204);
      assert.equal((await request(`${path}/promote-admin`, owner, 'POST')).status, 409);
      assert.equal((await request(`${path}/remove-admin`, owner, 'POST')).status, 204);
      assert.equal((await request(`${path}/remove-admin`, owner, 'POST')).status, 409);
      assert.equal((await sql.query('SELECT role,status FROM travel_map.project_memberships WHERE project_id=$1 AND user_id=$2', [f.project, member.id])).rows[0].role, 'member');
    });
    await t.test('Admin/Member/Guest cannot promote/demote; Owner cannot be duplicated or removed', async () => {
      const f = await fixture();
      for (const actor of [adminActor, member, guest]) for (const action of ['promote-admin', 'remove-admin']) {
        assert.equal((await request(`/api/v1/projects/${f.project}/members/${actor.id}/${action}`, actor, 'POST')).status, actor === guest ? 404 : 403);
      }
      for (const actor of [owner, adminActor]) for (const [method, tail] of [['DELETE', ''], ['POST', '/promote-admin'], ['POST', '/remove-admin']] as const) assert.equal((await request(`/api/v1/projects/${f.project}/members/${owner.id}${tail}`, actor, method)).status, 403);
      assert.equal((await request(`/api/v1/projects/${f.project}/members/${adminActor.id}`, adminActor, 'DELETE')).status, 403);
      assert.equal((await call(adminActor, 'collaboration.promote', { id: f.project, userId: member.id })).error, 'ACTION_FORBIDDEN');
    });
    for (const manager of [owner, adminActor]) await t.test(`${manager === owner ? 'Owner' : 'Admin'} removes Member and every descendant grant, preserving creator/content`, async () => {
      const f = await fixture();
      await sql.query("UPDATE travel_map.trips SET status='archived',archived_at=clock_timestamp() WHERE id=$1", [f.second]);
      assert.equal((await request(`/api/v1/projects/${f.project}/members/${member.id}`, manager, 'DELETE')).status, 204);
      const grants = await sql.query('SELECT status FROM travel_map.trip_memberships WHERE user_id=$1 AND trip_id=ANY($2::uuid[])', [member.id, [f.trip, f.second]]); assert.ok(grants.rows.every(x => x.status === 'revoked'));
      for (const path of [`/api/v1/projects/${f.project}`, `/api/v1/trips/${f.trip}`, `/api/v1/trips/${f.second}`, `/api/v1/visits/${f.visit}`, `/api/v1/projects/${f.project}/map`]) assert.equal((await request(path, member)).status, 404);
      assert.equal((await request(`/api/v1/visits/${f.visit}`, member, 'PATCH', { name: 'Denied' })).status, 404);
      assert.equal((await sql.query('SELECT created_by_user_id FROM travel_map.visits WHERE id=$1', [f.visit])).rows[0].created_by_user_id, member.id);
      assert.equal((await sql.query('SELECT count(*)::int n FROM travel_map.trips WHERE project_id=$1 AND created_by_user_id=$2', [f.project, member.id])).rows[0].n, 2);
      assert.equal((await request('/api/v1/me', member)).status, 200);
    });
    await t.test('Owner removes Admin; Admin cannot remove another Admin or guessed cross-project participant', async () => {
      const f = await fixture();
      await request(`/api/v1/projects/${f.project}/members/${member.id}/promote-admin`, owner, 'POST');
      assert.equal((await request(`/api/v1/projects/${f.project}/members/${member.id}`, adminActor, 'DELETE')).status, 403);
      assert.equal((await request(`/api/v1/projects/${f.project}/members/${member.id}`, owner, 'DELETE')).status, 204);
      assert.equal((await request(`/api/v1/projects/${f.project}/members/${foreign.id}`, owner, 'DELETE')).status, 404);
      for (const actor of [member, guest, foreign]) assert.equal((await request(`/api/v1/projects/${f.project}/members/${adminActor.id}`, actor, 'DELETE')).status, 404);
    });
    for (const actor of [member, adminActor]) await t.test(`${actor === member ? 'Member' : 'Admin'} voluntary Project departure revokes all explicit grants`, async () => {
      const f = await fixture();
      if (actor === adminActor) for (const trip of [f.trip, f.second]) await sql.query('INSERT INTO travel_map.trip_memberships(trip_id,user_id) VALUES($1,$2)', [trip, actor.id]);
      assert.equal((await request(`/api/v1/projects/${f.project}/leave`, actor, 'POST')).status, 204);
      assert.equal((await request(`/api/v1/projects/${f.project}/leave`, actor, 'POST')).status, 404);
      for (const trip of [f.trip, f.second]) assert.equal((await request(`/api/v1/trips/${trip}`, actor)).status, 404);
      assert.equal((await request(`/api/v1/visits/${f.visit}`, owner)).status, 200);
    });
    await t.test('Owner cannot leave; Guest cannot Project-leave; inherited membership cannot Trip-leave', async () => {
      const f = await fixture();
      assert.equal((await request(`/api/v1/projects/${f.project}/leave`, owner, 'POST')).status, 403);
      assert.equal((await request(`/api/v1/projects/${f.project}/leave`, guest, 'POST')).status, 404);
      for (const actor of [owner, adminActor, member]) assert.equal((await request(`/api/v1/trips/${f.trip}/leave`, actor, 'POST')).status, 403);
    });
    await t.test('Guest leaves only own Trip; managers revoke explicit grants without suppressing inheritance', async () => {
      const f = await fixture();
      assert.equal((await request(`/api/v1/trips/${f.trip}/leave`, guest, 'POST')).status, 204);
      assert.equal((await request(`/api/v1/trips/${f.trip}`, guest)).status, 404);
      assert.equal((await request(`/api/v1/trips/${f.second}`, guest)).status, 200);
      assert.equal((await request(`/api/v1/trips/${f.second}/members/${member.id}`, guest, 'DELETE')).status, 404);
      for (const [actor, target] of [[adminActor, guest], [owner, member]] as const) assert.equal((await request(`/api/v1/trips/${f.second}/members/${target.id}`, actor, 'DELETE')).status, 204);
      assert.equal((await request(`/api/v1/trips/${f.second}`, member)).status, 200);
      assert.equal((await request(`/api/v1/trips/${f.second}`, guest)).status, 404);
    });
    await t.test('Owner/Admin settings and policy changes take immediate effect; no ownership mutation', async () => {
      const f = await fixture();
      for (const actor of [owner, adminActor]) {
        assert.equal((await request(`/api/v1/projects/${f.project}`, actor, 'PATCH', { name: 'Renamed', tripCreationPolicy: 'all_project_members' })).status, 200);
        assert.equal((await request(`/api/v1/projects/${f.project}/trips`, member, 'POST', { name: 'Member creation' })).status, 201);
        assert.equal((await request(`/api/v1/projects/${f.project}`, actor, 'PATCH', { tripCreationPolicy: 'admins_only' })).status, 200);
        assert.equal((await request(`/api/v1/projects/${f.project}/trips`, member, 'POST', { name: 'Denied' })).status, 403);
      }
      for (const actor of [member, guest, foreign]) assert.equal((await request(`/api/v1/projects/${f.project}`, actor, 'PATCH', { name: 'Denied' })).status, actor === member ? 403 : 404);
      for (const key of ['ownerUserId', 'status', 'role', 'archivedAt', 'createdByUserId']) {
        assert.equal((await request(`/api/v1/projects/${f.project}`, owner, 'PATCH', { [key]: 'forged' })).status, 400);
        assert.equal((await call(owner, 'collaboration.settings', { id: f.project, [key]: 'forged' })).error, 'VALIDATION_ERROR');
      }
      assert.equal((await sql.query('SELECT owner_user_id FROM travel_map.projects WHERE id=$1', [f.project])).rows[0].owner_user_id, owner.id);
    });
    await t.test('dedicated mutation endpoints reject role/actor bodies and cross-project Trip targets', async () => {
      const f = await fixture();
      for (const [path, method] of [[`/api/v1/projects/${f.project}/members/${member.id}/promote-admin`, 'POST'],
        [`/api/v1/projects/${f.project}/members/${adminActor.id}/remove-admin`, 'POST'],
        [`/api/v1/projects/${f.project}/members/${member.id}`, 'DELETE'],
        [`/api/v1/projects/${f.project}/leave`, 'POST'], [`/api/v1/projects/${f.project}/archive`, 'POST'],
        [`/api/v1/trips/${f.trip}/members/${guest.id}`, 'DELETE'], [`/api/v1/trips/${f.trip}/leave`, 'POST']]) {
        assert.equal((await request(path!, owner, method!, { role: 'owner', actorId: foreign.id })).status, 400);
        assert.equal((await request(`${path}?role=owner`, owner, method!)).status, 400);
      }
      assert.equal((await request(`/api/v1/projects/${f.project}/members/${adminActor.id}`, member, 'DELETE')).status, 403);
      assert.equal((await request(`/api/v1/projects/${f.project}/members/${member.id}/remove-admin`, adminActor, 'POST')).status, 403);
      assert.equal((await request(`/api/v1/trips/${f.trip}/members/${guest.id}`, foreign, 'DELETE')).status, 404);
      assert.equal((await call(foreign, 'collaboration.guest_remove', { id: f.trip, userId: guest.id })).error, 'RESOURCE_NOT_FOUND');
      assert.equal((await call(guest, 'collaboration.guest_leave', { id: randomUUID() })).error, 'RESOURCE_NOT_FOUND');
    });
    await t.test('Owner-only archive hides all descendants, preserves rows/grants and unrelated sessions; no restore', async () => {
      const f = await fixture();
      for (const actor of [adminActor, member, guest]) assert.equal((await request(`/api/v1/projects/${f.project}/archive`, actor, 'POST')).status, actor === guest ? 404 : 403);
      assert.equal((await request(`/api/v1/projects/${f.project}/archive`, owner, 'POST')).status, 204);
      for (const actor of [owner, adminActor, member, guest]) {
        for (const path of [`/api/v1/projects/${f.project}`, `/api/v1/trips/${f.trip}`, `/api/v1/visits/${f.visit}`, `/api/v1/trips/${f.trip}/map`, `/api/v1/projects/${f.project}/map`]) assert.equal((await request(path, actor)).status, 404);
        assert.equal((await request(`/api/v1/trips/${f.trip}/visits`, actor, 'POST', { placeId: '44576a98-98a4-55e0-b879-360717211efb' })).status, 404);
        assert.equal((await request('/api/v1/me', actor)).status, 200);
      }
      for (const action of ['archive', 'leave', 'restore']) assert.equal((await request(`/api/v1/projects/${f.project}/${action}`, owner, 'POST')).status, 404);
      assert.equal((await request(`/api/v1/projects/${f.project}/members/${member.id}/promote-admin`, owner, 'POST')).status, 404);
      const list = await call(owner, 'projects.list', { limit: 100 }); assert.ok(!list.items.some((x: { id: string }) => x.id === f.project));
      assert.equal((await sql.query('SELECT count(*)::int n FROM travel_map.visits WHERE id=$1', [f.visit])).rows[0].n, 1);
      assert.equal((await sql.query("SELECT count(*)::int n FROM travel_map.trip_memberships WHERE trip_id=ANY($1::uuid[]) AND status='active'", [[f.trip, f.second]])).rows[0].n, 4);
    });
    await t.test('Origin, CSRF, missing/revoked/expired sessions fail all new mutation families', async () => {
      const f = await fixture();
      const actions: [string, string, unknown?][] = [[`/api/v1/projects/${f.project}`, 'PATCH', { name: 'x' }], [`/api/v1/projects/${f.project}/archive`, 'POST'], [`/api/v1/projects/${f.project}/members/${member.id}`, 'DELETE'], [`/api/v1/trips/${f.trip}/members/${guest.id}`, 'DELETE']];
      for (const [path, method, data] of actions) {
        assert.equal((await request(path, owner, method, data, { Origin: 'https://evil.invalid' })).status, 403);
        assert.equal((await request(path, owner, method, data, { 'X-CSRF-Token': '' })).status, 403);
        assert.equal((await request(path, owner, method, data, { Cookie: '' })).status, 401);
      }
      const expired = await seed('expired'); await sql.query("UPDATE travel_map.app_sessions SET created_at=now()-interval '2 days',expires_at=now()-interval '1 day',idle_expires_at=now()-interval '1 day',last_seen_at=now()-interval '2 days' WHERE user_id=$1", [expired.id]);
      assert.equal((await request(`/api/v1/projects/${f.project}/members`, expired)).status, 401);
      const revoked = await seed('revoked'); await call(revoked, 'logout');
      assert.equal((await request(`/api/v1/projects/${f.project}/members`, revoked)).status, 401);
    });
    await t.test('direct SQL rejects crafted payloads, hidden membership probes and inactive actor access', async () => {
      const f = await fixture();
      for (const action of ['members', 'promote', 'demote', 'remove', 'leave', 'guest_remove', 'guest_leave', 'settings', 'archive']) {
        assert.equal((await call(owner, `collaboration.${action}`, { id: f.project, actorId: foreign.id })).error, 'VALIDATION_ERROR');
        assert.equal((await call(owner, `collaboration.${action}`, [])).error, 'VALIDATION_ERROR');
      }
      assert.equal((await call(foreign, 'collaboration.remove', { id: f.project, userId: member.id })).error, 'RESOURCE_NOT_FOUND');
      assert.equal((await call(foreign, 'collaboration.remove', { id: f.project, userId: randomUUID() })).error, 'RESOURCE_NOT_FOUND');
      assert.equal((await call(member, 'collaboration.remove', { id: f.project, userId: foreign.id })).error, 'ACTION_FORBIDDEN');
      const inactive = await seed('inactive'); await sql.query("UPDATE travel_map.users SET status='deletion_requested' WHERE id=$1", [inactive.id]);
      assert.equal((await call(inactive, 'collaboration.members', { id: f.project })).error, 'SESSION_REQUIRED');
    });
    // Hold an actual successful runtime RPC uncommitted. The second independent
    // HTTP/SQL connection must wait, then recheck authorization after commit.
    const serialized = async (actor: Actor, action: string, data: unknown, following: () => Promise<Response>) => {
      const first = new pg.Client({ connectionString: apiUrl.toString() }); await first.connect();
      let pending: Promise<Response> | undefined;
      try {
        await first.query('BEGIN');
        const result = (await first.query('SELECT travel_map.api_call($1,$2,$3) r', [actor.hash, action, JSON.stringify(data)])).rows[0].r; assert.ok(!result.error, result.error);
        pending = following();
        let waiting = false;
        for (let i = 0; i < 300; i++) {
          await sql.query('SELECT pg_stat_clear_snapshot()');
          const rows = await sql.query("SELECT count(*)::int n FROM pg_stat_activity WHERE datname=current_database() AND application_name='travel-map-api' AND wait_event_type='Lock'");
          if (rows.rows[0].n > 0) { waiting = true; break; }
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        assert.ok(waiting, 'Independent HTTP RPC must block on the first transaction');
        await first.query('COMMIT');
        return await pending;
      } finally { await first.query('ROLLBACK'); await first.end(); if (pending) await pending; }
    };
    await t.test('concurrent promotion then Admin removal rechecks target role under exclusive Project lock', async () => {
      const f = await fixture();
      const response = await serialized(owner, 'collaboration.promote', { id: f.project, userId: member.id }, () => request(`/api/v1/projects/${f.project}/members/${member.id}`, adminActor, 'DELETE'));
      assert.equal(response.status, 403);
      assert.equal((await sql.query('SELECT role,status FROM travel_map.project_memberships WHERE project_id=$1 AND user_id=$2', [f.project, member.id])).rows[0].role, 'admin');
    });
    await t.test('concurrent removal then promotion cannot reactivate a revoked Member', async () => {
      const f = await fixture();
      assert.equal((await serialized(adminActor, 'collaboration.remove', { id: f.project, userId: member.id }, () => request(`/api/v1/projects/${f.project}/members/${member.id}/promote-admin`, owner, 'POST'))).status, 404);
    });
    await t.test('membership removal racing Visit creation denies the waiting creator', async () => {
      const f = await fixture();
      assert.equal((await serialized(owner, 'collaboration.remove', { id: f.project, userId: member.id }, () => request(`/api/v1/trips/${f.trip}/visits`, member, 'POST', { placeId: '44576a98-98a4-55e0-b879-360717211efb' }))).status, 404);
      assert.equal((await sql.query('SELECT count(*)::int n FROM travel_map.visits WHERE trip_id=$1', [f.trip])).rows[0].n, 1);
    });
    await t.test('Visit creation committed before removal is retained; subsequent creator edits denied', async () => {
      const f = await fixture();
      assert.equal((await serialized(member, 'visits.create', { tripId: f.trip, placeId: '44576a98-98a4-55e0-b879-360717211efb' }, () => request(`/api/v1/projects/${f.project}/members/${member.id}`, owner, 'DELETE'))).status, 204);
      assert.equal((await sql.query('SELECT count(*)::int n FROM travel_map.visits WHERE trip_id=$1 AND created_by_user_id=$2', [f.trip, member.id])).rows[0].n, 2);
      assert.equal((await request(`/api/v1/visits/${f.visit}`, member, 'PATCH', { name: 'Denied' })).status, 404);
    });
    await t.test('Project archive racing Trip and Visit creation blocks both following writes', async () => {
      for (const type of ['trips', 'visits']) {
        const f = await fixture();
        const path = type === 'trips' ? `/api/v1/projects/${f.project}/trips` : `/api/v1/trips/${f.trip}/visits`;
        const data = type === 'trips' ? { name: 'Denied' } : { placeId: '44576a98-98a4-55e0-b879-360717211efb' };
        assert.equal((await serialized(owner, 'collaboration.archive', { id: f.project }, () => request(path, adminActor, 'POST', data))).status, 404);
      }
    });
    await t.test('concurrent departure and promotion cannot recover explicit grants or Project access', async () => {
      const f = await fixture();
      assert.equal((await serialized(member, 'collaboration.leave', { id: f.project }, () => request(`/api/v1/projects/${f.project}/members/${member.id}/promote-admin`, owner, 'POST'))).status, 404);
      assert.equal((await request(`/api/v1/trips/${f.second}`, member)).status, 404);
    });
    await t.test('logout serialized with membership mutation makes the waiting request unauthenticated', async () => {
      const f = await fixture(), actor = await seed('logout admin');
      await sql.query("INSERT INTO travel_map.project_memberships(project_id,user_id,role) VALUES($1,$2,'admin')", [f.project, actor.id]);
      assert.equal((await serialized(actor, 'logout', {}, () => request(`/api/v1/projects/${f.project}/members/${member.id}`, actor, 'DELETE'))).status, 401);
      assert.equal((await request(`/api/v1/trips/${f.trip}`, member)).status, 200);
    });
    await t.test('audit failure rolls back membership and ALL descendant grants; no partial success', async () => {
      const f = await fixture();
      await sql.query("CREATE FUNCTION public.e23_audit_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic failure'; END; $$");
      await sql.query('CREATE TRIGGER e23_fail BEFORE INSERT ON travel_map.domain_audit_events FOR EACH ROW EXECUTE FUNCTION public.e23_audit_fail()');
      try {
        const response = await request(`/api/v1/projects/${f.project}/members/${member.id}`, owner, 'DELETE'); assert.equal(response.status, 503);
        assert.ok(!(await response.text()).includes('synthetic failure'));
        assert.equal((await sql.query("SELECT count(*)::int n FROM travel_map.trip_memberships WHERE trip_id=ANY($1::uuid[]) AND user_id=$2 AND status='active'", [[f.trip, f.second], member.id])).rows[0].n, 2);
        assert.equal((await request(`/api/v1/trips/${f.trip}`, member)).status, 200);
        assert.equal((await sql.query('SELECT count(*)::int n FROM travel_map.domain_audit_events WHERE resource_id=$1', [f.project])).rows[0].n, 0);
      } finally { await sql.query('DROP TRIGGER e23_fail ON travel_map.domain_audit_events'); await sql.query('DROP FUNCTION public.e23_audit_fail()'); }
    });
    await t.test('audit is append-only, transactional, bounded to non-sensitive server-built transitions', async () => {
      const f = await fixture();
      await rpc.query('BEGIN'); await call(owner, 'collaboration.promote', { id: f.project, userId: member.id }); await rpc.query('ROLLBACK');
      assert.equal((await sql.query('SELECT count(*)::int n FROM travel_map.domain_audit_events WHERE resource_id=$1', [f.project])).rows[0].n, 0);
      await sql.query(`SET ROLE ${ownerRole}`);
      try { for (const statement of ['UPDATE travel_map.domain_audit_events SET action=action', 'DELETE FROM travel_map.domain_audit_events', 'TRUNCATE travel_map.domain_audit_events']) await assert.rejects(sql.query(statement), { code: '42501' }); } finally { await sql.query('RESET ROLE'); }
      const events = (await sql.query('SELECT action,metadata FROM travel_map.domain_audit_events')).rows;
      assert.ok(events.length > 20);
      const allowed = new Set(['targetUserId', 'previousRole', 'newRole', 'revokedTripGrants', 'nameChanged', 'previousPolicy', 'newPolicy', 'previousStatus', 'newStatus']);
      for (const event of events) assert.ok(Object.keys(event.metadata).every(key => allowed.has(key)));
      const serializedEvents = JSON.stringify(events);
      for (const secret of [owner.token, owner.hash, owner.csrf, 'Private name sentinel', 'Retained Trip', 'latitude', 'email', 'csrf', 'invitation']) assert.ok(!serializedEvents.includes(secret));
      assert.ok(events.some(e => e.metadata.revokedTripGrants === 2));
    });
    await t.test('FORCE RLS, owner ACLs and exactly four runtime RPCs; private helpers/tables inaccessible', async () => {
      const tables = await sql.query("SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity,pg_get_userbyid(c.relowner) owner FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='travel_map' AND c.relkind='r'");
      assert.equal(tables.rows.length, 11); assert.ok(tables.rows.every(r => r.relrowsecurity && r.relforcerowsecurity && r.owner === ownerRole));
      for (const table of tables.rows) await assert.rejects(rpc.query(`SELECT * FROM travel_map.${table.relname}`), { code: '42501' });
      const executable = await sql.query("SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='travel_map' AND has_function_privilege($1,p.oid,'EXECUTE') ORDER BY p.proname", [apiRole]);
      assert.deepEqual(executable.rows.map(r => r.proname), ['api_call', 'login_complete', 'oauth_begin', 'oauth_consume']);
      await assert.rejects(rpc.query("SELECT travel_map.collaboration_action($1,'collaboration.archive',$2)", [owner.id, JSON.stringify({ id: before.project })]), { code: '42501' });
      const helpers = await sql.query("SELECT proconfig,prosecdef,pg_get_userbyid(proowner) owner FROM pg_proc WHERE oid IN ('travel_map.collaboration_action(uuid,text,jsonb)'::regprocedure,'travel_map.audit_append_only()'::regprocedure)");
      assert.ok(helpers.rows.every(r => !r.prosecdef && r.owner === ownerRole && r.proconfig.includes('search_path=pg_catalog') && r.proconfig.includes('TimeZone=UTC')));
    });
    await t.test('workerd executes real E2.3 PostgreSQL authorization, settings, departure and logout', async () => {
      const f = await fixture();
      const harness = createTestHarness({ workers: [{ configPath: new URL('../wrangler.jsonc', import.meta.url).pathname, env: 'test', prebuiltWorkerDir: new URL('../dist/', import.meta.url).pathname,
        vars: { APP_ENV: 'test', APP_ORIGIN: env.APP_ORIGIN!, SUPABASE_URL: env.SUPABASE_URL! }, secrets: { DATABASE_URL: apiUrl.toString(), SUPABASE_PUBLISHABLE_KEY: 'synthetic-public', OAUTH_COOKIE_KEY: env.OAUTH_COOKIE_KEY! } }] });
      await harness.listen();
      const fetch = (path: string, actor: Actor, method = 'GET', data?: unknown) => harness.fetch(new URL(path, env.APP_ORIGIN).toString(), { method, headers: headers(actor, method, data), ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
      try {
        assert.equal((await fetch(`/api/v1/projects/${f.project}/members`, owner)).status, 200);
        assert.equal((await fetch(`/api/v1/projects/${f.project}`, adminActor, 'PATCH', { name: 'Native Worker' })).status, 200);
        assert.equal((await fetch(`/api/v1/projects/${f.project}/members/${member.id}/promote-admin`, owner, 'POST')).status, 204);
        assert.equal((await fetch(`/api/v1/projects/${f.project}/archive`, adminActor, 'POST')).status, 403);
        assert.equal((await fetch(`/api/v1/projects/${f.project}/leave`, member, 'POST')).status, 204);
        assert.equal((await fetch(`/api/v1/visits/${f.visit}`, member)).status, 404);
        const session = await seed('native logout');
        assert.equal((await fetch('/api/v1/auth/logout', session, 'POST')).status, 204);
        assert.equal((await fetch('/api/v1/me', session)).status, 401);
      } finally { await harness.close(); }
    });
    await t.test('disposable down restores exact E2.2 dispatcher/ACL without undoing legitimate membership states; reapply works', async () => {
      const f = await fixture(); await call(owner, 'collaboration.remove', { id: f.project, userId: member.id });
      assert.deepEqual(await owned('down'), ['0005_membership_management']); assert.deepEqual(await fingerprint(), original);
      assert.equal((await sql.query('SELECT status FROM travel_map.project_memberships WHERE project_id=$1 AND user_id=$2', [f.project, member.id])).rows[0].status, 'revoked');
      assert.equal((await request(`/api/v1/visits/${f.visit}`, owner)).status, 200);
      assert.deepEqual(await owned('up'), ['0005_membership_management']);
      assert.equal((await request(`/api/v1/projects/${f.project}/members`, owner)).status, 200);
    });
    await t.test('down refuses non-test database names without touching persistent databases', async () => {
      const guardName = `travel_map_guard_${suffix}`; await admin.query(`CREATE DATABASE ${guardName} OWNER ${ownerRole}`); guardDatabases.push(guardName);
      const guardUrl = new URL(url); guardUrl.pathname = `/${guardName}`; const guard = new pg.Client({ connectionString: guardUrl.toString() }); await guard.connect();
      try { await guard.query(`SET ROLE ${ownerRole}`); await migrate(guard, 'up', all); await assert.rejects(migrate(guard, 'down', all), { code: '42501' }); assert.equal((await guard.query('SELECT count(*)::int n FROM travel_map_migrations.applied')).rows[0].n, 5); } finally { await guard.end(); }
    });
    await t.test('full reverse/reapply on generated disposable data preserves original migration checksums', async () => {
      for (let i = 0; i < 5; i++) assert.equal((await owned('down')).length, 1);
      assert.equal((await sql.query("SELECT to_regnamespace('travel_map') x")).rows[0].x, null);
      assert.equal((await owned('up')).length, 5);
      const ledger = (await sql.query('SELECT version,checksum FROM travel_map_migrations.applied ORDER BY version')).rows;
      assert.deepEqual(ledger, all.map(({ version, checksum }) => ({ version, checksum })));
    });
  } finally {
    await runtime?.end(); await db?.end();
    for (const name of guardDatabases) await admin.query(`DROP DATABASE ${name}`);
    if (created) await admin.query(`DROP DATABASE ${database}`);
    for (const role of roles.reverse()) await admin.query(`DROP ROLE ${role}`);
    await admin.end();
  }
});
