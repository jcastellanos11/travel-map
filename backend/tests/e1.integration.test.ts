import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import pg from 'pg';
import { createTestHarness } from 'wrangler';
import { handleRequest } from '../src/app.ts';
import type { AppEnv } from '../src/env.ts';
import { PostgresRepository } from '../src/infrastructure/postgres.ts';
import { digest, SESSION_COOKIE, OAUTH_COOKIE, randomToken, openOAuth } from '../src/modules/identity/security.ts';
import { loadMigrations as loadAllMigrations, localDatabaseUrl, migrate as migrateAll } from '../scripts/migrations.ts';
import { providerFixture, syntheticGoogleUser } from './helpers/provider-fixture.ts';

// Exercise the original E1 schema independently of later migrations.
const loadMigrations = async () => (await loadAllMigrations()).slice(0, 2);
const migrate = async (client: pg.Client, direction: 'up'|'down'|'status') => migrateAll(client, direction, await loadMigrations());

const configured=process.env.DATABASE_URL;
test('E1 actual PostgreSQL + SDK + HTTP security; synthetic OAuth transport',{
  skip:!configured?'Use npm run db:local:test with PG_BIN':false,
},async(t)=>{
  const url=new URL(localDatabaseUrl(configured,process.env.LOCAL_DATABASE_ONLY));
  const database=`travel_map_test_${randomUUID().replaceAll('-','')}`;
  const role=`e1_api_${randomUUID().replaceAll('-','')}`;
  const adminUrl=new URL(url);adminUrl.pathname='/postgres';
  const admin=new pg.Client({connectionString:adminUrl.toString()});await admin.connect();
  let db:pg.Client|undefined;let created=false;let roleCreated=false;
  const fixture=await providerFixture();
  try {
    await admin.query(`CREATE DATABASE ${database}`);created=true;url.pathname=`/${database}`;
    db=new pg.Client({connectionString:url.toString()});await db.connect();
    await migrate(db,'up');
    await admin.query(`CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT`);roleCreated=true;
    await db.query(`GRANT USAGE ON SCHEMA travel_map TO ${role}`);
    const grants=`GRANT EXECUTE ON FUNCTION travel_map.oauth_begin(text,text), travel_map.oauth_consume(text),
      travel_map.login_complete(text,jsonb,text,text), travel_map.api_call(text,text,jsonb) TO ${role}`;
    await db.query(grants);
    const runtimeUrl=new URL(url);runtimeUrl.username=role;runtimeUrl.password='';
    const env:AppEnv={APP_ENV:'test',APP_ORIGIN:'https://app.example.invalid',SUPABASE_URL:fixture.url,
      SUPABASE_PUBLISHABLE_KEY:'synthetic-public',DATABASE_URL:runtimeUrl.toString(),OAUTH_COOKIE_KEY:'a'.repeat(64)};
    type Fetcher=(request:Request)=>Promise<Response>;
    const nodeFetch:Fetcher=(request)=>handleRequest(request,env);
    const request=(path:string,session?:string,options:RequestInit={},fetcher:Fetcher=nodeFetch)=>{
      const headers=new Headers(options.headers);if(session)headers.set('Cookie',`${SESSION_COOKIE}=${session}`);
      return fetcher(new Request(new URL(path,env.APP_ORIGIN),{...options,headers}));
    };
    const alice=syntheticGoogleUser();const bob=syntheticGoogleUser();const inactive=syntheticGoogleUser();
    async function initiate(fetcher:Fetcher=nodeFetch) {
      const response=await request('/api/v1/auth/google/start',undefined,{},fetcher);assert.equal(response.status,302);
      const pending=response.headers.getSetCookie().find((value)=>value.startsWith(`${OAUTH_COOKIE}=`))!.split(';')[0]!;
      return {response,pending};
    }
    async function login(user=alice,fetcher:Fetcher=nodeFetch,old?:string) {
      const {response,pending}=await initiate(fetcher);const callback=fixture.issue(response.headers.get('Location')!,user);
      const saved=await openOAuth(pending.slice(OAUTH_COOKIE.length+1),env.OAUTH_COOKIE_KEY!);
      assert.equal(saved.state,callback.searchParams.get('state'));
      const before=fixture.exchanges();
      const result=await fetcher(new Request(callback,{headers:{Cookie:pending+(old?`; ${SESSION_COOKIE}=${old}`:'')}}));
      if(result.status!==303)t.diagnostic(JSON.stringify({callbackStatus:result.status,exchangeAttempts:fixture.exchanges()-before}));
      assert.equal(result.status,303);
      assert.equal(result.headers.get('Location'),`${env.APP_ORIGIN}/`);
      const set=result.headers.getSetCookie().find((value)=>value.startsWith(`${SESSION_COOKIE}=`))!;
      assert.match(set,/HttpOnly; Secure; SameSite=Lax/);assert.ok(!set.includes('Domain='));
      const token=set.split(';')[0]!.slice(SESSION_COOKIE.length+1);
      const me=await request('/api/v1/me',token,{},fetcher);assert.equal(me.status,200);
      return {token,me:await me.json() as {id:string;displayName:string;csrfToken:string}};
    }
    let a=await login(alice);let b=await login(bob);let projectId='';
    const mutate=(path:string,session:typeof a,body?:unknown,extra:Record<string,string>={})=>request(path,session.token,{
      method:'POST',headers:{Origin:env.APP_ORIGIN!,'X-CSRF-Token':session.me.csrfToken,'Content-Type':'application/json',...extra},
      ...(body===undefined?{}:{body:JSON.stringify(body)}),
    });
    await t.test('least-privilege runtime role has no direct table or migration access',async()=>{
      const client=new pg.Client({connectionString:runtimeUrl.toString()});await client.connect();
      try {
        await assert.rejects(client.query('SELECT * FROM travel_map.users'),{code:'42501'});
        await assert.rejects(client.query('INSERT INTO travel_map.projects(owner_user_id,name) VALUES($1,$2)',[a.me.id,'denied']),{code:'42501'});
        await assert.rejects(client.query('CREATE TABLE travel_map.forbidden(id int)'),{code:'42501'});
        const attributes=(await client.query('SELECT rolsuper,rolbypassrls,rolcreaterole FROM pg_roles WHERE rolname=current_user')).rows[0];
        assert.deepEqual(attributes,{rolsuper:false,rolbypassrls:false,rolcreaterole:false});
      } finally {await client.end();}
    });
    await t.test('verified subject syncs to stable application identity; no public credential bootstrap',async()=>{
      assert.notEqual(a.me.id,alice.id);
      assert.ok(!JSON.stringify(a.me).includes('supabase'));
      assert.equal((await request('/api/v1/projects')).status,401);
      assert.equal((await request('/api/v1/me',undefined,{headers:{Authorization:'Bearer synthetic-provider-token'}})).status,401);
      const updated=await login({...alice,user_metadata:{full_name:'Updated synthetic profile'}});
      assert.equal(updated.me.id,a.me.id);assert.equal(updated.me.displayName,'Updated synthetic profile');
      a=updated;
    });
    await t.test('create/list/get project derives owner from session and denies cross-user lookup',async()=>{
      const response=await mutate('/api/v1/projects',a,{name:'First synthetic project'});assert.equal(response.status,201);
      const project=await response.json() as {id:string;ownerUserId:string;tripCreationPolicy:string};projectId=project.id;
      assert.equal(project.ownerUserId,a.me.id);assert.equal(project.tripCreationPolicy,'admins_only');
      const own=await request('/api/v1/projects',a.token);assert.equal((await own.json() as {items:unknown[]}).items.length,1);
      const other=await request('/api/v1/projects',b.token);assert.equal((await other.json() as {items:unknown[]}).items.length,0);
      assert.equal((await request(`/api/v1/projects/${projectId}`,a.token)).status,200);
      const hidden=await request(`/api/v1/projects/${projectId}`,b.token);assert.equal(hidden.status,404);
      const absent=await request(`/api/v1/projects/${randomUUID()}`,b.token);assert.equal(absent.status,404);
      assert.equal((await hidden.json() as {error:{code:string}}).error.code,(await absent.json() as {error:{code:string}}).error.code);
      assert.equal((await mutate('/api/v1/projects',a,{name:'Injection',ownerId:b.me.id})).status,400);
    });
    await t.test('CSRF/origin checks reject writes and do not mutate project state',async()=>{
      assert.equal((await request('/api/v1/projects',a.token,{method:'POST',headers:{'Content-Type':'application/json'},body:'{"name":"denied"}'})).status,403);
      assert.equal((await mutate('/api/v1/projects',a,{name:'denied'},{Origin:'https://evil.example.invalid'})).status,403);
      assert.equal((await mutate('/api/v1/projects',a,{name:'denied'},{'X-CSRF-Token':b.me.csrfToken})).status,403);
      assert.equal((await mutate('/api/v1/auth/logout',a,undefined,{'Sec-Fetch-Site':'cross-site'})).status,403);
      assert.equal((await request('/api/v1/me',a.token)).status,200);
    });
    await t.test('current project membership grants access; revocation removes next read and list',async()=>{
      await db!.query("INSERT INTO travel_map.project_memberships(project_id,user_id,role) VALUES($1,$2,'member')",[projectId,b.me.id]);
      assert.equal((await request(`/api/v1/projects/${projectId}`,b.token)).status,200);
      await db!.query("UPDATE travel_map.project_memberships SET status='revoked',revoked_at=clock_timestamp() WHERE project_id=$1 AND user_id=$2",[projectId,b.me.id]);
      assert.equal((await request(`/api/v1/projects/${projectId}`,b.token)).status,404);
      assert.equal((await (await request('/api/v1/projects',b.token)).json() as {items:unknown[]}).items.length,0);
    });
    await t.test('unavailable authoritative database fails closed without a credential leak',async()=>{
      const unavailable={...env,DATABASE_URL:'postgresql://synthetic@127.0.0.1:1/travel_map_test_unavailable'};
      const response=await handleRequest(new Request(`${env.APP_ORIGIN}/api/v1/me`,{
        headers:{Cookie:`${SESSION_COOKIE}=${a.token}`},
      }),unavailable);
      assert.equal(response.status,503);
      const body=await response.text();assert.ok(body.includes('DEPENDENCY_UNAVAILABLE'));
      assert.ok(!body.includes('postgresql:'));assert.ok(!body.includes(a.token));
    });
    await t.test('cursor pagination is stable, bounded and scoped',async()=>{
      for(let i=0;i<3;i++)assert.equal((await mutate('/api/v1/projects',a,{name:`Page ${i}`,tripCreationPolicy:'all_project_members'})).status,201);
      const ids=new Set<string>();let cursor:string|null=null;
      do {
        const response=await request(`/api/v1/projects?limit=2${cursor?`&cursor=${encodeURIComponent(cursor)}`:''}`,a.token);assert.equal(response.status,200);
        const page=await response.json() as {items:{id:string}[];nextCursor:string|null};
        for(const item of page.items){assert.ok(!ids.has(item.id));ids.add(item.id);}cursor=page.nextCursor;
      }while(cursor);
      assert.equal(ids.size,4);
      assert.equal((await request('/api/v1/projects?limit=101',a.token)).status,400);
      assert.equal((await request('/api/v1/projects?cursor=invalid',a.token)).status,400);
    });
    await t.test('logout commits revocation before response; projects survive fresh login',async()=>{
      const old=a.token;const response=await mutate('/api/v1/auth/logout',a);assert.equal(response.status,204);
      assert.match(response.headers.get('Set-Cookie')!,/Max-Age=0/);
      const after=await Promise.all(Array.from({length:8},()=>request('/api/v1/me',old)));
      assert.ok(after.every((result)=>result.status===401));
      const relogged=await login(alice);assert.equal(relogged.me.id,a.me.id);a=relogged;
      assert.equal((await request(`/api/v1/projects/${projectId}`,a.token)).status,200);
    });
    await t.test('unknown, expired, idle-expired, revoked sessions and inactive accounts are denied',async()=>{
      assert.equal((await request('/api/v1/me',randomToken())).status,401);
      for(const mode of ['absolute','idle']) {
        const raw=randomToken();
        await db!.query(`INSERT INTO travel_map.app_sessions(user_id,token_digest,created_at,last_seen_at,expires_at,idle_expires_at)
          VALUES($1,$2,now()-interval '2 hours',now()-interval '2 hours',${mode==='absolute'?"now()-interval '1 hour'":"now()+interval '1 day'"},now()-interval '1 hour')`,[a.me.id,await digest(raw)]);
        assert.equal((await request('/api/v1/me',raw)).status,401);
      }
      await db!.query('UPDATE travel_map.app_sessions SET revoked_at=clock_timestamp() WHERE token_digest=$1',[await digest(b.token)]);
      assert.equal((await request('/api/v1/me',b.token)).status,401);b=await login(bob);
      const disabled=await login(inactive);
      await db!.query("UPDATE travel_map.users SET status='deletion_requested' WHERE id=$1",[disabled.me.id]);
      assert.equal((await request('/api/v1/me',disabled.token)).status,401);
    });
    await t.test('OAuth rejects missing/altered state and replay before creating additional sessions',async()=>{
      assert.equal((await request('/api/v1/auth/callback?code=synthetic')).status,400);
      const {response,pending}=await initiate();const callback=fixture.issue(response.headers.get('Location')!,alice);
      const bad=new URL(callback);bad.searchParams.set('state',randomToken());
      assert.equal((await nodeFetch(new Request(bad,{headers:{Cookie:pending}}))).status,400);
      const call=()=>nodeFetch(new Request(callback,{headers:{Cookie:pending}}));
      const pair=await Promise.all([call(),call()]);assert.deepEqual(pair.map((value)=>value.status).sort(),[303,400]);
      assert.equal((await call()).status,400);
    });
    await t.test('expired OAuth transaction and non-Google provider identity cannot create sessions',async()=>{
      const {response,pending}=await initiate();const callback=fixture.issue(response.headers.get('Location')!,alice);
      await db!.query('UPDATE travel_map.oauth_transactions SET expires_at=clock_timestamp()-interval \'1 second\' WHERE state_digest=$1',[await digest(callback.searchParams.get('state')!)]);
      assert.equal((await nodeFetch(new Request(callback,{headers:{Cookie:pending}}))).status,400);
      const started=await initiate();const wrong=fixture.issue(started.response.headers.get('Location')!,{...alice,app_metadata:{provider:'email'}});
      assert.equal((await nodeFetch(new Request(wrong,{headers:{Cookie:started.pending}}))).status,403);
    });
    await t.test('durable OAuth rate limit rejects the eleventh initiation in one minute',async()=>{
      const repo=new PostgresRepository(runtimeUrl.toString());const rate=await digest('synthetic-rate-limit');
      for(let i=0;i<10;i++)assert.equal(await repo.begin(await digest(randomToken()),rate),true);
      assert.equal(await repo.begin(await digest(randomToken()),rate),false);
    });
    // Avoid earlier fixture IP limits when checking the separate Worker instance.
    await db.query('DELETE FROM travel_map.oauth_transactions');
    await t.test('actual workerd runs pg + official Auth SDK and same HTTP data flow',async()=>{
      const runtime=createTestHarness({workers:[{configPath:new URL('../wrangler.jsonc',import.meta.url),env:'test',
        prebuiltWorkerDir:new URL('../dist/',import.meta.url),vars:{APP_ENV:'test',APP_ORIGIN:env.APP_ORIGIN!,SUPABASE_URL:fixture.url},
        secrets:{DATABASE_URL:runtimeUrl.toString(),SUPABASE_PUBLISHABLE_KEY:'synthetic-public',OAUTH_COOKIE_KEY:env.OAUTH_COOKIE_KEY!},
      }]});
      try {
        await runtime.listen();
        const runtimeFetch:Fetcher=async(request)=>runtime.fetch(request.url,{method:request.method,headers:Object.fromEntries(request.headers),redirect:'manual',...(request.body?{body:await request.text()}:{} )} ) as unknown as Response;
        const session=await login(alice,runtimeFetch,a.token);
        assert.equal(session.me.id,a.me.id);
        assert.equal((await request(`/api/v1/projects/${projectId}`,session.token,{},runtimeFetch)).status,200);
        assert.equal((await request('/api/v1/me',a.token)).status,401); // rotation revoked old browser session
      } finally {await runtime.close();}
    });
    await t.test('E1 down/up preserves E0 user/project data and restores deny-by-default grants',async()=>{
      const before=(await db!.query('SELECT count(*)::int AS n FROM travel_map.projects')).rows[0].n;
      assert.deepEqual(await migrate(db!,'down'),['0002_identity']);
      assert.equal((await db!.query('SELECT count(*)::int AS n FROM travel_map.projects')).rows[0].n,before);
      assert.deepEqual(await migrate(db!,'up'),['0002_identity']);
      assert.equal((await db!.query('SELECT count(*)::int AS n FROM travel_map.users')).rows[0].n,3);
      const manifests=await loadMigrations();assert.equal(manifests.length,2);
    });
  }finally{
    await fixture.close();await db?.end();
    try{if(created)await admin.query(`DROP DATABASE ${database}`);if(roleCreated)await admin.query(`DROP ROLE ${role}`);}finally{await admin.end();}
  }
});
