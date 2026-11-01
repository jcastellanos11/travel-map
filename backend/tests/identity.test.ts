import assert from 'node:assert/strict';
import { EncryptJWT } from 'jose';
import { test } from 'node:test';
import type { User } from '@supabase/auth-js';
import { identityConfig } from '../src/env.ts';
import { googleIdentity, SupabaseIdentityProvider } from '../src/modules/identity/provider.ts';
import { cookie, csrf, digest, equal, openOAuth, randomToken, sealOAuth, setCookie, SESSION_COOKIE } from '../src/modules/identity/security.ts';
import { projectInput, projectQuery } from '../src/modules/projects/validation.ts';

export const testEnv = {
  APP_ENV:'test' as const,APP_ORIGIN:'https://app.example.invalid',SUPABASE_URL:'http://127.0.0.1:59999',
  SUPABASE_PUBLISHABLE_KEY:'synthetic-public-key',DATABASE_URL:'postgresql://synthetic@127.0.0.1/travel_map_test_e1',
  OAUTH_COOKIE_KEY:'a'.repeat(64),
};

test('opaque credentials, CSRF binding and secure host cookies',async()=>{
  const token=randomToken(); assert.equal(token.length,43); assert.notEqual(token,randomToken());
  assert.match(await digest(token),/^[0-9a-f]{64}$/);
  assert.notEqual(await csrf(token),await csrf(randomToken()));
  assert.ok(equal(await csrf(token),await csrf(token))); assert.ok(!equal('same','different'));
  assert.match(setCookie(SESSION_COOKIE,token,60),/Path=\/; HttpOnly; Secure; SameSite=Lax/);
  assert.ok(!setCookie(SESSION_COOKIE,token,60).includes('Domain='));
  assert.equal(cookie(new Request('https://app.example.invalid',{headers:{Cookie:`${SESSION_COOKIE}=a; ${SESSION_COOKIE}=b`}}),SESSION_COOKIE),null);
});

test('OAuth transaction encryption rejects tampering and wrong key',async()=>{
  const state={state:randomToken(),storage:{verifier:'synthetic-only'},flowId:'flow'};
  const sealed=await sealOAuth(state,testEnv.OAUTH_COOKIE_KEY);
  assert.ok(!sealed.includes('synthetic-only'));
  assert.deepEqual(await openOAuth(sealed,testEnv.OAUTH_COOKIE_KEY),state);
  await assert.rejects(openOAuth(sealed,'b'.repeat(64)));
  const expired=await new EncryptJWT({...state}).setProtectedHeader({alg:'dir',enc:'A256GCM'})
    .setIssuer('travel-map').setAudience('oauth-callback').setIssuedAt().setExpirationTime(Math.floor(Date.now()/1000)-1)
    .encrypt(new Uint8Array(32).fill(170));
  await assert.rejects(openOAuth(expired,testEnv.OAUTH_COOKIE_KEY));
  await assert.rejects(openOAuth(sealed.slice(0,30)+'x'+sealed.slice(31),testEnv.OAUTH_COOKIE_KEY));
});

test('official Supabase SDK initiates Google-only S256 PKCE with server storage',async()=>{
  const provider=new SupabaseIdentityProvider(identityConfig(testEnv));
  const started=await provider.begin('https://app.example.invalid/api/v1/auth/callback?state=synthetic');
  const url=new URL(started.url);
  assert.equal(url.searchParams.get('provider'),'google');
  assert.equal(url.searchParams.get('code_challenge_method'),'s256');
  assert.ok(url.searchParams.get('code_challenge'));
  assert.ok(started.flowId); assert.ok(Object.keys(started.storage).length>0);
  assert.ok(!url.toString().includes('code_verifier'));
});

test('provider assertions come from verified identity, never user-editable metadata',()=>{
  const base={id:crypto.randomUUID(),email:'synthetic@example.invalid',email_confirmed_at:new Date().toISOString(),
    app_metadata:{provider:'google'},identities:[{provider:'google'}],user_metadata:{full_name:'Synthetic'}} as unknown as User;
  assert.equal(googleIdentity(base).displayName,'Synthetic');
  assert.throws(()=>googleIdentity({...base,app_metadata:{provider:'email'},user_metadata:{provider:'google'}}));
  assert.throws(()=>googleIdentity({...base,identities:[]}));
  assert.throws(()=>googleIdentity({...base,email_confirmed_at:''}));
});

test('unsafe origin/provider/database configuration fails closed',()=>{
  for (const patch of [{APP_ORIGIN:'http://localhost:8789'}, {SUPABASE_URL:'http://cloud.example.invalid'},
    {DATABASE_URL:'postgresql://synthetic@localhost/db?sslmode=disable'}, {OAUTH_COOKIE_KEY:'invalid'},
    {APP_ENV:'prod' as const}]) assert.throws(()=>identityConfig({...testEnv,...patch}));
});

test('project validation rejects privilege injection, oversized bodies and malformed cursors',async()=>{
  const body=(value:unknown)=>new Request('https://app.example.invalid',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
  assert.deepEqual(await projectInput(body({name:'  Synthetic project  '})),{name:'Synthetic project',tripCreationPolicy:'admins_only'});
  for (const value of [{name:'x',ownerId:crypto.randomUUID()},{name:'x',role:'owner'},{name:''},{name:'x',tripCreationPolicy:'guests'},{name:'x',tripCreationPolicy:['admins_only']}]) {
    await assert.rejects(projectInput(body(value)));
  }
  await assert.rejects(projectInput(body({name:'a'.repeat(5000)})));
  assert.throws(()=>projectQuery(new URL('https://app.example.invalid?limit=101')));
  assert.throws(()=>projectQuery(new URL('https://app.example.invalid?cursor=garbage')));
});
