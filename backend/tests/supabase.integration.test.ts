// Real LOCAL Supabase Auth. Only the upstream Google result is synthetically
// seeded by the test administrator; no production route accepts this shortcut.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { GoTrueClient } from '@supabase/auth-js';
import pg from 'pg';
import { createTestHarness } from 'wrangler';
import { migrate } from '../scripts/migrations.ts';
import { handleRequest } from '../src/app.ts';
import { identityConfig } from '../src/env.ts';
import { PostgresRepository } from '../src/infrastructure/postgres.ts';
import { SupabaseIdentityProvider } from '../src/modules/identity/provider.ts';
import type { AppEnv } from '../src/env.ts';
import { googleIdentity } from '../src/modules/identity/provider.ts';
import { OAUTH_COOKIE, SESSION_COOKIE } from '../src/modules/identity/security.ts';

let status:{env:Record<string,string>;runtime:string}|undefined;
try {
  const text=await readFile(process.env.SUPABASE_LOCAL_STATUS_FILE??'.local/e1-supabase-start.log','utf8');
  for(const line of text.split('\n')){try{const parsed=JSON.parse(line);if(parsed.env)status=parsed;}catch{/* Ignore non-JSON CLI progress lines. */}}
}catch{/* Explicit skip below, never count missing infrastructure as validation. */}

