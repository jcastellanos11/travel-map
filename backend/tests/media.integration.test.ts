import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { test } from 'node:test';
import pg from 'pg';
import { loadMigrations, migrate } from '../scripts/migrations.ts';
import type { Migration } from '../scripts/migrations.ts';
import { assertMediaTestCluster, mediaTestUrl } from '../scripts/media-test-safety.ts';

interface Actor { id: string; hash: string }
interface Slot { id: string; photoId: string; clientFileId: string; status: string }
interface Operation { id: string; files: Slot[] }
interface Ticket { id: string; claimId: string; generation: number; kind: string; assets: { id: string; variant: string; objectKey: string }[] }
type Result = Record<string, unknown>;
const supplied = process.env.DATABASE_URL;
test('E4.1: disposable PostgreSQL media foundation, privilege review and independent-connection races', {
  skip: !supplied ? 'Run npm run db:media:test with an existing PG_BIN; no persistent URL is accepted' : false,
}, async t => {
  const base = mediaTestUrl(supplied, process.env.LOCAL_DATABASE_ONLY);
  const admin = new pg.Client({ connectionString: base.toString() }); await admin.connect();
  await assertMediaTestCluster(admin, base.pathname.slice(1));
  const suffix = randomUUID().replaceAll('-', ''), database = `travel_map_test_e41_${suffix}`;
  const ownerRole = `e41_owner_${suffix}`, apiRole = `e41_api_${suffix}`;
  const connections: pg.Client[] = [];
  let created = false;
  try {
    await admin.query(`CREATE ROLE ${ownerRole} NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
    await admin.query(`CREATE ROLE ${apiRole} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
    await admin.query('CREATE ROLE travel_map_media_maintenance NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS');
    await admin.query(`CREATE DATABASE ${database} OWNER ${ownerRole}`); created = true;
    await admin.query(`COMMENT ON DATABASE ${database} IS 'travel-map:e41:disposable:${process.env.E41_CLUSTER_MARKER}'`);
    const url = new URL(base); url.pathname = `/${database}`;
    async function connect(role?: string, application = 'e41-test'): Promise<pg.Client> {
      const target = new URL(url); if (role) target.username = role;
      const c = new pg.Client({ connectionString: target.toString(), application_name: application,
        options: '-c statement_timeout=20000 -c lock_timeout=10000' });
      await c.connect(); connections.push(c); return c;
    }
    const db = await connect();
    await assertMediaTestCluster(db, database, ownerRole);
    const all = await loadMigrations(), previous = all.slice(0, 6), migration = all[6];
    assert.equal(all.length, 7); assert.equal(migration?.version, '0007_media_foundation'); assert.ok(migration);
    async function owned(direction: 'up' | 'down' | 'status', set: Migration[] = all): Promise<string[]> {
      await assertMediaTestCluster(db, database, ownerRole);
      await db.query(`SET ROLE ${ownerRole}`);
      try { return await migrate(db, direction, set); } finally { await db.query('RESET ROLE'); }
    }
    await owned('up', previous);
    await db.query(`GRANT USAGE ON SCHEMA travel_map TO ${apiRole}`);
    await db.query(`GRANT EXECUTE ON FUNCTION travel_map.oauth_begin(text,text),travel_map.oauth_consume(text),travel_map.login_complete(text,jsonb,text,text),travel_map.api_call(text,text,jsonb) TO ${apiRole}`);
    const rpc = await connect(apiRole);
    const technical = await connect(); await technical.query('SET SESSION AUTHORIZATION travel_map_media_maintenance');
    const seed = async (name: string): Promise<Actor> => {
      const id = randomUUID(), hash = createHash('sha256').update(randomUUID()).digest('hex');
      await db.query('INSERT INTO travel_map.users(id,supabase_auth_user_id,display_name) VALUES($1,$2,$3)', [id, randomUUID(), `E41 synthetic ${name}`]);
      await db.query("INSERT INTO travel_map.app_sessions(user_id,token_digest,expires_at,idle_expires_at) VALUES($1,$2,clock_timestamp()+interval '1 day',clock_timestamp()+interval '30 minutes')", [id, hash]);
      return { id, hash };
    };
    const owner = await seed('owner'), manager = await seed('Admin'), member = await seed('Member'), other = await seed('other Member'), guest = await seed('Guest'), outsider = await seed('outsider');
    const fixture = async () => {
      const project = randomUUID(), trip = randomUUID(), sibling = randomUUID(), visit = randomUUID(), otherVisit = randomUUID();
      await db.query('INSERT INTO travel_map.projects(id,owner_user_id,name) VALUES($1,$2,$3)', [project, owner.id, 'Synthetic retained E3 Project']);
      for (const [actor, role] of [[manager, 'admin'], [member, 'member'], [other, 'member']] as const) await db.query('INSERT INTO travel_map.project_memberships(project_id,user_id,role) VALUES($1,$2,$3)', [project, actor.id, role]);
      for (const id of [trip, sibling]) await db.query('INSERT INTO travel_map.trips(id,project_id,created_by_user_id,name) VALUES($1,$2,$3,$4)', [id, project, owner.id, 'Synthetic retained Trip']);
      await db.query('INSERT INTO travel_map.trip_memberships(trip_id,user_id) VALUES($1,$2)', [trip, guest.id]);
      for (const [id, tid] of [[visit, trip], [otherVisit, sibling]]) await db.query("INSERT INTO travel_map.visits(id,trip_id,place_id,created_by_user_id) VALUES($1,$2,'44576a98-98a4-55e0-b879-360717211efb',$3)", [id, tid, member.id]);
      return { project, trip, sibling, visit, otherVisit };
    };
    const f = await fixture();
    const call = async (actor: Actor, action: string, data: unknown = {}, c = rpc): Promise<Result> =>
      (await c.query('SELECT travel_map.api_call($1,$2,$3) r', [actor.hash, action, JSON.stringify(data)])).rows[0].r as Result;
    const ok = (r: Result): Result => { assert.equal(r.error, undefined); return r; };
    const code = async (actor: Actor, action: string, data: unknown, expected: string) => assert.equal((await call(actor, action, data)).error, expected);
    // Include E1 OAuth state, E2.4 invitation and committed E2.3 audit history before 0007.
    ok(await call(owner, 'collaboration.settings', { id: f.project, name: 'Synthetic populated E3 baseline' }));
    await db.query("INSERT INTO travel_map.oauth_transactions(state_digest,rate_key) VALUES($1,$2)", ['d'.repeat(64), 'e'.repeat(64)]);
    await db.query('INSERT INTO travel_map.invitations(project_id,token_digest,issuer_id) VALUES($1,$2,$3)', [f.project, 'c'.repeat(64), owner.id]);
    const legacySnapshot = async () => (await db.query(`SELECT c.relname,
      (SELECT count(*) FROM jsonb_array_elements(j.rows)) n,md5(j.rows::text) digest FROM
      (SELECT 'users' relname,jsonb_agg(to_jsonb(x) ORDER BY id) rows FROM travel_map.users x UNION ALL
       SELECT 'projects',jsonb_agg(to_jsonb(x) ORDER BY id) FROM travel_map.projects x UNION ALL
       SELECT 'trips',jsonb_agg(to_jsonb(x) ORDER BY id) FROM travel_map.trips x UNION ALL
       SELECT 'visits',jsonb_agg(to_jsonb(x) ORDER BY id) FROM travel_map.visits x UNION ALL
       SELECT 'app_sessions',jsonb_agg(to_jsonb(x) ORDER BY id) FROM travel_map.app_sessions x UNION ALL
       SELECT 'project_memberships',jsonb_agg(to_jsonb(x) ORDER BY project_id,user_id) FROM travel_map.project_memberships x UNION ALL
       SELECT 'trip_memberships',jsonb_agg(to_jsonb(x) ORDER BY trip_id,user_id) FROM travel_map.trip_memberships x UNION ALL
       SELECT 'oauth_transactions',jsonb_agg(to_jsonb(x) ORDER BY state_digest) FROM travel_map.oauth_transactions x UNION ALL
       SELECT 'invitations',jsonb_agg(to_jsonb(x) ORDER BY id) FROM travel_map.invitations x UNION ALL
       SELECT 'domain_audit_events',jsonb_agg(to_jsonb(x)-'technical_principal' ORDER BY id) FROM travel_map.domain_audit_events x) j
      JOIN pg_class c ON c.relname=j.relname AND c.relnamespace='travel_map'::regnamespace ORDER BY c.relname`)).rows;
    const original = (await db.query("SELECT pg_get_functiondef(oid) body,proowner,proacl::text acl FROM pg_proc WHERE oid='travel_map.api_call(text,text,jsonb)'::regprocedure")).rows[0];
    await t.test('populated E3 migration: owner preflight, failed DDL atomicity, preservation and checksum ledger', async () => {
      const before = await legacySnapshot();
      await assert.rejects(migrate(db, 'up'), { code: '42501' });
      // Deliberately unsafe grant only in this NEW test cluster: migration must reject it.
      await admin.query(`GRANT travel_map_media_maintenance TO ${apiRole}`);
      try { await assert.rejects(owned('up'), { code: '42501' }); }
      finally { await admin.query(`REVOKE travel_map_media_maintenance FROM ${apiRole}`); }
      await assert.rejects(owned('up', [...previous, { ...migration, checksum: 'failure', up: migration.up + '\nSELECT missing_e41_function();' }]), { code: '42883' });
      assert.equal((await db.query("SELECT to_regclass('travel_map.photos') x")).rows[0].x, null);
      assert.deepEqual(await legacySnapshot(), before);
      assert.deepEqual(await owned('up'), ['0007_media_foundation']);
      assert.deepEqual(await legacySnapshot(), before);
      assert.equal((await owned('status')).length, 7);
      await assert.rejects(owned('up', [...previous, { ...migration, checksum: 'changed' }]), /MIGRATION_HISTORY_MISMATCH/);
    });
    assert.ok((await db.query("SELECT to_regclass('travel_map.photos') x")).rows[0].x, 'Stop after failed media migration preflight');
    await t.test('empty-media rollback restores dispatcher/ACL/owner and audit schema; reapplication succeeds', async () => {
      await owned('down');
      assert.deepEqual((await db.query("SELECT pg_get_functiondef(oid) body,proowner,proacl::text acl FROM pg_proc WHERE oid='travel_map.api_call(text,text,jsonb)'::regprocedure")).rows[0], original);
      assert.equal((await db.query("SELECT to_regnamespace('travel_map_jobs') x")).rows[0].x, null);
      assert.deepEqual(await owned('up'), ['0007_media_foundation']);
    });
    await t.test('fresh seven-migration application and marker identity guard use only owned disposable databases', async () => {
      const freshName = `travel_map_test_e41_${randomUUID().replaceAll('-', '')}`;
      await admin.query(`CREATE DATABASE ${freshName} OWNER ${ownerRole}`);
      await admin.query(`COMMENT ON DATABASE ${freshName} IS 'travel-map:e41:disposable:${process.env.E41_CLUSTER_MARKER}'`);
      const freshUrl = new URL(base); freshUrl.pathname = `/${freshName}`;
      const c = new pg.Client({ connectionString: freshUrl.toString() }); await c.connect();
      try {
        await assertMediaTestCluster(c, freshName, ownerRole);
        await c.query(`SET ROLE ${ownerRole}`); assert.equal((await migrate(c, 'up', all)).length, 7); await c.query('RESET ROLE');
        await admin.query(`COMMENT ON DATABASE ${freshName} IS 'not-the-required-marker'`);
        await assert.rejects(assertMediaTestCluster(c, freshName, ownerRole), /IDENTITY_MISMATCH/);
      } finally { await c.end(); await admin.query(`DROP DATABASE ${freshName}`); }
    });
    await t.test('existing identity/bootstrap and Project/Trip/Visit/invitation/logout actions work on migrated 0007', async () => {
      // Trusted verified-identity transport fixture; NOT real Google/Supabase-provider validation.
      const state = createHash('sha256').update(randomUUID()).digest('hex'), hash = createHash('sha256').update(randomUUID()).digest('hex');
      assert.equal((await rpc.query('SELECT travel_map.oauth_begin($1,$2) r', [state, state])).rows[0].r, true);
      assert.equal((await rpc.query('SELECT travel_map.oauth_consume($1) r', [state])).rows[0].r, true);
      assert.equal((await rpc.query('SELECT travel_map.oauth_consume($1) r', [state])).rows[0].r, false);
      assert.equal((await rpc.query('SELECT travel_map.login_complete($1,$2,$3,NULL) r', [state, JSON.stringify({ id: randomUUID(), displayName: 'Synthetic E41 identity', email: 'e41@example.invalid' }), hash])).rows[0].r, true);
      const who = ok(await call({ id: '', hash }, 'me')), actor = { id: who.id as string, hash };
      const project = ok(await call(actor, 'projects.create', { name: 'E41 compatibility', tripCreationPolicy: 'admins_only' }));
      const trip = ok(await call(actor, 'trips.create', { projectId: project.id, name: 'E41 Trip' }));
      const visit = ok(await call(actor, 'visits.create', { tripId: trip.id, placeId: '44576a98-98a4-55e0-b879-360717211efb' }));
      ok(await call(actor, 'projects.get', { id: project.id })); ok(await call(actor, 'visits.get', { id: visit.id }));
      ok(await call(actor, 'maps.trip', { tripId: trip.id })); ok(await call(actor, 'maps.project', { projectId: project.id }));
      const recipient = await seed('E41 compatibility recipient'), tokenDigest = createHash('sha256').update(randomUUID()).digest('hex');
      ok(await call(actor, 'invitations.create', { projectId: project.id, tokenDigest }));
      ok(await call(recipient, 'invitations.redeem', { tokenDigest })); ok(await call(recipient, 'trips.get', { id: trip.id }));
      ok(await call(actor, 'logout')); await code(actor, 'me', {}, 'SESSION_REQUIRED');
    });
    const begin = async (actor: Actor = member, visit = f.visit, count = 1, key = randomUUID().replaceAll('-', '')): Promise<Operation> => ok(await call(actor, 'media.begin', {
      visitId: visit, idempotencyKey: key, files: Array.from({ length: count }, (_, i) => ({ clientFileId: `file_${i}`, declaredBytes: 1234, declaredMime: 'image/jpeg' })),
    })) as unknown as Operation;
    const reserve = async (actor: Actor, slot: Slot, bytes = 1000) => ok(await call(actor, 'media.reserve', { slotId: slot.id, reservedBytes: bytes }));
    async function ticketFor(kind: string, photo: string): Promise<Ticket> {
      for (let n = 0; n < 100; n++) {
        const result = (await technical.query('SELECT travel_map_jobs.claim($1) r', [kind])).rows[0].r as Result;
        ok(result); assert.notEqual(result.idle, true, `No ${kind} job for synthetic photo`);
        const ticket = result as unknown as Ticket;
        if ((await db.query('SELECT photo_id FROM travel_map.media_tasks WHERE id=$1', [ticket.id])).rows[0].photo_id === photo) return ticket;
      }
      throw Error('Synthetic job budget exceeded');
    }
    const record = async (ticket: Ticket, action: string, evidence: unknown = {}, c = technical): Promise<Result> =>
      (await c.query('SELECT travel_map_jobs.record($1,$2,$3,$4,$5) r', [ticket.id, ticket.claimId, ticket.generation, action, JSON.stringify(evidence)])).rows[0].r as Result;
    // Restricted synthetic trusted evidence: NO real object I/O or image validation.
    const evidence = (ticket: Ticket) => ({ sanitizedPolicy: 'sanitized-v1', writesSettled: true, assets: ticket.assets.map((a, i) => ({ assetId: a.id,
      contentType: a.variant === 'archival' ? 'image/jpeg' : 'image/webp', byteLength: [100, 50, 25][i]!, width: 160, height: 120, sha256: 'b'.repeat(64) })) });
    const active = async (actor = member, visit = f.visit) => {
      const op = await begin(actor, visit), slot = op.files[0]!; await reserve(actor, slot);
      const ticket = await ticketFor('process', slot.photoId); ok(await record(ticket, 'processed', evidence(ticket)));
      ok(await call(actor, 'media.finalize', { slotId: slot.id })); return { op, slot, ticket };
    };
    const quota = async (actor: Actor) => (await db.query('SELECT used_bytes::int used,reserved_bytes::int reserved FROM travel_map.user_media_quotas WHERE user_id=$1', [actor.id])).rows[0] as { used: number; reserved: number };
    const completeCleanup = async (ticket: Ticket) => { ok(await record(ticket, 'writes_settled')); for (const a of ticket.assets) ok(await record(ticket, 'absent', { assetId: a.id })); };
    await t.test('FORCE RLS, fixed paths, owner policies, four runtime RPCs and exactly two technical RPCs', async () => {
      const tables = ['photos', 'photo_assets', 'user_media_quotas', 'upload_operations', 'upload_file_slots', 'quota_reservations', 'processing_attempts', 'media_tasks'];
      const flags = (await db.query('SELECT relrowsecurity r,relforcerowsecurity f,relowner FROM pg_class WHERE relnamespace=\'travel_map\'::regnamespace AND relname=ANY($1)', [tables])).rows;
      assert.equal(flags.length, 8); assert.ok(flags.every(x => x.r && x.f));
      for (const table of tables) { await assert.rejects(rpc.query(`SELECT * FROM travel_map.${table}`), { code: '42501' }); await assert.rejects(technical.query(`SELECT * FROM travel_map.${table}`), { code: '42501' }); }
      const executable = async (role: string) => (await db.query("SELECT n.nspname||'.'||p.proname name FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('travel_map','travel_map_jobs') AND has_function_privilege($1,p.oid,'EXECUTE') ORDER BY name", [role])).rows.map(x => x.name);
      assert.deepEqual(await executable(apiRole), ['travel_map.api_call', 'travel_map.login_complete', 'travel_map.oauth_begin', 'travel_map.oauth_consume']);
      assert.deepEqual(await executable('travel_map_media_maintenance'), ['travel_map_jobs.claim', 'travel_map_jobs.record']);
      await assert.rejects(rpc.query("SELECT travel_map.media_action($1,'media.get','{}',$1)", [owner.id]), { code: '42501' });
      await assert.rejects(technical.query("SELECT travel_map.api_call($1,'me','{}')", [owner.hash]), { code: '42501' });
      await assert.rejects(rpc.query(`SET ROLE ${ownerRole}`), { code: '42501' });
      const invalid = (await db.query("SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('travel_map','travel_map_jobs') AND p.proname LIKE 'media_%' AND (p.proowner<>$1 OR NOT p.proconfig @> ARRAY['search_path=pg_catalog','TimeZone=UTC'])", [flags[0].relowner])).rows;
      assert.equal(invalid.length, 0);
      const role = (await db.query("SELECT rolsuper,rolcreatedb,rolcreaterole,rolinherit,rolcanlogin,rolreplication,rolbypassrls FROM pg_roles WHERE rolname='travel_map_media_maintenance'")).rows[0];
      assert.ok(Object.values(role).every(v => v === false));
      assert.equal((await db.query("SELECT count(*)::int n FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname='travel_map_media_maintenance') OR roleid=(SELECT oid FROM pg_roles WHERE rolname='travel_map_media_maintenance')")).rows[0].n, 0);
      await assert.rejects(technical.query(`SET ROLE ${apiRole}`), { code: '42501' });
    });
    await t.test('owner-only FORCE RLS still denies accidental runtime SELECT grants in a rolled-back privilege fixture', async () => {
      await begin(owner);
      assert.ok((await db.query('SELECT count(*)::int n FROM travel_map.photos')).rows[0].n > 0);
      await db.query('BEGIN');
      try {
        await db.query(`GRANT SELECT ON travel_map.photos,travel_map.user_media_quotas TO ${apiRole}`);
        await db.query(`SET LOCAL ROLE ${apiRole}`);
        assert.equal((await db.query('SELECT count(*)::int n FROM travel_map.photos')).rows[0].n, 0);
        assert.equal((await db.query('SELECT count(*)::int n FROM travel_map.user_media_quotas')).rows[0].n, 0);
      } finally { await db.query('ROLLBACK'); }
    });
    await t.test('server identity, batch/input/type bounds, strict payloads and ten independent slots', async () => {
      const op = await begin(member, f.visit, 10); assert.equal(op.files.length, 10); assert.equal(new Set(op.files.map(s => s.photoId)).size, 10);
      for (const count of [0, 11]) await code(member, 'media.begin', { visitId: f.visit, idempotencyKey: randomUUID(), files: Array.from({ length: count }, () => ({ clientFileId: randomUUID(), declaredBytes: 1 })) }, 'VALIDATION_ERROR');
      for (const file of [{ clientFileId: 'a', declaredBytes: -1 }, { clientFileId: 'a', declaredBytes: 20000001 }, { clientFileId: 'a', declaredBytes: 1, declaredMime: 'image/heic' }, { clientFileId: 'a', declaredBytes: 1, objectKey: 'bad' }]) await code(member, 'media.begin', { visitId: f.visit, idempotencyKey: randomUUID(), files: [file] }, 'VALIDATION_ERROR');
      for (const field of ['actorId', 'creatorId', 'quotaUserId', 'role']) await code(member, 'media.begin', { visitId: f.visit, idempotencyKey: randomUUID(), files: [], [field]: owner.id }, 'VALIDATION_ERROR');
      await reserve(member, op.files[0]!); assert.equal((await quota(member)).reserved, 1000);
      assert.equal((await call(member, 'media.operation', { id: op.id })).files instanceof Array, true);
      await code(other, 'media.operation', { id: op.id }, 'RESOURCE_NOT_FOUND');
    });
    await t.test('same intent replays, different intent conflicts; independent same-content intents remain distinct', async () => {
      const key = randomUUID(), a = await begin(member, f.visit, 1, key), b = await begin(member, f.visit, 1, key); assert.deepEqual(a, b);
      await code(member, 'media.begin', { visitId: f.visit, idempotencyKey: key, files: [{ clientFileId: 'changed', declaredBytes: 1234 }] }, 'OPERATION_CONFLICT');
      assert.notEqual((await begin(member)).files[0]!.photoId, a.files[0]!.photoId);
    });
    await t.test('Owner/Admin/Member/Guest uploads; Guest cannot use sibling or foreign Visit, expired/revoked sessions denied', async () => {
      for (const actor of [owner, manager, member, guest]) { const op = await begin(actor); await reserve(actor, op.files[0]!); }
      await code(guest, 'media.begin', { visitId: f.otherVisit, idempotencyKey: randomUUID(), files: [] }, 'RESOURCE_NOT_FOUND');
      await code(outsider, 'media.begin', { visitId: f.visit, idempotencyKey: randomUUID(), files: [] }, 'RESOURCE_NOT_FOUND');
      const expired = await seed('expired'); await db.query("UPDATE travel_map.app_sessions SET idle_expires_at=created_at+interval '1 microsecond' WHERE user_id=$1", [expired.id]);
      await code(expired, 'media.get', { id: randomUUID() }, 'SESSION_REQUIRED');
      await db.query('UPDATE travel_map.app_sessions SET revoked_at=clock_timestamp() WHERE user_id=$1', [expired.id]); await code(expired, 'media.list', { visitId: f.visit }, 'SESSION_REQUIRED');
    });
    const shared = await active(member);
    await t.test('technical evidence only, safe DTOs, derivative vs archival matrix and no premature visibility', async () => {
      for (const actor of [owner, manager, member, other, guest]) ok(await call(actor, 'media.get', { id: shared.slot.photoId }));
      for (const actor of [owner, manager, member]) ok(await call(actor, 'media.archival', { id: shared.slot.photoId }));
      for (const actor of [other, guest]) await code(actor, 'media.archival', { id: shared.slot.photoId }, 'ACTION_FORBIDDEN');
      await code(outsider, 'media.get', { id: shared.slot.photoId }, 'RESOURCE_NOT_FOUND');
      const pending = await begin(member); await code(member, 'media.get', { id: pending.files[0]!.photoId }, 'RESOURCE_NOT_FOUND');
      const text = JSON.stringify(await call(guest, 'media.get', { id: shared.slot.photoId }));
      for (const name of ['objectKey', 'sha256', 'email', 'projectId', 'projectName', 'claimId']) assert.ok(!text.includes(name));
      await code(member, 'media.finalize', { slotId: shared.slot.id, assets: evidence(shared.ticket) }, 'VALIDATION_ERROR');
      await assert.rejects(rpc.query('SELECT travel_map_jobs.claim($1)', ['process']), { code: '42501' });
    });
    await t.test('duplicate reservation/finalization and actual accounting occur once; me uses private authoritative ledger', async () => {
      const before = await quota(member); const op = await begin(member), s = op.files[0]!;
      assert.deepEqual(await reserve(member, s), await reserve(member, s));
      await code(member, 'media.reserve', { slotId: s.id, reservedBytes: 999 }, 'OPERATION_CONFLICT');
      const ticket = await ticketFor('process', s.photoId), proof = evidence(ticket); ok(await record(ticket, 'processed', proof)); ok(await record(ticket, 'processed', proof));
      ok(await call(member, 'media.finalize', { slotId: s.id })); ok(await call(member, 'media.finalize', { slotId: s.id }));
      assert.deepEqual(await quota(member), { used: before.used + 175, reserved: before.reserved });
      const me = ok(await call(member, 'me')).storage as { usedBytes: number }; assert.equal(me.usedBytes, before.used + 175);
      const changed = structuredClone(proof); changed.assets[0]!.byteLength++;
      assert.equal((await record(ticket, 'processed', changed)).error, 'OPERATION_CONFLICT');
    });
    await t.test('processing evidence validates scope/total/variant dimensions atomically and rejects arbitrary keys', async () => {
      const op = await begin(member), s = op.files[0]!; await reserve(member, s, 100);
      const ticket = await ticketFor('process', s.photoId), proof = evidence(ticket);
      assert.equal((await record(ticket, 'processed', proof)).error, 'VALIDATION_ERROR');
      assert.equal((await db.query("SELECT count(*)::int n FROM travel_map.photo_assets WHERE attempt_id=(SELECT attempt_id FROM travel_map.media_tasks WHERE id=$1) AND status='verified'", [ticket.id])).rows[0].n, 0);
      const invalid = structuredClone(proof); invalid.assets[1]!.assetId = randomUUID();
      assert.equal((await record(ticket, 'processed', invalid)).error, 'VALIDATION_ERROR');
      assert.equal((await record(ticket, 'processed', { ...proof, objectKey: 'forbidden' })).error, 'VALIDATION_ERROR');
      await code(member, 'media.finalize', { slotId: s.id }, 'OPERATION_CONFLICT');
      ok(await call(member, 'media.cancel', { slotId: s.id })); const cleanup = await ticketFor('cleanup', s.photoId);
      const before = await quota(member);
      assert.equal((await record(cleanup, 'absent', { assetId: cleanup.assets[0]!.id })).error, 'OPERATION_CONFLICT');
      assert.deepEqual(await quota(member), before);
      await completeCleanup(cleanup); assert.equal((await quota(member)).reserved, before.reserved - 100);
    });
    await t.test('uncertainty, cancellation, partial cleanup and duplicate release retain correct quota; stale completion fenced', async () => {
      const op = await begin(member), s = op.files[0]!; await reserve(member, s); const ticket = await ticketFor('process', s.photoId), before = await quota(member);
      ok(await call(member, 'media.cancel', { slotId: s.id })); assert.deepEqual(await quota(member), before);
      await code(member, 'media.reserve', { slotId: s.id, reservedBytes: 1000 }, 'OPERATION_CONFLICT');
      assert.equal((await record(ticket, 'processed', evidence(ticket))).error, 'OPERATION_CONFLICT');
      const cleanup = await ticketFor('cleanup', s.photoId); ok(await record(cleanup, 'writes_settled'));
      ok(await record(cleanup, 'absent', { assetId: cleanup.assets[0]!.id })); assert.deepEqual(await quota(member), before);
      for (const a of cleanup.assets) { ok(await record(cleanup, 'absent', { assetId: a.id })); ok(await record(cleanup, 'absent', { assetId: a.id })); }
      assert.equal((await quota(member)).reserved, before.reserved - 1000);
      const next = await reserve(member, s); assert.equal(next.generation, 2);
      assert.equal((await record(cleanup, 'absent', { assetId: cleanup.assets[0]!.id })).error, 'OPERATION_CONFLICT');
    });
    await t.test('expired lease fences to cleanup without releasing reservation or reissuing writer', async () => {
      const op = await begin(guest), s = op.files[0]!; await reserve(guest, s); const ticket = await ticketFor('process', s.photoId);
      await db.query("UPDATE travel_map.media_tasks SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1", [ticket.id]);
      const before = await quota(guest), cleanup = await ticketFor('cleanup', s.photoId); assert.deepEqual(await quota(guest), before);
      assert.equal((await record(ticket, 'processed', evidence(ticket))).error, 'OPERATION_CONFLICT');
      await completeCleanup(cleanup); assert.equal((await quota(guest)).reserved, before.reserved - 1000);
    });
    await t.test('independent technical connections cannot double-release the last cleanup confirmation', async () => {
      const op = await begin(member), s = op.files[0]!; await reserve(member, s);
      ok(await call(member, 'media.cancel', { slotId: s.id })); const ticket = await ticketFor('cleanup', s.photoId);
      ok(await record(ticket, 'writes_settled'));
      for (const a of ticket.assets.slice(0, 2)) ok(await record(ticket, 'absent', { assetId: a.id }));
      const before = await quota(member), a = await connect(), b = await connect(undefined, 'e41-contender');
      await a.query('SET SESSION AUTHORIZATION travel_map_media_maintenance'); await b.query('SET SESSION AUTHORIZATION travel_map_media_maintenance');
      await a.query('BEGIN'); ok(await record(ticket, 'absent', { assetId: ticket.assets[2]!.id }, a));
      ok(await blocked(a, () => record(ticket, 'absent', { assetId: ticket.assets[2]!.id }, b)));
      assert.equal((await quota(member)).reserved, before.reserved - 1000);
      assert.equal((await db.query("SELECT count(*)::int n FROM travel_map.domain_audit_events WHERE resource_id=$1 AND action='photo_cleanup_completed'", [s.photoId])).rows[0].n, 1);
    });
    await t.test('per-file success, failure and retry are independent within one operation and exact charge', async () => {
      const before = await quota(member), op = await begin(member, f.visit, 3);
      for (const slot of op.files) await reserve(member, slot);
      for (const slot of [op.files[0]!, op.files[2]!]) {
        const ticket = await ticketFor('process', slot.photoId); ok(await record(ticket, 'processed', evidence(ticket)));
        ok(await call(member, 'media.finalize', { slotId: slot.id }));
      }
      const failed = op.files[1]!; ok(await call(member, 'media.cancel', { slotId: failed.id }));
      await completeCleanup(await ticketFor('cleanup', failed.photoId));
      assert.equal((await call(member, 'media.operation', { id: op.id })).status, 'partial_failure');
      assert.deepEqual(await quota(member), { used: before.used + 350, reserved: before.reserved });
      await reserve(member, failed); const retry = await ticketFor('process', failed.photoId);
      ok(await record(retry, 'processed', evidence(retry))); ok(await call(member, 'media.finalize', { slotId: failed.id }));
      assert.equal((await call(member, 'media.operation', { id: op.id })).status, 'completed');
      assert.deepEqual(await quota(member), { used: before.used + 525, reserved: before.reserved });
      assert.equal(new Set(op.files.map(s => s.photoId)).size, 3);
    });
    await t.test('negative, overflow and exact quota boundaries fail closed', async () => {
      const actor = await seed('boundary');
      await db.query('INSERT INTO travel_map.project_memberships(project_id,user_id,role) VALUES($1,$2,\'member\')', [f.project, actor.id]);
      const op = await begin(actor, f.visit, 2); await reserve(actor, op.files[0]!, 500000000);
      await code(actor, 'media.reserve', { slotId: op.files[1]!.id, reservedBytes: 1 }, 'QUOTA_EXCEEDED');
      for (const v of [-1, 0, 500000001, '9223372036854775808']) await code(actor, 'media.reserve', { slotId: op.files[1]!.id, reservedBytes: v }, 'VALIDATION_ERROR');
      await assert.rejects(db.query('UPDATE travel_map.user_media_quotas SET used_bytes=-1 WHERE user_id=$1', [actor.id]), { code: '23514' });
      await assert.rejects(db.query('UPDATE travel_map.user_media_quotas SET limit_bytes=600000000 WHERE user_id=$1', [actor.id]), { code: '23514' });
      await assert.rejects(db.query('UPDATE travel_map.user_media_quotas SET used_bytes=1 WHERE user_id=$1', [actor.id]), { code: '23514' });
      // Synthetic trusted manifest only: exact committed-byte boundary, no 500 MB object generated.
      const ticket = await ticketFor('process', op.files[0]!.photoId), proof = evidence(ticket);
      proof.assets.forEach((a, i) => { a.byteLength = i === 0 ? 499999998 : 1; });
      ok(await record(ticket, 'processed', proof)); ok(await call(actor, 'media.finalize', { slotId: op.files[0]!.id }));
      assert.deepEqual(await quota(actor), { used: 500000000, reserved: 0 });
      await code(actor, 'media.reserve', { slotId: op.files[1]!.id, reservedBytes: 1 }, 'QUOTA_EXCEEDED');
    });
    async function secondSession(actor: Actor): Promise<Actor> {
      const hash = createHash('sha256').update(randomUUID()).digest('hex');
      await db.query("INSERT INTO travel_map.app_sessions(user_id,token_digest,expires_at,idle_expires_at) VALUES($1,$2,clock_timestamp()+interval '1 day',clock_timestamp()+interval '30 minutes')", [actor.id, hash]); return { id: actor.id, hash };
    }
    async function blocked(first: pg.Client, work: () => Promise<Result>): Promise<Result> {
      const pending = work(); let waiting = false;
      for (let i = 0; i < 300; i++) {
        await db.query('SELECT pg_stat_clear_snapshot()');
        if ((await db.query("SELECT count(*)::int n FROM pg_stat_activity WHERE datname=current_database() AND application_name='e41-contender' AND wait_event_type='Lock'")).rows[0].n) { waiting = true; break; }
        await new Promise(done => setTimeout(done, 10));
      }
      await first.query('COMMIT'); const result = await pending; assert.equal(waiting, true, 'Independent connection exhibited real lock contention'); return result;
    }
    await t.test('independent sessions/connections competing at quota lock cannot overreserve', async () => {
      const actor = await seed('concurrency'); await db.query("INSERT INTO travel_map.project_memberships(project_id,user_id,role) VALUES($1,$2,'member')", [f.project, actor.id]);
      const second = await secondSession(actor), op = await begin(actor, f.visit, 2), a = await connect(apiRole), b = await connect(apiRole, 'e41-contender');
      await a.query('BEGIN'); ok(await call(actor, 'media.reserve', { slotId: op.files[0]!.id, reservedBytes: 300000000 }, a));
      const result = await blocked(a, () => call(second, 'media.reserve', { slotId: op.files[1]!.id, reservedBytes: 300000000 }, b));
      assert.equal(result.error, 'QUOTA_EXCEEDED'); assert.deepEqual(await quota(actor), { used: 0, reserved: 300000000 });
    });
    await t.test('independent same-key requests and simultaneous finalization produce one operation/charge', async () => {
      const second = await secondSession(member), a = await connect(apiRole), b = await connect(apiRole, 'e41-contender');
      const intent = { visitId: f.visit, idempotencyKey: randomUUID(), files: [{ clientFileId: 'same', declaredBytes: 100 }] };
      const [x, y] = await Promise.all([call(member, 'media.begin', intent, a), call(second, 'media.begin', intent, b)]); assert.deepEqual(x, y); ok(x);
      const op = x as unknown as Operation, s = op.files[0]!; await reserve(member, s);
      const ticket = await ticketFor('process', s.photoId); ok(await record(ticket, 'processed', evidence(ticket)));
      const before = await quota(member);
      const results = await Promise.all([call(member, 'media.finalize', { slotId: s.id }, a), call(second, 'media.finalize', { slotId: s.id }, b)]); results.forEach(ok);
      assert.deepEqual(await quota(member), { used: before.used + 175, reserved: before.reserved - 1000 });
    });
    await t.test('audit failure rolls back finalization, ledger and Photo visibility', async () => {
      const op = await begin(member), s = op.files[0]!; await reserve(member, s); const ticket = await ticketFor('process', s.photoId); ok(await record(ticket, 'processed', evidence(ticket))); const before = await quota(member);
      await db.query("CREATE FUNCTION public.e41_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic audit fault'; END; $$");
      await db.query('CREATE TRIGGER e41_fail_audit BEFORE INSERT ON travel_map.domain_audit_events FOR EACH ROW EXECUTE FUNCTION public.e41_fail_audit()');
      try { await assert.rejects(call(member, 'media.finalize', { slotId: s.id })); assert.deepEqual(await quota(member), before); assert.equal((await db.query('SELECT status FROM travel_map.photos WHERE id=$1', [s.photoId])).rows[0].status, 'processing'); }
      finally { await db.query('DROP TRIGGER e41_fail_audit ON travel_map.domain_audit_events'); await db.query('DROP FUNCTION public.e41_fail_audit()'); }
      ok(await call(member, 'media.finalize', { slotId: s.id }));
    });
    await t.test('description/trash creator and administrator rules; immutable ancestry and metadata rejection', async () => {
      for (const actor of [member, owner, manager]) ok(await call(actor, 'media.describe', { id: shared.slot.photoId, description: 'Synthetic description' }));
      for (const actor of [other, guest]) { await code(actor, 'media.describe', { id: shared.slot.photoId, description: 'denied' }, 'ACTION_FORBIDDEN'); await code(actor, 'media.trash', { id: shared.slot.photoId }, 'ACTION_FORBIDDEN'); }
      await code(member, 'media.describe', { id: shared.slot.photoId, creatorId: other.id }, 'VALIDATION_ERROR');
      await assert.rejects(db.query('UPDATE travel_map.photos SET visit_id=$1 WHERE id=$2', [f.otherVisit, shared.slot.photoId]), { code: '23514' });
      await assert.rejects(db.query("UPDATE travel_map.photos SET status='purged',purged_at=clock_timestamp() WHERE id=$1", [shared.slot.photoId]), { code: '23514' });
    });
    await t.test('trash hides ordinary media/list immediately, retains quota; restore requires fresh trusted availability', async () => {
      const before = await quota(member); ok(await call(member, 'media.trash', { id: shared.slot.photoId })); assert.deepEqual(await quota(member), before);
      const row = (await db.query('SELECT EXTRACT(EPOCH FROM purge_after-trashed_at)::int seconds FROM travel_map.photos WHERE id=$1', [shared.slot.photoId])).rows[0]; assert.equal(row.seconds, 2592000);
      for (const actor of [owner, member, guest]) await code(actor, 'media.get', { id: shared.slot.photoId }, 'RESOURCE_NOT_FOUND');
      assert.equal(((await call(other, 'media.list', { visitId: f.visit, state: 'trashed' })).items as unknown[]).length, 0);
      assert.equal((await call(manager, 'media.restore', { id: shared.slot.photoId })).status, 'restoring');
      await code(manager, 'media.restore', { id: shared.slot.photoId }, 'OPERATION_CONFLICT');
      const ticket = await ticketFor('restore', shared.slot.photoId); ok(await record(ticket, 'available', { assetIds: ticket.assets.map(a => a.id) }));
      ok(await call(manager, 'media.restore', { id: shared.slot.photoId })); assert.deepEqual(await quota(member), before);
      const row2 = (await db.query('SELECT creator_id,visit_id,status FROM travel_map.photos WHERE id=$1', [shared.slot.photoId])).rows[0];
      assert.deepEqual(row2, { creator_id: member.id, visit_id: f.visit, status: 'active' });
      ok(await call(member, 'media.trash', { id: shared.slot.photoId }));
      assert.equal((await call(member, 'media.restore', { id: shared.slot.photoId })).status, 'restoring');
      await code(member, 'media.restore', { id: shared.slot.photoId }, 'OPERATION_CONFLICT');
      const freshTicket = await ticketFor('restore', shared.slot.photoId);
      assert.equal((await record(ticket, 'available', { assetIds: ticket.assets.map(a => a.id) })).error, 'OPERATION_CONFLICT');
      ok(await record(freshTicket, 'available', { assetIds: freshTicket.assets.map(a => a.id) }));
      ok(await call(member, 'media.restore', { id: shared.slot.photoId }));
      await code(member, 'media.restore', { id: shared.slot.photoId }, 'OPERATION_CONFLICT');
    });
    const expireTrash = async (id: string) => {
      // Fixture clock only: no production clock override or API deadline parameter.
      await db.query("UPDATE travel_map.photos SET trashed_at=statement_timestamp()-interval '2592001 seconds',purge_after=statement_timestamp()-interval '1 second' WHERE id=$1", [id]);
      await db.query("UPDATE travel_map.media_tasks SET eligible_at=clock_timestamp()-interval '1 second' WHERE photo_id=$1 AND kind='purge' AND state='pending'", [id]);
    };
    await t.test('restore exactly at deadline/after fails; no premature purge; partial deletion releases only confirmed bytes once', async () => {
      const value = await active(guest); ok(await call(guest, 'media.trash', { id: value.slot.photoId }));
      const future = (await technical.query("SELECT travel_map_jobs.claim('purge') r")).rows[0].r; assert.equal(future.idle, true);
      const deadline = (await db.query(`SELECT to_char(purge_after AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')||'Z' purge_after FROM travel_map.photos WHERE id=$1`, [value.slot.photoId])).rows[0].purge_after as string;
      const originalClock = (await db.query("SELECT pg_get_functiondef('travel_map.media_retention_now()'::regprocedure) d")).rows[0].d as string;
      try {
        // Test-owner DDL in this disposable DB only: exact equality is not approximated with a sleep.
        await db.query(`CREATE OR REPLACE FUNCTION travel_map.media_retention_now() RETURNS timestamptz LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path=pg_catalog SET timezone='UTC' AS $$ SELECT '${deadline}'::timestamptz; $$`);
        await code(guest, 'media.restore', { id: value.slot.photoId }, 'OPERATION_CONFLICT');
      } finally { await db.query(originalClock); }
      await expireTrash(value.slot.photoId); await code(guest, 'media.restore', { id: value.slot.photoId }, 'OPERATION_CONFLICT');
      const ticket = await ticketFor('purge', value.slot.photoId), before = await quota(guest);
      await code(guest, 'media.restore', { id: value.slot.photoId }, 'RESOURCE_NOT_FOUND');
      const size = Number((await db.query('SELECT byte_length FROM travel_map.photo_assets WHERE id=$1', [ticket.assets[0]!.id])).rows[0].byte_length);
      ok(await record(ticket, 'absent', { assetId: ticket.assets[0]!.id })); assert.equal((await quota(guest)).used, before.used - size);
      ok(await record(ticket, 'absent', { assetId: ticket.assets[0]!.id })); assert.equal((await quota(guest)).used, before.used - size);
      for (const a of ticket.assets) ok(await record(ticket, 'absent', { assetId: a.id })); assert.equal((await quota(guest)).used, before.used - 175);
      assert.equal((await db.query('SELECT status FROM travel_map.photos WHERE id=$1', [value.slot.photoId])).rows[0].status, 'purged');
    });
    await t.test('restore/purge contention uses quota/parent locks, purge claim prevents activation', async () => {
      const value = await active(member); ok(await call(member, 'media.trash', { id: value.slot.photoId }));
      assert.equal((await call(member, 'media.restore', { id: value.slot.photoId })).status, 'restoring');
      const restoring = await ticketFor('restore', value.slot.photoId); ok(await record(restoring, 'available', { assetIds: restoring.assets.map(a => a.id) }));
      await expireTrash(value.slot.photoId);
      const a = await connect(); await a.query('SET SESSION AUTHORIZATION travel_map_media_maintenance'); await a.query('BEGIN');
      const purge = (await a.query("SELECT travel_map_jobs.claim('purge') r")).rows[0].r as Ticket; assert.ok(purge.id);
      const b = await connect(apiRole, 'e41-contender');
      const result = await blocked(a, () => call(member, 'media.restore', { id: value.slot.photoId }, b)); assert.equal(result.error, 'RESOURCE_NOT_FOUND');
      assert.equal((await record(restoring, 'available', { assetIds: restoring.assets.map(x => x.id) })).error, 'OPERATION_CONFLICT');
    });
    await t.test('creator departure retains Photos/charge but removes access/editing; administrators retain management', async () => {
      const fresh = await fixture(), value = await active(member, fresh.visit), before = await quota(member);
      ok(await call(owner, 'collaboration.remove', { id: fresh.project, userId: member.id }));
      for (const action of ['media.get', 'media.trash', 'media.restore', 'media.archival']) await code(member, action, { id: value.slot.photoId }, 'RESOURCE_NOT_FOUND');
      assert.deepEqual(await quota(member), before);
      assert.equal((await db.query('SELECT creator_id FROM travel_map.photos WHERE id=$1', [value.slot.photoId])).rows[0].creator_id, member.id);
      ok(await call(manager, 'media.trash', { id: value.slot.photoId }));
      assert.equal((await db.query('SELECT count(*)::int n FROM travel_map.visits WHERE id=$1', [fresh.visit])).rows[0].n, 1);
    });
    await t.test('member removal during finalization and archive before reservation deny subsequent operations', async () => {
      const fresh = await fixture(), op = await begin(member, fresh.visit), slot = op.files[0]!; await reserve(member, slot);
      const ticket = await ticketFor('process', slot.photoId); ok(await record(ticket, 'processed', evidence(ticket)));
      const a = await connect(apiRole), b = await connect(apiRole, 'e41-contender'); await a.query('BEGIN');
      ok(await call(owner, 'collaboration.remove', { id: fresh.project, userId: member.id }, a));
      const result = await blocked(a, () => call(member, 'media.finalize', { slotId: slot.id }, b)); assert.equal(result.error, 'RESOURCE_NOT_FOUND');
      const fresh2 = await fixture(), op2 = await begin(member, fresh2.visit); ok(await call(owner, 'collaboration.archive', { id: fresh2.project }));
      await code(member, 'media.reserve', { slotId: op2.files[0]!.id, reservedBytes: 1000 }, 'RESOURCE_NOT_FOUND');
    });
    await t.test('same Place does not grant cross-Project access; inactive ancestors and revoked Guest hide retained media', async () => {
      const project = randomUUID(), trip = randomUUID(), visit = randomUUID();
      await db.query("INSERT INTO travel_map.projects(id,owner_user_id,name) VALUES($1,$2,'Foreign synthetic Project')", [project, outsider.id]);
      await db.query("INSERT INTO travel_map.trips(id,project_id,created_by_user_id,name) VALUES($1,$2,$3,'Foreign synthetic Trip')", [trip, project, outsider.id]);
      await db.query("INSERT INTO travel_map.visits(id,trip_id,place_id,created_by_user_id) VALUES($1,$2,'44576a98-98a4-55e0-b879-360717211efb',$3)", [visit, trip, outsider.id]);
      const foreign = await active(outsider, visit);
      for (const actor of [owner, member, guest]) await code(actor, 'media.get', { id: foreign.slot.photoId }, 'RESOURCE_NOT_FOUND');
      const fresh = await fixture(), value = await active(guest, fresh.visit);
      for (const [table, id] of [['visits', fresh.visit], ['trips', fresh.trip], ['projects', fresh.project]] as const) {
        await db.query(`UPDATE travel_map.${table} SET status='archived',archived_at=clock_timestamp() WHERE id=$1`, [id]);
        await code(guest, 'media.get', { id: value.slot.photoId }, 'RESOURCE_NOT_FOUND');
        await db.query(`UPDATE travel_map.${table} SET status='active',archived_at=NULL WHERE id=$1`, [id]);
      }
      await db.query("UPDATE travel_map.trip_memberships SET status='revoked',revoked_at=clock_timestamp() WHERE trip_id=$1 AND user_id=$2", [fresh.trip, guest.id]);
      await code(guest, 'media.get', { id: value.slot.photoId }, 'RESOURCE_NOT_FOUND');
      await code(guest, 'media.describe', { id: value.slot.photoId, description: 'denied former creator' }, 'RESOURCE_NOT_FOUND');
      ok(await call(owner, 'media.get', { id: value.slot.photoId }));
    });
    await t.test('session logout serializes with queued media mutations without revoking unrelated sessions', async () => {
      const second = await secondSession(member), op = await begin(second), a = await connect(apiRole), b = await connect(apiRole, 'e41-contender');
      await a.query('BEGIN'); ok(await call(second, 'logout', {}, a));
      const r = await blocked(a, () => call(second, 'media.reserve', { slotId: op.files[0]!.id, reservedBytes: 1000 }, b)); assert.equal(r.error, 'SESSION_REQUIRED');
      ok(await call(member, 'me'));
    });
    await t.test('absolute session expiry while waiting for a parent lock is rechecked before media mutation', async () => {
      const actor = await seed('expires during lock');
      await db.query("INSERT INTO travel_map.project_memberships(project_id,user_id,role) VALUES($1,$2,'member')", [f.project, actor.id]);
      const op = await begin(actor), a = await connect(), b = await connect(apiRole, 'e41-contender');
      await db.query("UPDATE travel_map.app_sessions SET expires_at=statement_timestamp()+interval '150 milliseconds',idle_expires_at=statement_timestamp()+interval '100 milliseconds' WHERE token_digest=$1", [actor.hash]);
      await a.query('BEGIN'); await a.query('SELECT 1 FROM travel_map.projects WHERE id=$1 FOR UPDATE', [f.project]);
      const pending = call(actor, 'media.reserve', { slotId: op.files[0]!.id, reservedBytes: 1000 }, b);
      let waiting = false;
      for (let i = 0; i < 100; i++) {
        await db.query('SELECT pg_stat_clear_snapshot()');
        if ((await db.query("SELECT count(*)::int n FROM pg_stat_activity WHERE datname=current_database() AND application_name='e41-contender' AND wait_event_type='Lock'")).rows[0].n) { waiting = true; break; }
        await new Promise(done => setTimeout(done, 5));
      }
      await new Promise(done => setTimeout(done, 200)); await a.query('COMMIT');
      assert.equal(waiting, true); assert.equal((await pending).error, 'SESSION_REQUIRED'); assert.equal((await quota(actor)).reserved, 0);
    });
    await t.test('pagination is deterministic, scoped and bounded; current Guest sees no sibling content', async () => {
      await active(member); await active(member);
      const first = ok(await call(guest, 'media.list', { visitId: f.visit, limit: 1 })).items as { id: string; createdAt: string }[]; assert.equal(first.length, 2);
      const next = ok(await call(guest, 'media.list', { visitId: f.visit, limit: 1, cursorTime: first[0]!.createdAt, cursorId: first[0]!.id })).items as { id: string }[]; assert.notEqual(next[0]!.id, first[0]!.id);
      await code(guest, 'media.list', { visitId: f.otherVisit }, 'RESOURCE_NOT_FOUND');
      await code(member, 'media.list', { visitId: f.visit, limit: 101 }, 'VALIDATION_ERROR');
    });
    await t.test('rollback refuses media history, audit is append-only/private and technical events have no fake actor', async () => {
      await assert.rejects(owned('down'), { code: '55000' }); assert.equal((await owned('status')).length, 7);
      await assert.rejects(db.query("UPDATE travel_map.domain_audit_events SET metadata='{}' WHERE resource_type='photo'"), { code: '42501' });
      const rows = (await db.query("SELECT actor_id,technical_principal,metadata FROM travel_map.domain_audit_events WHERE action IN ('photo_cleanup_completed','photo_purged')")).rows;
      assert.ok(rows.length); assert.ok(rows.every(r => r.actor_id === null && r.technical_principal === 'media_maintenance' && JSON.stringify(r.metadata) === '{}'));
      await assert.rejects(technical.query('UPDATE travel_map.user_media_quotas SET limit_bytes=500000000'), { code: '42501' });
      await assert.rejects(technical.query("SELECT travel_map.invitations_action($1,'invitations.list','{}')", [owner.id]), { code: '42501' });
      for (const r of rows) assert.ok(!/objectKey|sha256|token|GPS|EXIF|filename/.test(JSON.stringify(r)));
    });
  } finally {
    await Promise.allSettled(connections.map(c => c.end()));
    // Drop only the random DB this verified harness created, never a supplied target.
    if (created) await admin.query(`DROP DATABASE ${database}`);
    await admin.end();
  }
});
