import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { test } from 'node:test';
import pg from 'pg';
import { createTestHarness } from 'wrangler';
import { handleRequest } from '../src/app.ts';
import type { AppEnv } from '../src/env.ts';
import { csrf, digest, randomToken, SESSION_COOKIE } from '../src/modules/identity/security.ts';
import { loadMigrations, localDatabaseUrl, migrate } from '../scripts/migrations.ts';
import type { Migration } from '../scripts/migrations.ts';
import type { Visit, Place, MapItem } from '../src/modules/geography/types.ts';
interface Actor { id: string; token: string; hash: string; csrf: string }
interface Page<T> { items: T[]; nextCursor: string | null }
const supplied = process.env.DATABASE_URL;
test('E2.2 geography: populated E2.1 upgrade, native SQL/HTTP, privacy and migration safety', { skip: !supplied ? 'Run db:local:test with PG_BIN' : false }, async t => {
  const base = new URL(localDatabaseUrl(supplied, process.env.LOCAL_DATABASE_ONLY));
  assert.match(base.pathname, /^\/travel_map_test_[a-z0-9_]+$/, 'Disposable test base required');
  const suffix = randomUUID().replaceAll('-', ''), database = `travel_map_test_${suffix}`, ownerRole = `e22_owner_${suffix}`, apiRole = `e22_api_${suffix}`;
  const adminUrl = new URL(base); adminUrl.pathname = '/postgres';
  const admin = new pg.Client({ connectionString: adminUrl.toString() }); await admin.connect();
  let db: pg.Client | undefined, runtime: pg.Client | undefined, created = false;
  const roles: string[] = [];
  const guardDatabases: string[] = [];
  try {
    await admin.query(`CREATE ROLE ${ownerRole} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT`); roles.push(ownerRole);
    await admin.query(`CREATE DATABASE ${database} OWNER ${ownerRole}`); created = true;
    const url = new URL(base); url.pathname = `/${database}`;
    db = new pg.Client({ connectionString: url.toString() }); await db.connect(); const sql = db;
    const all = (await loadMigrations()).slice(0, 4), previous = all.slice(0, 3), migration = all[3]; assert.ok(migration); assert.equal(all.length, 4);
    const owned = async (direction: 'up' | 'down', set: Migration[] = all) => { await sql.query(`SET ROLE ${ownerRole}`); try { return await migrate(sql, direction, set); } finally { await sql.query('RESET ROLE'); } };
    await owned('up', previous);
    await admin.query(`CREATE ROLE ${apiRole} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT`); roles.push(apiRole);
    await sql.query(`GRANT USAGE ON SCHEMA travel_map TO ${apiRole}`);
    await sql.query(`GRANT EXECUTE ON FUNCTION travel_map.oauth_begin(text,text),travel_map.oauth_consume(text),travel_map.login_complete(text,jsonb,text,text),travel_map.api_call(text,text,jsonb) TO ${apiRole}`);
    const apiUrl = new URL(url); apiUrl.username = apiRole; apiUrl.password = '';
    runtime = new pg.Client({ connectionString: apiUrl.toString() }); await runtime.connect(); const rpc = runtime;
    const env: AppEnv = { APP_ENV: 'test', APP_ORIGIN: 'https://app.example.invalid', SUPABASE_URL: 'http://127.0.0.1:59999', SUPABASE_PUBLISHABLE_KEY: 'synthetic-public', DATABASE_URL: apiUrl.toString(), OAUTH_COOKIE_KEY: 'c'.repeat(64) };
    const seed = async (name: string): Promise<Actor> => { const id = randomUUID(), token = randomToken(), hash = await digest(token);
      await sql.query('INSERT INTO travel_map.users(id,supabase_auth_user_id,display_name) VALUES($1,$2,$3)', [id, randomUUID(), `Synthetic ${name}`]);
      await sql.query("INSERT INTO travel_map.app_sessions(user_id,token_digest,expires_at,idle_expires_at) VALUES($1,$2,now()+interval '1 day',now()+interval '30 minutes')", [id, hash]);
      return { id, token, hash, csrf: await csrf(token) }; };
    const owner = await seed('owner'), adminActor = await seed('admin'), member = await seed('member'), otherMember = await seed('other member'), guest = await seed('guest'), foreign = await seed('foreign');
    const parent = randomUUID(), otherParent = randomUUID(), trip = randomUUID(), secondTrip = randomUUID(), foreignTrip = randomUUID();
    await sql.query('INSERT INTO travel_map.projects(id,owner_user_id,name) VALUES($1,$2,$3),($4,$5,$3)', [parent, owner.id, 'Colombia project', otherParent, foreign.id]);
    for (const [actor, role] of [[adminActor, 'admin'], [member, 'member'], [otherMember, 'member']] as const) await sql.query('INSERT INTO travel_map.project_memberships(project_id,user_id,role) VALUES($1,$2,$3)', [parent, actor.id, role]);
    for (const [id, project, actor] of [[trip, parent, owner.id], [secondTrip, parent, member.id], [foreignTrip, otherParent, foreign.id]]) await sql.query('INSERT INTO travel_map.trips(id,project_id,created_by_user_id,name) VALUES($1,$2,$3,$4)', [id, project, actor, 'Colombia Trip']);
    await sql.query('INSERT INTO travel_map.trip_memberships(trip_id,user_id) VALUES($1,$2)', [trip, guest.id]);
    const call = async (actor: Actor, action: string, data: unknown = {}) => (await rpc.query('SELECT travel_map.api_call($1,$2,$3) AS result', [actor.hash, action, JSON.stringify(data)])).rows[0].result;
    const request = (path: string, actor?: Actor, method = 'GET', data?: unknown, headers: Record<string, string> = {}) => handleRequest(new Request(new URL(path, env.APP_ORIGIN), { method,
      headers: { ...(actor ? { Cookie: `${SESSION_COOKIE}=${actor.token}` } : {}), ...(!['GET', 'HEAD'].includes(method) && actor ? { Origin: env.APP_ORIGIN!, 'X-CSRF-Token': actor.csrf } : {}), ...(data === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) }), env);
    const fingerprint = async () => (await sql.query("SELECT pg_get_functiondef(oid) AS definition,proacl::text AS acl,proowner::text AS owner FROM pg_proc WHERE oid='travel_map.api_call(text,text,jsonb)'::regprocedure")).rows[0];
    const original = await fingerprint();
    await t.test('wrong owner, weakened RLS and direct ACL drift fail before mutation', async () => {
      await assert.rejects(migrate(sql, 'up'), { code: '42501' });
      await sql.query('ALTER TABLE travel_map.trips NO FORCE ROW LEVEL SECURITY'); try { await assert.rejects(owned('up'), { code: '42501' }); } finally { await sql.query('ALTER TABLE travel_map.trips FORCE ROW LEVEL SECURITY'); }
      await sql.query(`GRANT SELECT ON travel_map.trips TO ${apiRole}`); try { await assert.rejects(owned('up'), { code: '42501' }); } finally { await sql.query(`REVOKE SELECT ON travel_map.trips FROM ${apiRole}`); }
      await sql.query('ALTER FUNCTION travel_map.trips_action(uuid,text,jsonb) RESET search_path');
      try { await assert.rejects(owned('up'), { code: '42501' }); } finally { await sql.query('ALTER FUNCTION travel_map.trips_action(uuid,text,jsonb) SET search_path=pg_catalog'); }
      await sql.query(`GRANT EXECUTE ON FUNCTION travel_map.trips_action(uuid,text,jsonb) TO ${apiRole}`);
      try { await assert.rejects(owned('up'), { code: '42501' }); } finally { await sql.query(`REVOKE EXECUTE ON FUNCTION travel_map.trips_action(uuid,text,jsonb) FROM ${apiRole}`); }
      assert.equal((await sql.query("SELECT to_regclass('travel_map.visits') AS x")).rows[0].x, null); assert.deepEqual(await fingerprint(), original);
    });
    await t.test('failed DDL and unsafe default helper ACL roll back schema, catalog, dispatcher and ledger', async () => {
      await assert.rejects(owned('up', [...previous, { ...migration, checksum: 'failure-injection', up: `${migration.up}\nSELECT missing_e22_function();` }]), { code: '42883' });
      await sql.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${ownerRole} IN SCHEMA travel_map GRANT EXECUTE ON FUNCTIONS TO ${apiRole}`);
      try { await assert.rejects(owned('up'), { code: '42501' }); } finally { await sql.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${ownerRole} IN SCHEMA travel_map REVOKE EXECUTE ON FUNCTIONS FROM ${apiRole}`); }
      assert.equal((await sql.query("SELECT to_regclass('travel_map.places') AS x")).rows[0].x, null); assert.deepEqual(await fingerprint(), original); assert.equal((await sql.query('SELECT count(*)::int AS n FROM travel_map_migrations.applied')).rows[0].n, 3);
    });
    await t.test('forward upgrade preserves populated E2.1 Project/Trip/membership/session and RPC ownership', async () => {
      assert.deepEqual(await owned('up'), ['0004_places_visits']);
      assert.equal((await request(`/api/v1/trips/${trip}`, guest)).status, 200); assert.equal((await request('/api/v1/me', owner)).status, 200);
      const changed = await fingerprint(); assert.equal(changed.owner, original.owner); assert.equal(changed.acl, original.acl);
    });
    const places = (await sql.query('SELECT id,locality,country_code,source_id FROM travel_map.places')).rows;
    const catalog = JSON.parse(await readFile(new URL('../catalog/geonames-subset.json', import.meta.url), 'utf8')) as { places: { id: string; sourceId: string; latitude: number; longitude: number }[] };
    for (const expected of catalog.places) {
      const actual = (await sql.query('SELECT id,source_id,approximate_latitude,approximate_longitude FROM travel_map.places WHERE id=$1', [expected.id])).rows[0];
      assert.deepEqual(actual, { id: expected.id, source_id: expected.sourceId, approximate_latitude: expected.latitude, approximate_longitude: expected.longitude });
    }
    const bogota = places.find(p => p.source_id === '3688689')!.id as string, istanbul = places.find(p => p.source_id === '745044')!.id as string;
    const springfields = places.filter(p => p.locality === 'Springfield');
    const create = async (actor: Actor, tripId: string, placeId = bogota, date?: unknown): Promise<Visit> => { const r = await request(`/api/v1/trips/${tripId}/visits`, actor, 'POST', { placeId, ...(date ? { date } : {}) }); assert.equal(r.status, 201); return await r.json() as Visit; };
    let ownerVisit: Visit, memberVisit: Visit, guestVisit: Visit, singleVisit: Visit, rangeVisit: Visit;
    await t.test('controlled independently sourced catalog supports homonyms, bounded search and no implicit resolver', async () => {
      assert.equal(springfields.length, 2); assert.notEqual(springfields[0].id, springfields[1].id); assert.notEqual(springfields[0].source_id, springfields[1].source_id);
      const response = await request('/api/v1/places?countryCode=USA&query=Springfield&limit=1', guest); assert.equal(response.status, 200); const page = await response.json() as Page<Place>; assert.equal(page.items.length, 1); assert.ok(page.nextCursor);
      const next = await request(`/api/v1/places?countryCode=USA&query=Springfield&limit=1&cursor=${encodeURIComponent(page.nextCursor!)}`, guest); assert.notEqual((await next.json() as Page<Place>).items[0]!.id, page.items[0]!.id);
      assert.equal((await request('/api/v1/places?countryCode=ZZZ', owner)).status, 400); assert.equal((await request('/api/v1/places?countryCode=CO', owner)).status, 400);
      assert.equal((await request('/api/v1/places?countryCode=COL&query=not-in-catalog', owner)).status, 200);
      assert.equal((await request('/api/v1/places?countryCode=COL')).status, 401);
      assert.equal((await request(`/api/v1/trips/${trip}/visits`, owner, 'POST', { place: { city: 'Springfield', countryCode: 'USA' } })).status, 400);
    });
    let catalogBefore: unknown;
    await t.test('Owner/Admin/Member/Guest create independent Visits; repeated Place/Trip/date never merges', async () => {
      catalogBefore = await (await request('/api/v1/places?countryCode=COL', owner)).json();
      ownerVisit = await create(owner, trip); memberVisit = await create(member, trip); guestVisit = await create(guest, trip);
      const adminVisit = await create(adminActor, trip); await create(owner, secondTrip, istanbul); await create(owner, secondTrip, bogota); await create(foreign, foreignTrip);
      assert.equal(memberVisit.createdByUserId, member.id); assert.equal(guestVisit.createdByUserId, guest.id); assert.equal(adminVisit.createdByUserId, adminActor.id);
      assert.equal(new Set([ownerVisit.id, memberVisit.id, guestVisit.id]).size, 3);
      for (const actor of [owner, adminActor, member, guest]) assert.equal((await request(`/api/v1/visits/${ownerVisit.id}`, actor)).status, 200);
    });
    await t.test('no/single/range/leap dates round-trip under UTC, Istanbul and a negative-offset timezone', async () => {
      singleVisit = await create(member, trip, bogota, { mode: 'single', start: '2024-02-29', end: '2024-02-29' });
      rangeVisit = await create(owner, trip, bogota, { mode: 'range', start: '2024-02-28', end: '2024-03-01' });
      assert.deepEqual(ownerVisit.date, { mode: 'none', start: null, end: null });
      const old = process.env.TZ;
      try { for (const zone of ['UTC', 'Europe/Istanbul', 'America/Los_Angeles']) {
        process.env.TZ = zone; await rpc.query('SELECT set_config($1,$2,false)', ['TimeZone', zone]);
        const value = await call(owner, 'visits.get', { id: singleVisit.id }); assert.deepEqual(value.date, singleVisit.date);
        const viaHttp = await (await request(`/api/v1/visits/${rangeVisit.id}`, owner)).json() as Visit; assert.deepEqual(viaHttp.date, rangeVisit.date);
      } } finally { if (old === undefined) delete process.env.TZ; else process.env.TZ = old; await rpc.query("SET timezone='UTC'"); }
    });
    await t.test('API and independent SQL reject invalid dates, mass assignment and missing Place identity', async () => {
      for (const date of [{ mode: 'single', start: '2025-02-29', end: '2025-02-29' }, { mode: 'single', start: '2024-02-29', end: null }, { mode: 'range', start: '2024-03-02', end: '2024-03-01' }, { mode: 'range', start: '-infinity', end: 'infinity' }, { mode: 'none', start: null }, { mode: 'range', start: '0000-01-01', end: '0001-01-01' }]) {
        assert.equal((await request(`/api/v1/trips/${trip}/visits`, owner, 'POST', { placeId: bogota, date })).status, 400);
        assert.equal((await call(owner, 'visits.create', { tripId: trip, placeId: bogota, date })).error, 'VALIDATION_ERROR');
      }
      for (const key of ['createdByUserId', 'projectId', 'role', 'status', 'createdAt', 'exactLatitude']) assert.equal((await call(owner, 'visits.create', { tripId: trip, placeId: bogota, [key]: 'forged' })).error, 'VALIDATION_ERROR');
      assert.equal((await request(`/api/v1/trips/${trip}/visits`, owner, 'POST', { placeId: randomUUID() })).status, 400);
      assert.equal((await call(owner, 'visits.update', { id: ownerVisit.id })).error, 'VALIDATION_ERROR');
      assert.equal((await call(owner, 'visits.create', [])).error, 'VALIDATION_ERROR');
    });
    await t.test('SQL constraints enforce DATE combinations, finite coordinate pairs, FK integrity and disabled exact GPS', async () => {
      for (const values of [['single', '2024-02-29', null], ['none', '2024-02-29', null], ['range', '2024-03-02', '2024-03-01']]) await assert.rejects(sql.query('INSERT INTO travel_map.visits(trip_id,place_id,created_by_user_id,date_mode,date_start,date_end) VALUES($1,$2,$3,$4,$5,$6)', [trip, bogota, owner.id, ...values]), { code: '23514' });
      for (const [lat, lng] of [[1, null], [91, 0], [0, 181], ['NaN', 0], ['Infinity', 0], [-91, 0]]) await assert.rejects(sql.query('UPDATE travel_map.places SET approximate_latitude=$1,approximate_longitude=$2 WHERE id=$3', [lat, lng, bogota]), { code: '23514' });
      for (const [lat, lng] of [[4.7, -74.1], [1, null], [91, 0], ['NaN', 0], [0, 'Infinity']]) await assert.rejects(sql.query('UPDATE travel_map.visits SET exact_latitude=$1,exact_longitude=$2 WHERE id=$3', [lat, lng, ownerVisit.id]), { code: '23514' });
      await assert.rejects(sql.query('UPDATE travel_map.visits SET place_id=$1 WHERE id=$2', [randomUUID(), ownerVisit.id]), { code: '23503' });
      await assert.rejects(sql.query('DELETE FROM travel_map.places WHERE id=$1', [bogota]), { code: '23503' });
      await assert.rejects(sql.query('DELETE FROM travel_map.trips WHERE id=$1', [trip]), { code: '23503' });
    });
    await t.test('exact-point API is denied even with claimed confirmation; no projection or catalog derives private GPS', async () => {
      for (const point of [{ lat: 4.7, lng: -74.1 }, { lat: 4.7, lng: -74.1, confirmed: true, visibility: 'trip' }, { lat: 0 }, { lat: 91, lng: 0 }]) {
        assert.equal((await request(`/api/v1/visits/${ownerVisit.id}`, owner, 'PATCH', { confirmedCoordinates: point })).status, 400);
        assert.equal((await call(owner, 'visits.update', { id: ownerVisit.id, confirmedCoordinates: point })).error, 'VALIDATION_ERROR');
      }
      const dto = await (await request(`/api/v1/visits/${ownerVisit.id}`, guest)).json() as Visit; assert.equal(dto.confirmedCoordinates, null); assert.equal(dto.photoCount, 0); assert.equal(dto.previewPhotoId, null);
      assert.deepEqual(await (await request('/api/v1/places?countryCode=COL', foreign)).json(), catalogBefore);
      const text = JSON.stringify(dto); assert.ok(!text.includes('exact_latitude') && !text.includes('exact_confirmed_by'));
    });
    await t.test('creator with access and Owner/Admin edit; other Member/Guest and authorship-only attempts deny', async () => {
      for (const actor of [member, owner, adminActor]) assert.equal((await request(`/api/v1/visits/${memberVisit.id}`, actor, 'PATCH', { name: 'Permitted' })).status, 200);
      for (const actor of [otherMember, guest]) { assert.equal((await request(`/api/v1/visits/${memberVisit.id}`, actor, 'PATCH', { name: 'Denied' })).status, 403); assert.equal((await call(actor, 'visits.update', { id: memberVisit.id, name: 'Denied' })).error, 'ACTION_FORBIDDEN'); }
      assert.equal((await request(`/api/v1/visits/${guestVisit.id}`, guest, 'PATCH', { placeId: springfields[0].id, name: null })).status, 200);
      for (const field of ['tripId', 'projectId', 'createdByUserId', 'status']) assert.equal((await request(`/api/v1/visits/${memberVisit.id}`, member, 'PATCH', { [field]: foreignTrip })).status, 400);
      // P-03 remains different: a Member who created a Trip cannot edit that Trip.
      assert.equal((await request(`/api/v1/trips/${secondTrip}`, member, 'PATCH', { name: 'Denied' })).status, 403);
    });
    await t.test('Guest map/Visit scope and cross-project filter/cursor isolation do not disclose unrelated geography', async () => {
      assert.equal((await request(`/api/v1/projects/${parent}/map`, guest)).status, 404);
      for (const path of [`/api/v1/trips/${secondTrip}/visits`, `/api/v1/trips/${secondTrip}/map`, `/api/v1/visits/${memberVisit.id}`]) assert.equal((await request(path, foreign)).status, 404);
      assert.equal((await request(`/api/v1/trips/${secondTrip}/map`, guest)).status, 404);
      assert.equal((await request(`/api/v1/trips/${foreignTrip}/map`, owner)).status, 404);
      assert.equal((await request(`/api/v1/projects/${parent}/map?tripId=${foreignTrip}`, owner)).status, 404);
      assert.equal((await call(guest, 'maps.project', { projectId: parent })).error, 'RESOURCE_NOT_FOUND');
      assert.equal((await call(owner, 'maps.project', { projectId: parent, tripId: foreignTrip })).error, 'RESOURCE_NOT_FOUND');
      const page = await (await request(`/api/v1/trips/${trip}/map`, guest)).json() as Page<MapItem>;
      assert.ok(page.items.length > 0 && page.items.every(i => i.tripId === trip && i.confirmedCoordinates === null && i.photoCount === 0 && i.previewPhotoId === null));
      assert.ok(!JSON.stringify(page).includes('projectId') && !JSON.stringify(page).includes('createdByUserId'));
      assert.ok(page.items.every(i => !['email', 'members', 'projectName'].some(key => key in i)));
    });
    await t.test('map date overlap is inclusive, open-ended, excludes undated, and country/trip filters are scoped', async () => {
      const filter = async (query: string) => { const response = await request(`/api/v1/trips/${trip}/map?${query}`, member); assert.equal(response.status, 200); return (await response.json() as Page<MapItem>).items; };
      const leap = await filter('from=2024-02-29&to=2024-02-29'); assert.deepEqual(new Set(leap.map(x => x.visitId)), new Set([singleVisit.id, rangeVisit.id]));
      assert.equal((await filter('from=2024-03-01')).length, 1); assert.equal((await filter('to=2024-02-28')).length, 1); assert.equal((await filter('from=2024-03-02')).length, 0);
      assert.ok((await filter('countryCode=USA')).every(x => x.place.countryCode === 'USA'));
      const project = await request(`/api/v1/projects/${parent}/map?tripId=${secondTrip}&countryCode=TUR`, member); assert.equal(project.status, 200); const projected = await project.json() as Page<MapItem>; assert.equal(projected.items.length, 1); assert.equal(projected.items[0]!.tripId, secondTrip);
      for (const query of ['from=2024-03-01&to=2024-02-29', 'from=2024-02-30', 'countryCode=ZZZ', 'tripId=malformed']) assert.equal((await request(`/api/v1/projects/${parent}/map?${query}`, owner)).status, 400);
    });
    await t.test('membership and ancestor lifecycle revocation hide retained Visits and maps', async () => {
      for (const actor of [member, guest]) {
        const table = actor === member ? 'project_memberships' : 'trip_memberships', column = actor === member ? 'project_id' : 'trip_id', key = actor === member ? parent : trip, visit = actor === member ? memberVisit : guestVisit;
        await sql.query(`UPDATE travel_map.${table} SET status='revoked',revoked_at=clock_timestamp() WHERE ${column}=$1 AND user_id=$2`, [key, actor.id]);
        assert.equal((await request(`/api/v1/visits/${visit.id}`, actor)).status, 404); assert.equal((await request(`/api/v1/visits/${visit.id}`, actor, 'PATCH', { name: 'Former creator' })).status, 404);
        assert.equal((await sql.query('SELECT count(*)::int AS n FROM travel_map.visits WHERE id=$1', [visit.id])).rows[0].n, 1);
        await sql.query(`UPDATE travel_map.${table} SET status='active',revoked_at=NULL WHERE ${column}=$1 AND user_id=$2`, [key, actor.id]);
      }
      for (const [table, id] of [['projects', parent], ['trips', trip], ['visits', ownerVisit.id]] as const) {
        await sql.query(`UPDATE travel_map.${table} SET status='archived',archived_at=clock_timestamp() WHERE id=$1`, [id]);
        assert.equal((await request(`/api/v1/visits/${ownerVisit.id}`, guest)).status, 404);
        if (table !== 'visits') assert.equal((await request(`/api/v1/trips/${trip}/map`, owner)).status, 404);
        await sql.query(`UPDATE travel_map.${table} SET status='active',archived_at=NULL WHERE id=$1`, [id]);
      }
      await sql.query("UPDATE travel_map.users SET status='deletion_requested' WHERE id=$1", [member.id]); assert.equal((await request(`/api/v1/trips/${trip}/visits`, member)).status, 401); await sql.query("UPDATE travel_map.users SET status='active' WHERE id=$1", [member.id]);
    });
    await t.test('runtime keeps four RPCs, FORCE RLS, no private-helper/table access or actor spoofing', async () => {
      const funcs = (await rpc.query("SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='travel_map' AND has_function_privilege(current_user,p.oid,'EXECUTE') ORDER BY p.proname")).rows.map(x => x.proname); assert.deepEqual(funcs, ['api_call', 'login_complete', 'oauth_begin', 'oauth_consume']);
      const settings = (await rpc.query("SELECT p.proname,p.prosecdef,p.proconfig,pg_get_userbyid(p.proowner) AS owner FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='travel_map' AND p.proname IN ('geography_action','place_dto','visit_dto','valid_calendar','valid_visit_date')")).rows;
      assert.equal(settings.length, 5); assert.ok(settings.every(x => !x.prosecdef && x.owner === ownerRole && x.proconfig.includes('search_path=pg_catalog') && x.proconfig.includes('TimeZone=UTC')));
      for (const table of ['country_codes', 'places', 'visits']) { const posture = (await rpc.query("SELECT relrowsecurity,relforcerowsecurity,has_table_privilege(current_user,oid,'SELECT,INSERT,UPDATE,DELETE') AS direct FROM pg_class WHERE oid=$1::regclass", [`travel_map.${table}`])).rows[0]; assert.deepEqual(posture, { relrowsecurity: true, relforcerowsecurity: true, direct: false }); await assert.rejects(rpc.query(`SELECT * FROM travel_map.${table}`), { code: '42501' }); }
      for (const query of ["SELECT travel_map.valid_calendar('2024-01-01')", "SELECT travel_map.valid_visit_date('{}')", 'SELECT travel_map.place_dto(NULL::travel_map.places)', 'SELECT travel_map.visit_dto(NULL::travel_map.visits)', `SELECT travel_map.geography_action('${owner.id}','visits.get','{}')`]) await assert.rejects(rpc.query(query), { code: '42501' });
      assert.equal((await call(foreign, 'visits.get', { id: ownerVisit.id, actorId: owner.id })).error, 'VALIDATION_ERROR');
      await sql.query('BEGIN'); try { await sql.query(`GRANT SELECT ON travel_map.visits TO ${apiRole}`); await sql.query(`SET LOCAL ROLE ${apiRole}`); assert.equal((await sql.query('SELECT count(*)::int AS n FROM travel_map.visits')).rows[0].n, 0); } finally { await sql.query('ROLLBACK'); }
    });
    await t.test('mutations retain exact Origin/CSRF and private response headers; unsupported workflows stay absent', async () => {
      for (const [path, method] of [[`/api/v1/trips/${trip}/visits`, 'POST'], [`/api/v1/visits/${ownerVisit.id}`, 'PATCH']]) for (const headers of [{ Origin: 'https://evil.example.invalid' }, { 'X-CSRF-Token': 'invalid' }, { 'Sec-Fetch-Site': 'cross-site' }]) assert.equal((await request(path!, owner, method, { placeId: bogota }, headers)).status, 403);
      const response = await request(`/api/v1/trips/${trip}/map`, owner); assert.equal(response.headers.get('Cache-Control'), 'private, no-store'); assert.equal(response.headers.get('Content-Security-Policy'), "default-src 'none'; frame-ancestors 'none'");
      assert.equal((await request(`/api/v1/visits/${ownerVisit.id}`, owner, 'DELETE')).status, 404); assert.equal((await request(`/api/v1/projects/${parent}/invitations`, owner, 'POST', {})).status, 404);
      assert.equal((await request(`/api/v1/trips/${trip}/visits`)).status, 401);
    });
    await t.test('100+ Visits page deterministically; maps remain scoped and query plans are inspected', async () => {
      await sql.query("INSERT INTO travel_map.visits(trip_id,place_id,created_by_user_id,date_mode,date_start,date_end,created_at) SELECT $1,$2,$3,'single','2026-01-01','2026-01-01','2026-01-01T00:00:00Z' FROM generate_series(1,110)", [trip, bogota, owner.id]);
      const collect = async (path: string, key: 'id' | 'visitId') => { const ids: string[] = []; let cursor: string | null = null; do { const r = await request(`${path}?limit=17${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, guest); assert.equal(r.status, 200); const page = await r.json() as Page<Record<string, unknown>>; ids.push(...page.items.map(x => x[key] as string)); assert.ok(page.items.every(x => x.tripId === trip)); cursor = page.nextCursor; } while (cursor); return ids; };
      const expected = (await sql.query("SELECT id FROM travel_map.visits WHERE trip_id=$1 AND status='active' ORDER BY created_at,id", [trip])).rows.map(x => x.id);
      assert.ok(expected.length >= 110); assert.deepEqual(await collect(`/api/v1/trips/${trip}/visits`, 'id'), expected); assert.deepEqual(await collect(`/api/v1/trips/${trip}/map`, 'visitId'), expected); assert.equal(new Set(expected).size, expected.length);
      const foreignCursor = Buffer.from(JSON.stringify({ time: '2020-01-01T00:00:00Z', id: foreignTrip })).toString('base64url');
      const scoped = await (await request(`/api/v1/trips/${trip}/map?cursor=${foreignCursor}&limit=100`, guest)).json() as Page<MapItem>; assert.ok(scoped.items.every(x => x.tripId === trip));
      await sql.query('ANALYZE travel_map.visits; ANALYZE travel_map.trips; ANALYZE travel_map.places');
      const query = "SELECT v.id FROM travel_map.visits v JOIN travel_map.trips t ON t.id=v.trip_id JOIN travel_map.places p ON p.id=v.place_id WHERE t.project_id=$1 AND t.status='active' AND v.status='active' AND v.trip_id=$2 AND p.country_code=$3 AND v.date_end>=$4::date AND v.date_start<=$5::date ORDER BY v.created_at,v.id LIMIT 26";
      const plan = (await sql.query(`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ${query}`, [parent, trip, 'COL', '2026-01-01', '2026-01-01'])).rows;
      await sql.query('BEGIN'); let indexed: unknown; try { await sql.query('SET LOCAL enable_seqscan=off'); indexed = (await sql.query(`EXPLAIN (FORMAT JSON) ${query}`, [parent, trip, 'COL', '2026-01-01', '2026-01-01'])).rows; } finally { await sql.query('ROLLBACK'); }
      const text = JSON.stringify(indexed); assert.ok(/visits_trip_(page|dates)_idx/.test(text));
      await mkdir('.local/e22-evidence', { recursive: true }); await writeFile('.local/e22-evidence/query-plans.json', JSON.stringify({ fixtureMinimum: 110, naturalPlan: plan, indexEligibilityPlan: indexed }, null, 2));
      t.diagnostic('Scoped query plans saved in ignored .local/e22-evidence/query-plans.json; not a production benchmark.');
    });
    await t.test('concurrent creator/Admin edits serialize complete payloads; revocation is rechecked after locks', async () => {
      const responses = await Promise.all([request(`/api/v1/visits/${memberVisit.id}`, member, 'PATCH', { name: 'one', placeId: bogota }), request(`/api/v1/visits/${memberVisit.id}`, adminActor, 'PATCH', { name: 'two', placeId: istanbul })]); assert.ok(responses.every(r => r.status === 200));
      const final = await (await request(`/api/v1/visits/${memberVisit.id}`, owner)).json() as Visit; assert.ok((final.name === 'one' && final.placeId === bogota) || (final.name === 'two' && final.placeId === istanbul));
      await sql.query('BEGIN'); let pending: Promise<Response> | undefined;
      try { await sql.query('SELECT 1 FROM travel_map.project_memberships WHERE project_id=$1 AND user_id=$2 FOR UPDATE', [parent, member.id]); pending = request(`/api/v1/visits/${memberVisit.id}`, member, 'PATCH', { name: 'Must not change' }); let waiting = false;
        for (let i = 0; i < 200; i++) { await sql.query('SELECT pg_stat_clear_snapshot()'); if ((await sql.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND application_name='travel-map-api' AND wait_event_type='Lock'")).rows[0].n) { waiting = true; break; } await new Promise(done => setTimeout(done, 10)); } assert.ok(waiting);
        await sql.query("UPDATE travel_map.project_memberships SET status='revoked',revoked_at=clock_timestamp() WHERE project_id=$1 AND user_id=$2", [parent, member.id]); await sql.query('COMMIT'); assert.equal((await pending).status, 404);
      } finally { await sql.query('ROLLBACK'); await pending; }
      await sql.query("UPDATE travel_map.project_memberships SET status='active',revoked_at=NULL WHERE project_id=$1 AND user_id=$2", [parent, member.id]);
    });
    await t.test('actual workerd performs catalog, Visit and map HTTP flow through real PostgreSQL', async () => {
      const harness = createTestHarness({ workers: [{ configPath: new URL('../wrangler.jsonc', import.meta.url), env: 'test', prebuiltWorkerDir: new URL('../dist/', import.meta.url), vars: { APP_ENV: 'test', APP_ORIGIN: env.APP_ORIGIN!, SUPABASE_URL: env.SUPABASE_URL! }, secrets: { DATABASE_URL: apiUrl.toString(), SUPABASE_PUBLISHABLE_KEY: 'synthetic-public', OAUTH_COOKIE_KEY: env.OAUTH_COOKIE_KEY! } }] });
      try { await harness.listen(); const worker = { fetch: async (r: Request) => harness.fetch(r.url, { method: r.method, headers: Object.fromEntries(r.headers), ...(r.body ? { body: await r.text() } : {}) }) }; const headers = { Cookie: `${SESSION_COOKIE}=${owner.token}`, Origin: env.APP_ORIGIN!, 'X-CSRF-Token': owner.csrf, 'Content-Type': 'application/json' };
        assert.equal((await worker.fetch(new Request(`${env.APP_ORIGIN}/api/v1/places?countryCode=COL`, { headers }))).status, 200);
        const created = await worker.fetch(new Request(`${env.APP_ORIGIN}/api/v1/trips/${trip}/visits`, { method: 'POST', headers, body: JSON.stringify({ placeId: bogota, date: { mode: 'single', start: '2024-02-29', end: '2024-02-29' } }) })); assert.equal(created.status, 201); const visit = await created.json() as Visit; assert.equal(visit.date.start, '2024-02-29');
        for (const path of [`/api/v1/visits/${visit.id}`, `/api/v1/trips/${trip}/visits`, `/api/v1/trips/${trip}/map`, `/api/v1/projects/${parent}/map`]) assert.equal((await worker.fetch(new Request(`${env.APP_ORIGIN}${path}`, { headers }))).status, 200);
        assert.equal((await worker.fetch(new Request(`${env.APP_ORIGIN}/api/v1/visits/${visit.id}`, { method: 'PATCH', headers, body: JSON.stringify({ name: 'Native edited' }) }))).status, 200);
      } finally { await harness.close(); }
    });
    await t.test('expired/revoked sessions and logout still deny all new actions', async () => {
      const actor = await seed('expiry'); await sql.query("UPDATE travel_map.app_sessions SET created_at=now()-interval '2 hours',last_seen_at=now()-interval '2 hours',expires_at=now()-interval '1 hour',idle_expires_at=now()-interval '1 hour' WHERE user_id=$1", [actor.id]); assert.equal((await request('/api/v1/places?countryCode=COL', actor)).status, 401);
      assert.equal((await request('/api/v1/auth/logout', guest, 'POST')).status, 204); for (const path of ['/api/v1/places?countryCode=COL', `/api/v1/visits/${guestVisit.id}`, `/api/v1/trips/${trip}/map`]) assert.equal((await request(path, guest)).status, 401);
    });
    await t.test('down restores exact E2.1 dispatcher/ACL and retains original E1/E2.1 data; reapply restores source IDs', async () => {
      assert.deepEqual(await owned('down'), ['0004_places_visits']); assert.deepEqual(await fingerprint(), original);
      assert.equal((await sql.query("SELECT to_regclass('travel_map.visits') AS x")).rows[0].x, null); assert.equal((await request(`/api/v1/trips/${trip}`, owner)).status, 200);
      assert.equal((await request('/api/v1/me', owner)).status, 200); assert.deepEqual(await owned('up'), ['0004_places_visits']);
      assert.equal((await sql.query('SELECT count(*)::int AS n FROM travel_map.visits')).rows[0].n, 0);
      assert.equal((await sql.query("SELECT id FROM travel_map.places WHERE source_id='3688689'")).rows[0].id, bogota);
    });
    await t.test('destructive down guard rejects a disposable database with a non-test name', async () => {
      const name = `travel_map_guard_e22_${randomUUID().replaceAll('-', '')}`;
      await admin.query(`CREATE DATABASE ${name} OWNER ${ownerRole}`); guardDatabases.push(name);
      const guardUrl = new URL(url); guardUrl.pathname = `/${name}`;
      const guard = new pg.Client({ connectionString: guardUrl.toString() }); await guard.connect();
      try {
        await guard.query(`SET ROLE ${ownerRole}`); assert.equal((await migrate(guard, 'up', all)).length, 4);
        await assert.rejects(migrate(guard, 'down', all), { code: '42501' });
        assert.equal((await guard.query('SELECT count(*)::int AS n FROM travel_map_migrations.applied')).rows[0].n, 4);
        assert.ok((await guard.query("SELECT to_regclass('travel_map.visits') AS x")).rows[0].x);
      } finally { await guard.end(); }
    });
    await t.test('complete reverse and fresh forward chain succeeds only in this disposable fixture DB', async () => {
      for (let i = 0; i < 4; i++) assert.equal((await owned('down')).length, 1);
      assert.equal((await sql.query("SELECT to_regnamespace('travel_map') AS x")).rows[0].x, null);
      assert.equal((await owned('up')).length, 4);
      assert.equal((await sql.query('SELECT count(*)::int AS n FROM travel_map.users')).rows[0].n, 0);
      assert.equal((await sql.query('SELECT count(*)::int AS n FROM travel_map.visits')).rows[0].n, 0);
      assert.equal((await sql.query('SELECT count(*)::int AS n FROM travel_map.places')).rows[0].n, 6);
    });
    const source = await readFile(new URL('../src/modules/geography/routes.ts', import.meta.url), 'utf8'); assert.ok(!/console\.|logger\./.test(source));
  } finally {
    await runtime?.end().catch(() => {}); await db?.end().catch(() => {});
    for (const name of guardDatabases) await admin.query(`DROP DATABASE ${name} WITH (FORCE)`);
    if (created) await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    for (const role of roles.reverse()) await admin.query(`DROP ROLE ${role}`);
    await admin.end();
  }
});