test('actual local Supabase PKCE/getUser + app sessions; synthetic Google identity seed',{
  skip:!status?'Start the isolated E1 Supabase stack first':false,
},async(t)=>{
  assert.ok(status && status.runtime==='native');
  const {env}=status;
  for(const name of ['API_URL','DB_URL']) {
    assert.ok(['127.0.0.1','localhost','[::1]'].includes(new URL(env[name]!).hostname),'Local endpoints required');
  }
  const api=env.API_URL!;
  const provider=new GoTrueClient({url:`${api}/auth/v1`,headers:{apikey:env.ANON_KEY!},persistSession:false,autoRefreshToken:false,detectSessionInUrl:false});
  const management=new GoTrueClient({url:`${api}/auth/v1`,headers:{apikey:env.SERVICE_ROLE_KEY!,Authorization:`Bearer ${env.SERVICE_ROLE_KEY}`},
    persistSession:false,autoRefreshToken:false,detectSessionInUrl:false});
  const authDb=new pg.Client({connectionString:env.DB_URL});await authDb.connect();
  const database=`travel_map_test_${randomUUID().replaceAll('-','')}`;const role=`e1_auth_${randomUUID().replaceAll('-','')}`;
  let accountId:string|undefined;let created=false;let roleCreated=false;let db:pg.Client|undefined;
  const flowIds:string[]=[];
  try {
    const email=`e1-${randomUUID()}@example.invalid`;const password=`synthetic-${randomUUID()}`;
    const account=await management.admin.createUser({email,password,email_confirm:true,user_metadata:{full_name:'Synthetic native Auth'}});
    assert.equal(account.error,null);accountId=account.data.user!.id;
    await t.test('real Auth verifies a local token; invalid token and email-only Google assertion are denied',async()=>{
      const signed=await provider.signInWithPassword({email,password});assert.equal(signed.error,null);
      const user=await provider.getUser(signed.data.session!.access_token);assert.equal(user.error,null);assert.equal(user.data.user!.id,accountId);
      assert.throws(()=>googleIdentity(user.data.user!));
      assert.ok((await provider.getUser('synthetic-invalid-token')).error);
    });
    await management.admin.updateUserById(accountId,{app_metadata:{provider:'google',providers:['google']}});
    const subject=`synthetic-google-${randomUUID()}`;
    await authDb.query(`INSERT INTO auth.identities(provider_id,user_id,identity_data,provider,created_at,updated_at)
      VALUES($1,$2,$3,'google',now(),now())`,[subject,accountId,JSON.stringify({sub:subject,email,email_verified:true})]);
    await authDb.query(`CREATE DATABASE ${database}`);created=true;
    const dbUrl=new URL(env.DB_URL!);dbUrl.pathname=`/${database}`;
    db=new pg.Client({connectionString:dbUrl.toString()});await db.connect();await migrate(db,'up');
    await authDb.query(`CREATE ROLE ${role} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT`);roleCreated=true;
    await db.query(`GRANT USAGE ON SCHEMA travel_map TO ${role}`);
    await db.query(`GRANT EXECUTE ON FUNCTION travel_map.oauth_begin(text,text),travel_map.oauth_consume(text),
      travel_map.login_complete(text,jsonb,text,text),travel_map.api_call(text,text,jsonb) TO ${role}`);
    const runtimePassword=randomUUID();
    await authDb.query(`ALTER ROLE ${role} PASSWORD '${runtimePassword}'`);
    dbUrl.username=role;dbUrl.password=runtimePassword;
    const appEnv:AppEnv={APP_ENV:'test',APP_ORIGIN:'https://app.example.invalid',SUPABASE_URL:api,SUPABASE_PUBLISHABLE_KEY:env.ANON_KEY!,
      DATABASE_URL:dbUrl.toString(),OAUTH_COOKIE_KEY:'b'.repeat(64)};
    const call=(path:string,options:RequestInit={})=>handleRequest(new Request(new URL(path,appEnv.APP_ORIGIN),options),appEnv);
    await t.test('real Auth exchanges S256 code, synchronizes identity, creates private project and revokes logout',async()=>{
      const started=await call('/api/v1/auth/google/start');assert.equal(started.status,302);
      const authorize=new URL(started.headers.get('Location')!);
      const callback=new URL(authorize.searchParams.get('redirect_to')!);
      const code=randomUUID();
      const flowId=randomUUID();flowIds.push(flowId);
      // Emulates ONLY the upstream provider result at the Auth boundary. The
      // actual local Auth service must still verify PKCE and issue its own token.
      await authDb.query(`INSERT INTO auth.flow_state(id,user_id,auth_code,code_challenge_method,code_challenge,provider_type,
        authentication_method,created_at,updated_at,auth_code_issued_at,provider_access_token,provider_refresh_token) VALUES($1,$2,$3,'s256',$4,'google','oauth',now(),now(),now(),'','')`,
        [flowId,accountId,code,authorize.searchParams.get('code_challenge')]);
      callback.searchParams.set('code',code);
      const pending=started.headers.getSetCookie().find((value)=>value.startsWith(`${OAUTH_COOKIE}=`))!.split(';')[0]!;
      const diagnostics:{status:number;code:string}[]=[];
      const observedProvider=new SupabaseIdentityProvider(identityConfig(appEnv),async(input,init)=>{
        const response=await fetch(input,init);
        if(!response.ok){const failure=await response.clone().json() as {error_code?:string;code?:string};
          diagnostics.push({status:response.status,code:failure.error_code??failure.code??'unknown'});}
        return response;
      });
      const result=await handleRequest(new Request(callback,{headers:{Cookie:pending}}),appEnv,{repository:new PostgresRepository(dbUrl.toString()),provider:observedProvider});
      if(result.status!==303)t.diagnostic(JSON.stringify({identityErrors:diagnostics}));
      assert.equal(result.status,303);
      const session=result.headers.getSetCookie().find((value)=>value.startsWith(`${SESSION_COOKIE}=`))!.split(';')[0]!;
      const meResponse=await call('/api/v1/me',{headers:{Cookie:session}});assert.equal(meResponse.status,200);
      const me=await meResponse.json() as {id:string;csrfToken:string};
      const mapped=(await db!.query('SELECT id FROM travel_map.users WHERE supabase_auth_user_id=$1',[accountId])).rows[0];assert.equal(me.id,mapped.id);
      const headers={Cookie:session,Origin:appEnv.APP_ORIGIN!,'X-CSRF-Token':me.csrfToken,'Content-Type':'application/json'};
      const created=await call('/api/v1/projects',{method:'POST',headers,body:JSON.stringify({name:'Native Auth synthetic project'})});assert.equal(created.status,201);
      const listed=await call('/api/v1/projects',{headers:{Cookie:session}});assert.equal((await listed.json() as {items:unknown[]}).items.length,1);
      assert.equal((await call('/api/v1/auth/logout',{method:'POST',headers})).status,204);
      assert.equal((await call('/api/v1/me',{headers:{Cookie:session}})).status,401);
      assert.equal((await handleRequest(new Request(callback,{headers:{Cookie:pending}}),appEnv)).status,400);
    });
    await t.test('real Auth rejects a mismatched PKCE challenge without issuing an app session',async()=>{
      const before=(await db!.query('SELECT count(*)::int AS n FROM travel_map.app_sessions')).rows[0].n;
      const start=await call('/api/v1/auth/google/start');assert.equal(start.status,302);
      const authorize=new URL(start.headers.get('Location')!);
      const callback=new URL(authorize.searchParams.get('redirect_to')!);
      const code=randomUUID();const flowId=randomUUID();flowIds.push(flowId);
      await authDb.query(`INSERT INTO auth.flow_state(id,user_id,auth_code,code_challenge_method,code_challenge,provider_type,
        authentication_method,created_at,updated_at,auth_code_issued_at,provider_access_token,provider_refresh_token)
        VALUES($1,$2,$3,'s256',$4,'google','oauth',now(),now(),now(),'','')`,[flowId,accountId,code,'A'.repeat(43)]);
      callback.searchParams.set('code',code);
      const pending=start.headers.getSetCookie().find((value)=>value.startsWith(`${OAUTH_COOKIE}=`))!.split(';')[0]!;
      const result=await handleRequest(new Request(callback,{headers:{Cookie:pending}}),appEnv);assert.equal(result.status,400);
      assert.equal((await db!.query('SELECT count(*)::int AS n FROM travel_map.app_sessions')).rows[0].n,before);
    });
    await t.test('actual workerd integrates local Supabase PKCE and password-authenticated PostgreSQL',async()=>{
      const wrongUrl=new URL(dbUrl);wrongUrl.password=randomUUID();
      const wrongPassword=new pg.Client({connectionString:wrongUrl.toString(),connectionTimeoutMillis:5000});
      try {await assert.rejects(wrongPassword.connect(),{code:'28P01'});}
      finally {await wrongPassword.end();}
      const runtime=createTestHarness({workers:[{configPath:new URL('../wrangler.jsonc',import.meta.url),env:'test',
        prebuiltWorkerDir:new URL('../dist/',import.meta.url),
        vars:{APP_ENV:'test',APP_ORIGIN:appEnv.APP_ORIGIN!,SUPABASE_URL:api},
        secrets:{DATABASE_URL:dbUrl.toString(),SUPABASE_PUBLISHABLE_KEY:env.ANON_KEY!,OAUTH_COOKIE_KEY:appEnv.OAUTH_COOKIE_KEY!},
      }]});
      try {
        await runtime.listen();
        const start=await runtime.fetch(`${appEnv.APP_ORIGIN}/api/v1/auth/google/start`,{redirect:'manual'});
        assert.equal(start.status,302);
        const authorize=new URL(start.headers.get('Location')!);
        const callback=new URL(authorize.searchParams.get('redirect_to')!);
        const code=randomUUID();const flowId=randomUUID();flowIds.push(flowId);
        await authDb.query(`INSERT INTO auth.flow_state(id,user_id,auth_code,code_challenge_method,code_challenge,provider_type,
          authentication_method,created_at,updated_at,auth_code_issued_at,provider_access_token,provider_refresh_token)
          VALUES($1,$2,$3,'s256',$4,'google','oauth',now(),now(),now(),'','')`,
          [flowId,accountId,code,authorize.searchParams.get('code_challenge')]);
        callback.searchParams.set('code',code);
        const pending=start.headers.getSetCookie().find((value)=>value.startsWith(`${OAUTH_COOKIE}=`))!.split(';')[0]!;
        const finished=await runtime.fetch(callback,{headers:{Cookie:pending},redirect:'manual'});assert.equal(finished.status,303);
        const session=finished.headers.getSetCookie().find((value)=>value.startsWith(`${SESSION_COOKIE}=`))!.split(';')[0]!;
        const me=await runtime.fetch(`${appEnv.APP_ORIGIN}/api/v1/me`,{headers:{Cookie:session}});assert.equal(me.status,200);
        const data=await me.json() as {csrfToken:string};
        const headers={Cookie:session,Origin:appEnv.APP_ORIGIN!,'X-CSRF-Token':data.csrfToken,'Content-Type':'application/json'};
        const project=await runtime.fetch(`${appEnv.APP_ORIGIN}/api/v1/projects`,{method:'POST',headers,body:'{"name":"Native workerd project"}'});
        assert.equal(project.status,201);
        assert.equal((await runtime.fetch(`${appEnv.APP_ORIGIN}/api/v1/auth/logout`,{method:'POST',headers})).status,204);
        assert.equal((await runtime.fetch(`${appEnv.APP_ORIGIN}/api/v1/me`,{headers:{Cookie:session}})).status,401);
      }finally{await runtime.close();}
    });
  }finally{
    await db?.end();
    try {if(created)await authDb.query(`DROP DATABASE ${database}`);if(roleCreated)await authDb.query(`DROP ROLE ${role}`);}
    finally {
      try {if(flowIds.length)await authDb.query('DELETE FROM auth.flow_state WHERE id=ANY($1::uuid[])',[flowIds]);}
      finally {await authDb.end();if(accountId)await management.admin.deleteUser(accountId);}
    }
  }
});
