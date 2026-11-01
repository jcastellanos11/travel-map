// Real LOCAL Supabase Auth + PostgREST + PostgreSQL RLS; no Google or cloud.
import {Client} from 'pg';
import {randomBytes} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createRemoteJWKSet,jwtVerify,decodeProtectedHeader} from 'jose';
import {schema,seed} from '../shared/native-schema.mjs';
const root=new URL('../',import.meta.url);
let status;
for(const line of readFileSync(new URL('runs/supabase-native-start.log',root),'utf8').split('\n')){
 try{const x=JSON.parse(line);if(x.env)status=x;}catch{}
}
if(status?.runtime!=='native')throw new Error('expected_native_stack');
const config=status.env;
const api=config.API_URL.replace(/\/$/,'');
const service=config.SERVICE_ROLE_KEY;
const anon=config.ANON_KEY;
const db=new Client({connectionString:config.DB_URL});await db.connect();
const report={scope:'Actual LOCAL Supabase native Auth + PostgREST + RLS; no real Google or managed cloud',api,tests:[]};
const identities={};
async function check(id,work){try{const evidence=await work();report.tests.push({id,status:'PASS',evidence});console.log(`PASS ${id}`);}catch(error){report.tests.push({id,status:'FAIL',error:error.message});console.log(`FAIL ${id}: ${error.message}`);}}
async function auth(path,body,token=service,method='POST'){
 return fetch(api+'/auth/v1'+path,{method,headers:{apikey:anon,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(method==='GET'?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});
}
async function rest(path,token,method='GET',body){
 const r=await fetch(api+'/rest/v1/'+path,{method,headers:{apikey:anon,...(token?{Authorization:`Bearer ${token}`} : {}),'Content-Type':'application/json',Prefer:'count=exact'},...(body?{body:JSON.stringify(body)}:{})});
 let data;try{data=await r.json();}catch{}
 return {status:r.status,data,count:r.headers.get('content-range')};
}
await check('AUTH local service health and synthetic account creation',async()=>{
 const health=await fetch(api+'/auth/v1/health',{headers:{apikey:anon}});if(!health.ok)throw new Error(`auth_health_${health.status}`);
 for(const actor of ['owner','admin','member','guest','outsider']){
  const email=`poc-${actor}-${Date.now()}@example.invalid`;const password=randomBytes(24).toString('hex');
  const created=await auth('/admin/users',{email,password,email_confirm:true});
  if(!created.ok)throw new Error(`create_local_user_${actor}_${created.status}`);
  const user=await created.json();
  const signed=await auth('/token?grant_type=password',{email,password},anon);
  if(!signed.ok)throw new Error(`local_signin_${actor}_${signed.status}`);
  const tokens=await signed.json();
  if(!tokens.access_token||!tokens.refresh_token)throw new Error('missing_tokens');
  identities[actor]={id:user.id,access:tokens.access_token,refresh:tokens.refresh_token};
 }
 return {syntheticAccounts:Object.keys(identities).length,identityMethod:'LOCAL password grant as test transport only; NOT production Google verification'};
});

if(identities.guest){
 await check('AUTH valid token accepted; missing and tampered tokens rejected',async()=>{
  const good=await auth('/user',undefined,identities.guest.access,'GET');if(good.status!==200)throw new Error(`valid_${good.status}`);
  const token=identities.guest.access;const parts=token.split('.');const at=Math.floor(parts[2].length/2);parts[2]=parts[2].slice(0,at)+(parts[2][at]==='A'?'B':'A')+parts[2].slice(at+1);
  for(const bad of ['',parts.join('.'),'invalid']){const r=await auth('/user',undefined,bad,'GET');if(r.status<400)throw new Error('invalid_token_accepted');}
  return {valid:200,invalidCasesDenied:3};
 });
 await check('AUTH independent JWKS signature, issuer and audience validation',async()=>{
  const jwks=await fetch(api+'/auth/v1/.well-known/jwks.json',{headers:{apikey:anon}});if(!jwks.ok)throw new Error(`jwks_${jwks.status}`);
  const keys=await jwks.json();if(!keys.keys?.length)throw new Error('local_jwks_has_no_public_keys');
  const resolver=createRemoteJWKSet(new URL(api+'/auth/v1/.well-known/jwks.json'));
  const verified=await jwtVerify(identities.guest.access,resolver,{issuer:api+'/auth/v1',audience:'authenticated'});
  if(verified.payload.sub!==identities.guest.id)throw new Error('identity_mismatch');
  for(const options of [{issuer:'https://untrusted.invalid/auth/v1',audience:'authenticated'},{issuer:api+'/auth/v1',audience:'untrusted'}]){
   let denied=false;try{await jwtVerify(identities.guest.access,resolver,options);}catch{denied=true;}
   if(!denied)throw new Error('bad_claims_accepted');
  }
  return {alg:decodeProtectedHeader(identities.guest.access).alg,validSignature:true,wrongIssuerDenied:true,wrongAudienceDenied:true};
 });

 await check('RLS install isolated domain and deny-default policies',async()=>{
  await db.query(schema(true)+seed());
  await db.query(`CREATE SCHEMA IF NOT EXISTS poc_private;
   CREATE TABLE IF NOT EXISTS poc_private.identity_link(actor TEXT PRIMARY KEY,auth_id UUID UNIQUE NOT NULL);
   REVOKE ALL ON SCHEMA poc_private FROM PUBLIC,anon,authenticated;
   CREATE OR REPLACE FUNCTION public.poc_actor() RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
    SELECT actor FROM poc_private.identity_link WHERE auth_id=(SELECT auth.uid()) $$;
   CREATE OR REPLACE FUNCTION public.poc_trip_visible(target TEXT) RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
    SELECT EXISTS(SELECT 1 FROM public.trips t JOIN public.projects p ON p.id=t.project_id JOIN public.users u ON u.id=public.poc_actor()
    WHERE t.id=target AND t.state='active' AND p.state='active' AND u.active=1 AND
    (p.owner_id=u.id OR EXISTS(SELECT 1 FROM public.pm WHERE project_id=p.id AND user_id=u.id AND active=1)
    OR EXISTS(SELECT 1 FROM public.tm WHERE trip_id=t.id AND user_id=u.id AND active=1))) $$;
   CREATE OR REPLACE FUNCTION public.poc_photo_visible(target TEXT,variant TEXT) RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
    SELECT EXISTS(SELECT 1 FROM public.photos ph JOIN public.visits v ON v.id=ph.visit_id JOIN public.trips t ON t.id=v.trip_id JOIN public.projects p ON p.id=t.project_id
    WHERE ph.id=target AND ph.state='ready' AND v.state='active' AND public.poc_trip_visible(t.id)
    AND (variant='display' OR (variant='original' AND (ph.author_id=public.poc_actor() OR p.owner_id=public.poc_actor()
    OR EXISTS(SELECT 1 FROM public.pm WHERE project_id=p.id AND user_id=public.poc_actor() AND active=1 AND role='admin'))))) $$;
   CREATE TABLE IF NOT EXISTS public.poc_photo_media(photo_id TEXT REFERENCES public.photos(id),variant TEXT CHECK(variant IN ('original','display')),PRIMARY KEY(photo_id,variant));
   INSERT INTO public.poc_photo_media SELECT id,'original' FROM public.photos ON CONFLICT DO NOTHING;
   INSERT INTO public.poc_photo_media SELECT id,'display' FROM public.photos ON CONFLICT DO NOTHING;
   REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon,authenticated;
   GRANT USAGE ON SCHEMA public TO anon,authenticated;
   GRANT SELECT ON public.photos,public.visits,public.trips,public.projects,public.poc_photo_media TO anon,authenticated;
   REVOKE ALL ON FUNCTION public.poc_actor(),public.poc_trip_visible(TEXT),public.poc_photo_visible(TEXT,TEXT) FROM PUBLIC;
   GRANT EXECUTE ON FUNCTION public.poc_actor(),public.poc_trip_visible(TEXT),public.poc_photo_visible(TEXT,TEXT) TO anon,authenticated;
  `);
  for(const [actor,x] of Object.entries(identities))await db.query('INSERT INTO poc_private.identity_link VALUES($1,$2) ON CONFLICT(actor) DO UPDATE SET auth_id=excluded.auth_id',[actor,x.id]);
  for(const table of ['users','sessions','projects','trips','places','visits','photos','pm','tm','account','upload','asset','invite','rollback_probe','poc_photo_media'])await db.query(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
  const policies={photos:"public.poc_photo_visible(id,'display')",visits:"state='active' AND public.poc_trip_visible(trip_id)",trips:"public.poc_trip_visible(id)",projects:"state='active' AND (owner_id=public.poc_actor() OR EXISTS(SELECT 1 FROM public.pm WHERE project_id=projects.id AND user_id=public.poc_actor() AND active=1))",poc_photo_media:'public.poc_photo_visible(photo_id,variant)'};
  // Project policy cannot directly read protected memberships as the caller; use a definer helper.
  await db.query(`CREATE OR REPLACE FUNCTION public.poc_project_visible(target TEXT) RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
   SELECT EXISTS(SELECT 1 FROM public.projects p WHERE p.id=target AND p.state='active' AND (p.owner_id=public.poc_actor() OR EXISTS(SELECT 1 FROM public.pm WHERE project_id=p.id AND user_id=public.poc_actor() AND active=1))) $$;
   REVOKE ALL ON FUNCTION public.poc_project_visible(TEXT) FROM PUBLIC;GRANT EXECUTE ON FUNCTION public.poc_project_visible(TEXT) TO anon,authenticated;`);
  policies.projects='public.poc_project_visible(id)';
  for(const [table,expression] of Object.entries(policies)){await db.query(`DROP POLICY IF EXISTS poc_read ON public.${table};CREATE POLICY poc_read ON public.${table} FOR SELECT TO anon,authenticated USING(${expression});`);}
  await db.query("NOTIFY pgrst,'reload schema'");await new Promise((r)=>setTimeout(r,700));
  const version=(await db.query('SELECT version() version')).rows[0].version;
  return {version,rlsTables:15,functions:'SECURITY DEFINER with empty search_path; explicit EXECUTE grants',scope:'Disposable RLS experiment, not approved production policies'};
 });
 await check('RLS anonymous and outsider cannot read main-project photos',async()=>{
  const guestAnon=await rest('photos?select=id');if(guestAnon.status!==200||guestAnon.data.length!==0)throw new Error('anonymous_data_leak');
  const outsider=await rest('photos?select=id&visit_id=eq.visit-rome',identities.outsider.access);if(outsider.status!==200||outsider.data.length!==0)throw new Error('outsider_data_leak');
  return {anonymousRows:0,outsiderRomeRows:0};
 });
 await check('RLS Italy guest scopes rows, counts, direct IDs and projects',async()=>{
  const token=identities.guest.access;
  const all=await rest('photos?select=id',token);if(all.status!==200||all.data.length!==2)throw new Error(`guest_row_count_${all.status}_${all.data?.length}`);
  const denied=await rest('photos?select=id&id=eq.photo-bogota-1',token);if(denied.status!==200||denied.data.length!==0||!denied.count?.endsWith('/0'))throw new Error('rls_direct_or_count_leak');
  const projects=await rest('projects?select=id',token);if(projects.status!==200||projects.data.length!==0)throw new Error('guest_project_overview_leak');
  return {guestRows:all.data.length,deniedCount:denied.count,projectRows:projects.data.length};
 });
 await check('RLS inherited membership sees five photos; originals remain author/admin only',async()=>{
  for(const actor of ['owner','admin','member']){const r=await rest('photos?select=id',identities[actor].access);if(r.status!==200||r.data.length!==5)throw new Error(`inherited_${actor}_${r.status}`);}
  const otherOriginal=await rest('poc_photo_media?select=photo_id&photo_id=eq.photo-rome-guest&variant=eq.original',identities.member.access);
  if(otherOriginal.status!==200||otherOriginal.data.length!==0)throw new Error('original_scope_leak');
  const admin=await rest('poc_photo_media?select=photo_id&photo_id=eq.photo-rome-guest&variant=eq.original',identities.admin.access);
  if(admin.status!==200||admin.data.length!==1)throw new Error('admin_original_missing');
 });
 await check('RLS blocks client writes, spoofed roles and protected membership enumeration',async()=>{
  const token=identities.guest.access;
  const write=await rest('pm',token,'POST',{project_id:'project-main',user_id:'guest',role:'admin',active:1});if(write.status<400)throw new Error('role_escalation');
  const read=await rest('pm?select=*',token);if(read.status<400)throw new Error('protected_memberships_readable');
  const photo=await rest('photos?id=eq.photo-bogota-1',token,'PATCH',{author_id:'guest'});if(photo.status<400)throw new Error('unauthorized_mutation');
  return {membershipWrite:write.status,membershipRead:read.status,foreignPhotoMutation:photo.status};
 });
 await check('RLS membership revocation affects the next request with still-valid JWT',async()=>{
  await db.query("UPDATE tm SET active=0 WHERE user_id='guest' AND trip_id='trip-italy'");
  try{const r=await rest('photos?select=id',identities.guest.access);if(r.status!==200||r.data.length!==0)throw new Error('revoked_member_still_sees_rows');}
  finally{await db.query("UPDATE tm SET active=1 WHERE user_id='guest' AND trip_id='trip-italy'");}
  return {jwtNotChanged:true,newVisibleRows:0};
 });
 await check('RLS service-role bypass observed and explicitly separated',async()=>{
  const response=await fetch(api+'/rest/v1/photos?select=id',{headers:{apikey:service,Authorization:`Bearer ${service}`}});
  const data=await response.json();if(response.status!==200||data.length!==6)throw new Error('service_role_control_unexpected');
  return {serviceRoleRows:data.length,securityConsequence:'Privileged Worker must still enforce domain authorization; never expose this credential'};
 });
 await check('AUTH logout invalidates refresh; access-token behavior measured',async()=>{
  const user=identities.outsider;
  const logout=await auth('/logout?scope=global',{},user.access);if(!logout.ok)throw new Error(`logout_${logout.status}`);
  const refresh=await auth('/token?grant_type=refresh_token',{refresh_token:user.refresh},anon);
  if(refresh.status<400)throw new Error('refresh_survives_logout');
  const access=await auth('/user',undefined,user.access,'GET');
  return {logoutStatus:logout.status,refreshDeniedStatus:refresh.status,previousAccessTokenUserStatus:access.status,note:'Do not infer immediate JWT invalidation; membership policies remain necessary'};
 });
}
await db.end();
report.passed=report.tests.filter((t)=>t.status==='PASS').length;report.failed=report.tests.filter((t)=>t.status==='FAIL').length;
writeFileSync(new URL('evidence/native/supabase-results.json',root),JSON.stringify(report,null,2)+'\n');
mkdirSync(new URL('runs/private/',root),{recursive:true,mode:0o700});
writeFileSync(new URL('runs/private/supabase-test-identities.json',root),JSON.stringify(identities),{mode:0o600});
console.log(JSON.stringify({passed:report.passed,failed:report.failed}));if(report.failed)process.exitCode=1;
