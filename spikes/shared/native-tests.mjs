import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const candidate=process.argv[2]??'d1';
const base=candidate==='d1'?'http://127.0.0.1:8787':'http://127.0.0.1:8788';
const run=`${Date.now()}`;
const tests=[];
async function check(id,work) {
  const start=performance.now();
  try {const evidence=await work();tests.push({id,status:'PASS',elapsedMs:+(performance.now()-start).toFixed(3),evidence});console.log(`PASS ${id}`);}
  catch(error){tests.push({id,status:'FAIL',elapsedMs:+(performance.now()-start).toFixed(3),error:error.message});console.log(`FAIL ${id}: ${error.message}`);}
}
async function request(path,body={},actor='member',headers={}) {
  const response=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...(actor?{'x-poc-session':`test-session:${actor}`} : {}),...headers},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
  const contentType=response.headers.get('content-type')??'';
  return {status:response.status,body:contentType.includes('json')?await response.json():Buffer.from(await response.arrayBuffer()),cache:response.headers.get('cache-control')};
}
async function account(name,used=0,actor='member') {
  const namespace=`${run}-${name}`;
  assert.equal((await request('/harness/account',{id:`${actor}:${namespace}`,used})).status,200);
  return {namespace,op:'op',file:'f1',visit:'visit-bogota-1',fingerprint:'synthetic-digest',estimate:1_200_000};
}
async function state(r,actor='member') {
  const response=await request('/harness/snapshot',{id:`${actor}:${r.namespace}`});
  assert.equal(response.status,200);
  const s=response.body;
  for(const row of s.account) for(const field of ['used','reserved','quota']) row[field]=Number(row[field]);
  return s;
}
async function race(path,inputs,actors=inputs.map(()=> 'member')) {
  const children=inputs.map((input,i)=> {
    const child=fork(fileURLToPath(new URL('./native-request-child.mjs',import.meta.url)),[base,path,JSON.stringify(input),actors[i]],{execArgv:[],stdio:['ignore','ignore','pipe','ipc']});
    let result;
    const ready=new Promise((resolve,reject)=>{child.on('message',(msg)=>{if(msg.phase==='ready')resolve();else result=msg;});child.once('error',reject);child.once('exit',()=>reject(new Error('child exited before ready')));});
    const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code)=>code===0&&result?resolve(result):reject(new Error(`child failed ${code}`)));});
    done.catch(()=>{});
    return {child,ready,done};
  });
  const timer=setTimeout(()=>children.forEach((c)=>c.child.kill()),20000);
  try{await Promise.all(children.map((c)=>c.ready));children.forEach((c)=>c.child.send('go'));return await Promise.all(children.map((c)=>c.done));}
  finally{clearTimeout(timer);children.forEach((c)=>{if(c.child.exitCode===null)c.child.kill();});}
}

