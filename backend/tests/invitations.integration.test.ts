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
test('E2.4 invitations: native security, lifecycle and concurrency', { skip: !supplied ? 'Run db:local:test with PG_BIN' : false }, async t => {
  const base = new URL(localDatabaseUrl(supplied, process.env.LOCAL_DATABASE_ONLY));
  assert.match(base.pathname, /^\/travel_map_test_[a-z0-9_]+$/);
  const suffix = randomUUID().replaceAll('-', ''), database = `travel_map_test_${suffix}`, ownerRole = `e24_owner_${suffix}`, apiRole = `e24_api_${suffix}`;
  const adminUrl = new URL(base); adminUrl.pathname = '/postgres';
  const admin = new pg.Client({ connectionString: adminUrl.toString() }); await admin.connect();
  let db: pg.Client | undefined, runtime: pg.Client | undefined, created = false;
  const roles: string[] = [], guardDatabases: string[] = [];
  try {
    await admin.query(`CREATE ROLE ${ownerRole} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT`); roles.push(ownerRole);
    await admin.query(`CREATE DATABASE ${database} OWNER ${ownerRole}`); created = true;
    const url = new URL(base); url.pathname = `/${database}`;
    db = new pg.Client({ connectionString: url.toString() }); await db.connect(); const sql = db;
    const all = (await loadMigrations()).slice(0, 6), previous = all.slice(0, 5), migration = all[5]; assert.ok(migration); assert.equal(all.length, 6);
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
    const f = await fixture();
    assert.equal((await request(`/api/v1/projects/${f.project}`, owner, 'PATCH', { name: 'Populated E23 audit' })).status, 200);
    const oldAudit = (await sql.query('SELECT count(*)::int n FROM travel_map.domain_audit_events')).rows[0].n;
    const original = (await sql.query("SELECT pg_get_functiondef(oid) d,proacl::text acl,proowner FROM pg_proc WHERE oid='travel_map.api_call(text,text,jsonb)'::regprocedure")).rows[0];
    await t.test('migration ownership and failure atomicity preserve prior schema and audit', async () => {
      await assert.rejects(migrate(sql, 'up'), { code: '42501' });
      await assert.rejects(owned('up', [...previous, { ...migration, checksum: 'failure', up: migration.up + '\nSELECT missing_e24();' }]), { code: '42883' });
      assert.equal((await sql.query("SELECT to_regclass('travel_map.invitations') x")).rows[0].x, null);
      assert.equal((await sql.query('SELECT count(*)::int n FROM travel_map.domain_audit_events')).rows[0].n, oldAudit);
      assert.deepEqual(await owned('up'), ['0006_invitations']);
      assert.equal((await request(`/api/v1/visits/${f.visit}`, member)).status, 200);
    });
    const issue = async (actor: Actor = owner, trip = false) => {
      const r = await request(`/api/v1/${trip ? 'trips/' + f.trip : 'projects/' + f.project}/invitations`, actor, 'POST'); assert.equal(r.status, 201);
      const dto = await r.json() as { id: string; invitationUrl: string; createdAt: string; expiresAt: string };
      const token = new URL(dto.invitationUrl).hash.slice(1); assert.equal(token.length, 43); return { ...dto, token, hash: await digest(token) };
    };
    const redeem = (actor: Actor, token: string) => request('/api/v1/invitations/redeem', actor, 'POST', { token });
    await t.test('Owner/Admin issue Project/Trip invitations, fixed expiry, digest-only storage and safe listing', async () => {
      const secrets = new Set<string>();
      for (const actor of [owner, adminActor]) for (const trip of [false, true]) {
        const i = await issue(actor, trip); secrets.add(i.token); assert.equal(Date.parse(i.expiresAt) - Date.parse(i.createdAt), 604800000);
        const row = (await sql.query('SELECT row_to_json(i)::text body,token_digest FROM travel_map.invitations i WHERE id=$1', [i.id])).rows[0]; assert.equal(row.token_digest, i.hash); assert.ok(!row.body.includes(i.token));
        const list = await request(`/api/v1/projects/${f.project}/invitations?limit=1`, actor); assert.equal(list.status, 200); const text = await list.text(); assert.ok(!text.includes(i.token) && !text.includes(i.hash) && !text.includes('invitationUrl'));
      }
      assert.equal(secrets.size, 4);
    });
    await t.test('Member/Guest/outsider cannot issue/list/revoke; privileged bodies rejected', async () => {
      const i = await issue();
      for (const actor of [member, guest, foreign]) {
        for (const [path, method] of [[`/api/v1/projects/${f.project}/invitations`, 'POST'], [`/api/v1/projects/${f.project}/invitations`, 'GET'], [`/api/v1/projects/${f.project}/invitations/${i.id}/revoke`, 'POST']]) assert.equal((await request(path!, actor, method!)).status, actor === member ? 403 : 404);
      }
      for (const data of [{ role: 'admin' }, { expiresIn: 1 }, { tripId: f.trip }, { ownerId: owner.id }]) assert.equal((await request(`/api/v1/projects/${f.project}/invitations`, owner, 'POST', data)).status, 400);
    });
    await t.test('Project redemption grants Member inheritance, one consumption and no stale replay after removal', async () => {
      const recipient = await seed('recipient'), i = await issue();
      assert.equal((await redeem(recipient, i.token)).status, 200);
      for (const trip of [f.trip, f.second]) assert.equal((await request(`/api/v1/trips/${trip}`, recipient)).status, 200);
      assert.equal((await sql.query('SELECT role FROM travel_map.project_memberships WHERE project_id=$1 AND user_id=$2', [f.project, recipient.id])).rows[0].role, 'member');
      assert.equal((await redeem(recipient, i.token)).status, 400);
      await request(`/api/v1/projects/${f.project}/members/${recipient.id}`, owner, 'DELETE');
      assert.equal((await redeem(recipient, i.token)).status, 400); assert.equal((await request(`/api/v1/trips/${f.trip}`, recipient)).status, 404);
      const fresh = await issue(); assert.equal((await redeem(recipient, fresh.token)).status, 200);
    });
    await t.test('existing Owner/Admin/Member and Guest access consumes without duplication or role change', async () => {
      for (const actor of [owner, adminActor, member, guest]) {
        const i = await issue(owner, actor === guest);
        const response = await redeem(actor, i.token); assert.equal(response.status, 200); assert.equal((await response.json() as { result: string }).result, 'already_has_access');
        assert.equal((await redeem(actor, i.token)).status, 400);
      }
      assert.equal((await sql.query('SELECT role FROM travel_map.project_memberships WHERE project_id=$1 AND user_id=$2', [f.project, adminActor.id])).rows[0].role, 'admin');
      assert.equal((await sql.query('SELECT count(*)::int n FROM travel_map.project_memberships WHERE project_id=$1 AND user_id=$2', [f.project, owner.id])).rows[0].n, 0);
    });
    await t.test('Trip redemption grants only Guest; minimal visible authors, no Project or participant context', async () => {
      const actor = await seed('Trip recipient'), i = await issue(owner, true); assert.equal((await redeem(actor, i.token)).status, 200);
      for (const path of [`/api/v1/projects/${f.project}`, `/api/v1/projects/${f.project}/map`, `/api/v1/projects/${f.project}/members`, `/api/v1/trips/${f.second}`, `/api/v1/trips/${f.trip}/members`]) assert.equal((await request(path, actor)).status, 404);
      const visit = await request(`/api/v1/visits/${f.visit}`, actor); assert.equal(visit.status, 200); const text = await visit.text(); assert.ok(!text.includes('email') && !text.includes('displayName'));
    });
    await t.test('invalid/expired/revoked links share safe errors; consumed revocation preserves membership', async () => {
      const actor = await seed('invalid recipient');
      const expired = await issue(); await sql.query("UPDATE travel_map.invitations SET created_at=now()-interval '8 days',expires_at=now()-interval '1 day' WHERE id=$1", [expired.id]);
      const revoked = await issue(); assert.equal((await request(`/api/v1/projects/${f.project}/invitations/${revoked.id}/revoke`, adminActor, 'POST')).status, 204);
      for (const token of [randomToken(), expired.token, revoked.token]) { const r = await redeem(actor, token); assert.equal(r.status, 400); assert.equal((await r.json() as { error: { code: string } }).error.code, 'INVITATION_INVALID'); }
      const used = await issue(); await redeem(actor, used.token); assert.equal((await request(`/api/v1/projects/${f.project}/invitations/${used.id}/revoke`, owner, 'POST')).status, 409);
      assert.equal((await request(`/api/v1/trips/${f.trip}`, actor)).status, 200);
    });
    await t.test('session, Origin and CSRF checks apply to redemption', async () => {
      const i = await issue();
      assert.equal((await request('/api/v1/invitations/redeem', owner, 'POST', { token: i.token }, { Cookie: '' })).status, 401);
      for (const header of [{ Origin: 'https://evil.invalid' }, { 'X-CSRF-Token': 'wrong' }]) assert.equal((await request('/api/v1/invitations/redeem', owner, 'POST', { token: i.token }, header)).status, 403);
    });
    const serialized = async (actor: Actor, action: string, data: unknown, following: () => Promise<Response>) => {
      const first = new pg.Client({ connectionString: apiUrl.toString() }); await first.connect(); let pending: Promise<Response> | undefined;
      try { await first.query('BEGIN'); const result = (await first.query('SELECT travel_map.api_call($1,$2,$3) r', [actor.hash, action, JSON.stringify(data)])).rows[0].r; assert.ok(!result.error, result.error);
        pending = following(); let blocked = false;
        for (let n = 0; n < 300; n++) { await sql.query('SELECT pg_stat_clear_snapshot()'); if ((await sql.query("SELECT count(*)::int n FROM pg_stat_activity WHERE datname=current_database() AND application_name='travel-map-api' AND wait_event_type='Lock'")).rows[0].n) { blocked = true; break; } await new Promise(r => setTimeout(r, 10)); }
        assert.ok(blocked); await first.query('COMMIT'); return await pending;
      } finally { await first.query('ROLLBACK'); await first.end(); if (pending) await pending; }
    };
    await t.test('independent concurrent redemption consumes once', async () => {
      const a = await seed('race A'), b = await seed('race B'), i = await issue();
      assert.equal((await serialized(a, 'invitations.redeem', { tokenDigest: i.hash }, () => redeem(b, i.token))).status, 400);
      assert.equal((await sql.query('SELECT redeemed_by FROM travel_map.invitations WHERE id=$1', [i.id])).rows[0].redeemed_by, a.id);
    });
    await t.test('revoke/redemption races serialize in both orders', async () => {
      const actor = await seed('race revoke'); let i = await issue();
      assert.equal((await serialized(owner, 'invitations.revoke', { projectId: f.project, id: i.id }, () => redeem(actor, i.token))).status, 400);
      i = await issue(); assert.equal((await serialized(actor, 'invitations.redeem', { tokenDigest: i.hash }, () => request(`/api/v1/projects/${f.project}/invitations/${i.id}/revoke`, owner, 'POST'))).status, 409);
    });
    await t.test('redemption and member removal serialize; consumed invitation cannot resurrect access', async () => {
      const actor = await seed('removed invitee'), i = await issue();
      assert.equal((await serialized(actor, 'invitations.redeem', { tokenDigest: i.hash }, () => request(`/api/v1/projects/${f.project}/members/${actor.id}`, owner, 'DELETE'))).status, 204);
      assert.equal((await redeem(actor, i.token)).status, 400);
      assert.equal((await request(`/api/v1/trips/${f.trip}`, actor)).status, 404);
    });
    await t.test('issuer demotion racing redemption fails closed', async () => {
      const i = await issue(adminActor), actor = await seed('demoted issuer recipient');
      assert.equal((await serialized(owner, 'collaboration.demote', { id: f.project, userId: adminActor.id }, () => redeem(actor, i.token))).status, 400);
      await request(`/api/v1/projects/${f.project}/members/${adminActor.id}/promote-admin`, owner, 'POST');
    });
    await t.test('audit failure atomically rolls back consumption and membership', async () => {
      const i = await issue(), actor = await seed('failure recipient');
      await sql.query("CREATE FUNCTION public.e24_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic'; END; $$");
      await sql.query('CREATE TRIGGER e24_fail BEFORE INSERT ON travel_map.domain_audit_events FOR EACH ROW EXECUTE FUNCTION public.e24_fail()');
      try { assert.equal((await redeem(actor, i.token)).status, 503); assert.equal((await sql.query('SELECT redeemed_at FROM travel_map.invitations WHERE id=$1', [i.id])).rows[0].redeemed_at, null); assert.equal((await sql.query('SELECT count(*)::int n FROM travel_map.project_memberships WHERE project_id=$1 AND user_id=$2', [f.project, actor.id])).rows[0].n, 0); }
      finally { await sql.query('DROP TRIGGER e24_fail ON travel_map.domain_audit_events'); await sql.query('DROP FUNCTION public.e24_fail()'); }
    });
    await t.test('bounded per-account rate limit and direct RPC mass assignment denial', async () => {
      const actor = await seed('rate limited');
      for (let n = 0; n < 30; n++) assert.equal((await redeem(actor, randomToken())).status, 400);
      assert.equal((await redeem(actor, randomToken())).status, 429);
      const result = (await rpc.query('SELECT travel_map.api_call($1,$2,$3) r', [owner.hash, 'invitations.create', JSON.stringify({ projectId: f.project, tokenDigest: 'a'.repeat(64), role: 'admin' })])).rows[0].r;
      assert.equal(result.error, 'VALIDATION_ERROR');
      const rls = (await sql.query("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid IN ('travel_map.invitations'::regclass,'travel_map.invitation_attempts'::regclass)")).rows; assert.ok(rls.every(x => x.relrowsecurity && x.relforcerowsecurity));
    });
    await t.test('fresh invitation rejoins revoked Admin as ordinary Member and preserves inherited Trip access', async () => {
      const actor = await seed('former Admin');
      await sql.query("INSERT INTO travel_map.project_memberships(project_id,user_id,role,status,revoked_at) VALUES($1,$2,'admin','revoked',clock_timestamp())", [f.project, actor.id]);
      const i = await issue(); assert.equal((await redeem(actor, i.token)).status, 200);
      assert.equal((await sql.query('SELECT role FROM travel_map.project_memberships WHERE project_id=$1 AND user_id=$2', [f.project, actor.id])).rows[0].role, 'member');
      const trip = await issue(owner, true); assert.equal((await (await redeem(actor, trip.token)).json() as { result: string }).result, 'already_has_access');
      assert.equal((await sql.query('SELECT count(*)::int n FROM travel_map.trip_memberships WHERE trip_id=$1 AND user_id=$2', [f.trip, actor.id])).rows[0].n, 0);
    });
    await t.test('archival blocks queued redemption, preserving audit history', async () => {
      const i = await issue(), actor = await seed('archived recipient');
      assert.equal((await serialized(owner, 'collaboration.archive', { id: f.project }, () => redeem(actor, i.token))).status, 400);
    });
    await t.test('runtime isolation, audit privacy and append-only controls', async () => {
      for (const table of ['invitations', 'invitation_attempts']) await assert.rejects(rpc.query(`SELECT * FROM travel_map.${table}`), { code: '42501' });
      const functions = (await sql.query("SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='travel_map' AND has_function_privilege($1,p.oid,'EXECUTE') ORDER BY proname", [apiRole])).rows.map(x => x.proname); assert.deepEqual(functions, ['api_call', 'login_complete', 'oauth_begin', 'oauth_consume']);
      const events = JSON.stringify((await sql.query('SELECT * FROM travel_map.domain_audit_events')).rows); const tokens = (await sql.query('SELECT token_digest FROM travel_map.invitations')).rows; for (const token of tokens) assert.ok(!events.includes(token.token_digest));
      await assert.rejects(sql.query('DELETE FROM travel_map.domain_audit_events'), { code: '42501' });
    });
    await t.test('workerd exposes secure fragment landing and real PostgreSQL invitation routes', async () => {
      const fresh = await fixture();
      const harness = createTestHarness({ workers: [{ configPath: new URL('../wrangler.jsonc', import.meta.url).pathname, env: 'test', prebuiltWorkerDir: new URL('../dist/', import.meta.url).pathname, vars: { APP_ENV: 'test', APP_ORIGIN: env.APP_ORIGIN!, SUPABASE_URL: env.SUPABASE_URL! }, secrets: { DATABASE_URL: apiUrl.toString(), SUPABASE_PUBLISHABLE_KEY: 'synthetic-public', OAUTH_COOKIE_KEY: env.OAUTH_COOKIE_KEY! } }] }); await harness.listen();
      try { const landing = await harness.fetch(new URL('/invite', env.APP_ORIGIN).toString()); assert.equal(landing.status, 200); assert.ok(landing.headers.get('Content-Security-Policy')!.includes("default-src 'none'"));
        const r = await harness.fetch(new URL(`/api/v1/projects/${fresh.project}/invitations`, env.APP_ORIGIN).toString(), { method: 'POST', headers: headers(owner, 'POST') }); assert.equal(r.status, 201);
      } finally { await harness.close(); }
    });
    await t.test('down restores exact dispatcher and preserves membership/audit transitions, then reapply', async () => {
      const count = (await sql.query('SELECT count(*)::int n FROM travel_map.domain_audit_events')).rows[0].n;
      await owned('down'); const after = (await sql.query("SELECT pg_get_functiondef(oid) d,proacl::text acl,proowner FROM pg_proc WHERE oid='travel_map.api_call(text,text,jsonb)'::regprocedure")).rows[0]; assert.deepEqual(after, original);
      assert.equal((await sql.query('SELECT count(*)::int n FROM travel_map.domain_audit_events')).rows[0].n, count); await owned('up');
    });
    await t.test('non-test-name down guard and complete disposable reverse/reapply chain', async () => {
      const name = `travel_map_guard_${suffix}`; await admin.query(`CREATE DATABASE ${name} OWNER ${ownerRole}`); guardDatabases.push(name);
      const guardUrl = new URL(url); guardUrl.pathname = `/${name}`; const guard = new pg.Client({ connectionString: guardUrl.toString() }); await guard.connect();
      try { await guard.query(`SET ROLE ${ownerRole}`); await migrate(guard, 'up', all); await assert.rejects(migrate(guard, 'down', all), { code: '42501' }); } finally { await guard.end(); }
      for (let n = 0; n < 6; n++) await owned('down'); assert.equal((await sql.query("SELECT to_regnamespace('travel_map') x")).rows[0].x, null);
      assert.equal((await owned('up')).length, 6);
    });
  } finally { await runtime?.end(); await db?.end(); for (const name of guardDatabases) await admin.query(`DROP DATABASE ${name}`); if (created) await admin.query(`DROP DATABASE ${database}`); for (const role of roles.reverse()) await admin.query(`DROP ROLE ${role}`); await admin.end(); }
});