await check('RUNTIME actual Worker and database version',async()=>{
  const r=await request('/health');assert.equal(r.status,200);assert.equal(r.body.engine,candidate==='d1'?'D1':'PostgreSQL');return r.body;
});
await check('AUTH-01 missing, forged and inactive sessions deny',async()=>{
  for(const actor of [null,'invented','inactive'])assert.equal((await request('/photos',{},actor)).status,404);
  return {denials:3};
});
await check('AUTH-02 direct-ID and aggregate isolation',async()=>{
  for(const path of ['/photo','/media'])for(const variant of ['original','display']) {
    const r=await request(path,{id:'photo-bogota-1',variant},'guest');assert.equal(r.status,404);assert.deepEqual(r.body,{error:'unavailable'});
  }
  const geographic=await request('/photos',{country:'COL'},'guest');assert.deepEqual(geographic.body,{photos:[],count:0});
  assert.equal((await request('/capability',{id:'project-main',action:'project.counts'},'guest')).status,404);
  return geographic.body;
});
await check('AUTH-03 project inheritance, overlapping grants and Place identity',async()=>{
  for(const actor of ['owner','admin','member'])assert.equal((await request('/photos',{},actor)).body.count,5);
  const r=await request('/photos',{country:'COL'},'overlap');assert.equal(r.body.count,3);assert.equal(new Set(r.body.photos).size,3);return r.body;
});
await check('AUTH-04 owner-only management',async()=>{
  for(const action of ['project.archive','project.manageAdmins','project.transfer']) {
    assert.equal((await request('/capability',{id:'project-main',action},'owner')).status,200);
    assert.equal((await request('/capability',{id:'project-main',action},'admin')).status,404);
  }
});
await check('AUTH-05 creator and original-download rights',async()=>{
  assert.equal((await request('/capability',{id:'visit-rome',action:'visit.edit'},'guest')).status,200);
  assert.equal((await request('/capability',{id:'visit-rome',action:'visit.edit'},'member')).status,404);
  assert.equal((await request('/photo',{id:'photo-rome-guest',variant:'original'},'member')).status,404);
  assert.equal((await request('/photo',{id:'photo-rome-guest',variant:'original'},'admin')).status,200);
});
await check('AUTH-06 caller user/role spoofing and injection do not grant access',async()=>{
  assert.equal((await request('/photo',{id:"' OR 1=1 --",variant:'display',role:'owner'},'guest')).status,404);
  assert.equal((await request('/photo',{id:'photo-bogota-1',user:'owner',role:'owner'},'guest')).status,404);
  assert.equal((await request('/photos',{},'member',{Origin:'https://untrusted.invalid'})).status,404);
});
await check('AUTH-07 ancestor states suppress private reads',async()=>{
  for(const [table,id] of [['photos','photo-rome-guest'],['visits','visit-rome'],['trips','trip-italy'],['projects','project-main']]){
    await request('/harness/state',{table,id,state:'archived'});
    try{assert.equal((await request('/photo',{id:'photo-rome-guest'},'owner')).status,404);}
    finally{await request('/harness/state',{table,id,state:table==='photos'?'ready':'active'});}
  }
});
await check('QUOTA-01 hundred native concurrent reservation races',async()=>{
  const rounds=[];
  for(let i=0;i<100;i++){
    const r=await account(`race-${i}`,480_000_000);r.estimate=17_000_000;
    // Independent HTTP requests to the runtime. First/last rounds also use independent OS clients.
    const inputs=[{...r,file:'a'},{...r,file:'b'}];
    const started=performance.now();
    const responses=i===0||i===99?await race('/upload/reserve',inputs):await Promise.all(inputs.map((x)=>request('/upload/reserve',x)));
    assert.deepEqual(responses.map((x)=>x.status).sort(),[200,409]);
    const s=await state(r);assert.equal(s.account[0].used+s.account[0].reserved,497_000_000);assert.equal(s.uploads.length,1);
    rounds.push({round:i,total:497_000_000,statuses:responses.map((x)=>x.status),pids:responses.map((x)=>x.pid).filter(Boolean),elapsedMs:+(performance.now()-started).toFixed(3)});
  }
  return {rounds};
});
await check('QUOTA-02 fail/cancel releases once and charges actual variants',async()=>{
  const r=await account('release',480_000_000);r.estimate=17_000_000;
  assert.equal((await request('/upload/reserve',r)).body.outcome,'reserved');
  assert.equal((await request('/upload/fail',r)).body.outcome,'released');
  assert.equal((await request('/upload/fail',r)).body.outcome,'noop');
  assert.equal((await state(r)).account[0].reserved,0);
  await request('/upload/reserve',r);
  const completed={...r,original:15_000_000,display:1_000_000};
  assert.equal((await request('/upload/complete',completed)).body.outcome,'ready');
  assert.equal((await request('/upload/complete',completed)).body.outcome,'replay');
  const s=await state(r);assert.equal(s.account[0].used,496_000_000);assert.equal(s.account[0].reserved,0);assert.equal(s.assets.length,2);return s;
});
await check('QUOTA-03 actual overflow rolls back then compensates',async()=>{
  const r=await account('overflow',480_000_000);r.estimate=17_000_000;await request('/upload/reserve',r);
  assert.equal((await request('/upload/complete',{...r,original:20_000_000,display:1})).status,409);
  const before=await state(r);assert.equal(before.assets.length,0);assert.equal(before.account[0].used,480_000_000);assert.equal(before.account[0].reserved,17_000_000);
  await request('/upload/fail',r);assert.equal((await state(r)).account[0].reserved,0);return before;
});
await check('TRANSACTION native batch/transaction rollback injection',async()=>{
  const r=await request('/harness/rollback',{id:`rollback-${run}`});assert.deepEqual(r.body,{rolledBack:true});return r.body;
});
await check('RECOVERY committed abandoned reservation expires once',async()=>{
  const r=await account('abandoned');r.expires=100;await request('/upload/reserve',r);
  assert.equal((await state(r)).account[0].reserved,r.estimate);
  for(let i=0;i<2;i++)assert.equal((await request('/harness/expire',{id:`member:${r.namespace}`,now:101})).status,200);
  const s=await state(r);assert.equal(s.account[0].reserved,0);assert.equal(s.uploads[0].state,'failed');return s;
});
await check('UPLOAD-01 partial 7/3 and retry only failures',async()=>{
  const r=await account('partial');
  const inputs=Array.from({length:10},(_,i)=>({...r,file:`file-${i}`}));
  for(let i=0;i<10;i++){await request('/upload/reserve',inputs[i]);await request(i<7?'/upload/complete':'/upload/fail',{...inputs[i],original:1_000_000,display:100_000});}
  const before=await state(r);assert.equal(before.uploads.filter((u)=>u.state==='ready').length,7);assert.equal(before.account[0].used,7_700_000);
  for(const input of inputs.slice(7)){await request('/upload/reserve',input);await request('/upload/complete',{...input,original:1_000_000,display:100_000});}
  for(const input of inputs)assert.equal((await request('/upload/reserve',input)).body.outcome,'replay');
  const after=await state(r);assert.equal(after.uploads.length,10);assert.equal(after.uploads.reduce((sum,u)=>sum+Number(u.attempts),0),13);assert.equal(after.account[0].used,11_000_000);assert.equal(after.assets.length,20);return {before,after};
});
await check('UPLOAD-02 eight process duplicate reserve/completion',async()=>{
  const r=await account('duplicate');
  const reservations=await race('/upload/reserve',Array(8).fill(r));
  assert.equal(reservations.filter((x)=>x.body.outcome==='reserved').length,1);assert(reservations.every((x)=>x.status===200));
  const completions=await race('/upload/complete',Array(8).fill({...r,original:1_000_000,display:100_000}));
  assert.equal(completions.filter((x)=>x.body.outcome==='ready').length,1);assert(completions.every((x)=>x.status===200));
  const s=await state(r);assert.equal(s.account[0].used,1_100_000);assert.equal(s.account[0].reserved,0);assert.equal(s.uploads.length,1);assert.equal(s.assets.length,2);return {reservations,completions,state:s};
});
await check('UPLOAD-03 intentional repeat and conflicting key reuse',async()=>{
  const r=await account('intent');
  for(const op of ['new-1','new-2']){await request('/upload/reserve',{...r,op});await request('/upload/complete',{...r,op,original:1_000_000,display:100_000});}
  const s=await state(r);assert.equal(s.account[0].used,2_200_000);assert.equal(s.uploads.length,2);
  assert.equal((await request('/upload/reserve',{...r,op:'new-1',fingerprint:'different'})).status,409);
  assert.equal((await request('/upload/complete',{...r,op:'new-1',original:1_000_001,display:100_000})).status,409);return s;
});
await check('UPLOAD-04 denied scope and forged actor cannot reserve',async()=>{
  const r=await account('forbidden',0,'guest');
  assert.equal((await request('/upload/reserve',{...r,user:'member',role:'owner'},'guest')).status,404);
  assert.equal((await state(r,'guest')).uploads.length,0);
});
await check('UPLOAD-05 actual R2 object existence and measured-byte finalization',async()=>{
  const r=await account('real-objects');await request('/upload/reserve',r);
  assert.equal((await request('/upload/complete-objects',r)).status,409);
  assert.equal((await state(r)).assets.length,0);
  const original=readFileSync(new URL('../fixtures/synthetic-gps.heic',import.meta.url));
  const display=readFileSync(new URL('../fixtures/synthetic-derived.webp',import.meta.url));
  const prefix=`upload/member:${r.namespace}/${r.op}/${r.file}`;
  await request('/harness/object',{key:`${prefix}/original`,base64:original.toString('base64')});
  assert.equal((await request('/upload/complete-objects',r)).status,409);
  await request('/harness/object',{key:`${prefix}/display`,base64:display.toString('base64')});
  assert.equal((await request('/upload/complete-objects',r)).body.outcome,'ready');
  assert.equal((await request('/upload/complete-objects',r)).body.outcome,'replay');
  const s=await state(r);assert.equal(s.account[0].used,original.length+display.length);assert.equal(s.account[0].reserved,0);return s;
});
await check('RETENTION trash retains bytes; restore within 30 days only',async()=>{
  const r=await account('trash');await request('/upload/reserve',r);await request('/upload/complete',{...r,original:1_000_000,display:100_000});
  await request('/upload/trash',{...r,now:100});assert.equal((await state(r)).account[0].used,1_100_000);
  assert.equal((await request('/upload/restore',{...r,now:101})).status,200);
  await request('/upload/trash',{...r,now:100});assert.equal((await request('/upload/restore',{...r,now:100+31*86400})).status,404);
});
await check('INVITATION hashed token single-use race; expiry and revocation',async()=>{
  const token=`synthetic-${run}`;const hash=createHash('sha256').update(token).digest('hex');
  await request('/harness/invite',{id:`invite-${run}`,hash,expires:700});
  const results=await race('/invite/redeem',[{token,now:100},{token,now:100}],['outsider','inactive']);
  // Inactive principal must not redeem; race two active principals in a second invitation.
  assert.equal(results.filter((x)=>x.status===200).length,1);
  const second=`${token}-second`;await request('/harness/invite',{id:`invite-${run}-second`,hash:createHash('sha256').update(second).digest('hex'),expires:700});
  const simultaneous=await race('/invite/redeem',[{token:second,now:100},{token:second,now:100}],['owner','admin']);
  assert.equal(simultaneous.filter((x)=>x.status===200).length,1);
  for(const [name,expires,revoked] of [['expired',99,false],['revoked',700,true]]){
    const t=`${token}-${name}`;await request('/harness/invite',{id:`invite-${run}-${name}`,hash:createHash('sha256').update(t).digest('hex'),expires,revoked});
    assert.equal((await request('/invite/redeem',{token:t,now:100},'member')).status,404);
  }
  // Restore the outsider control to its original scope after invitation test.
  await request('/harness/revoke',{user:'outsider',trip:'trip-italy',active:false});
  return {activeRace:simultaneous.map((r)=>({pid:r.pid,status:r.status})),invalidStatesDenied:2};
});
await check('MEDIA actual local R2 bytes, original permissions and next-GET revocation',async()=>{
  const bytes=readFileSync(new URL('../fixtures/synthetic-gps.heic',import.meta.url));
  const base64=bytes.toString('base64');
  await request('/harness/object',{key:'photo-rome-guest/original',base64});
  const display=readFileSync(new URL('../fixtures/synthetic-derived.webp',import.meta.url));
  await request('/harness/object',{key:'photo-rome-guest/display',base64:display.toString('base64')});
  const original=await request('/media',{id:'photo-rome-guest',variant:'original'},'guest');assert.equal(original.status,200);assert(original.body.equals(bytes));assert.equal(original.cache,'private, no-store');
  assert.equal((await request('/media',{id:'photo-rome-guest',variant:'original'},'member')).status,404);
  const shown=await request('/media',{id:'photo-rome-guest',variant:'display'},'member');assert.equal(shown.status,200);assert(shown.body.equals(display));
  await request('/harness/revoke',{user:'guest',trip:'trip-italy',active:false});
  try{assert.equal((await request('/media',{id:'photo-rome-guest',variant:'original'},'guest')).status,404);assert.equal((await request('/media',{id:'photo-rome-guest',variant:'display'},'guest')).status,404);}
  finally{await request('/harness/revoke',{user:'guest',trip:'trip-italy',active:true});}
  return {bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),displayBytes:display.length,derivativeProcessing:'Local TIFF-to-WebP only; NOT HEIC/Cloudflare Images'};
});

await check('PERFORMANCE authorized query for 100 synthetic visits',async()=>{
  const id=`bench-${run}`;assert.equal((await request('/harness/benchmark',{id})).status,200);
  const samples=[];let bytes=0;
  for(let i=0;i<20;i++){
    const start=performance.now();const r=await request('/photos',{project:id});samples.push(performance.now()-start);
    assert.equal(r.status,200);assert.equal(r.body.count,100);bytes=Buffer.byteLength(JSON.stringify(r.body));
  }
  samples.sort((a,b)=>a-b);return {visits:100,requests:20,p50Ms:samples[9],p95Ms:samples[18],jsonBytes:bytes,scope:'Local API only, NOT mobile map first-useful-view'};
});

const report={candidate,scope:'NATIVE LOCAL ONLY; mock identity; no cloud resources',run,base,passed:tests.filter((t)=>t.status==='PASS').length,failed:tests.filter((t)=>t.status==='FAIL').length,tests};
writeFileSync(new URL(`../evidence/native/${candidate}-results.json`,import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({candidate,passed:report.passed,failed:report.failed}));
if(report.failed)process.exitCode=1;
