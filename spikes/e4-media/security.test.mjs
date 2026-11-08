import assert from 'node:assert/strict';
import { test } from 'node:test';
import { writeFile, stat, symlink, readdir, realpath } from 'node:fs/promises';
import { LocalStore, objectKey } from './storage.mjs';
import { QuotaModel, allowed, batchPolicy } from './reference-model.mjs';
import { spawnSync } from 'node:child_process';
const root=new URL(`./runs/store-${objectKey()}/`,import.meta.url).pathname;
const input=async function*(value){for(let at=0;at<value.length;at+=8192)yield value.subarray(at,at+8192);};
test('storage isolation rejects an unapproved root before creating it',async()=>{
  const rejected=new URL('./must-not-create/',import.meta.url).pathname;
  await assert.rejects(LocalStore.create(rejected),/ISOLATION/);await assert.rejects(stat(rejected),{code:'ENOENT'});
});
test('private filesystem store uses0700 root/0600 objects outside public assets',async()=>{
  const store=await LocalStore.create(root),key=objectKey();await store.put(key,input(Buffer.from('synthetic')),{maxBytes:20});
  assert.equal((await stat(root)).mode&0o777,0o700);assert.equal((await stat(store.path(key))).mode&0o777,0o600);
  assert.ok(!(await realpath(root)).includes('/public/'));assert.equal((await store.head(key)).bytes,9);
});
test('opaque keys, traversal and symlink objects fail closed',async()=>{
  const store=await LocalStore.create(root);for(const key of ['../../x','%2e%2e','/tmp/x','a'.repeat(63),'a/b'])await assert.rejects(store.head(key));
  const owned=new URL('./runs/owned-symlink-target.txt',import.meta.url);await writeFile(owned,'synthetic marker',{mode:0o600});const key=objectKey();await symlink(owned.pathname,store.path(key));
  await assert.rejects(store.get(key));await assert.rejects(store.delete(key));assert.equal((await stat(owned)).size,16);
});
test('streamed object write is bounded, verified and immutable/idempotent',async()=>{
  const store=await LocalStore.create(root),key=objectKey(),bytes=Buffer.alloc(2_000_000,42);const result=await store.put(key,input(bytes),{maxBytes:bytes.length});
  assert.deepEqual(await store.digest(key),result);assert.deepEqual(await store.put(key,input(bytes),{maxBytes:bytes.length}),result);
  await assert.rejects(store.put(key,input(Buffer.from('replacement')),{maxBytes:100}),/IMMUTABLE_CONFLICT/);
  await assert.rejects(store.put(objectKey(),input(bytes),{maxBytes:bytes.length-1}),/OBJECT_SIZE/);
  await assert.rejects(store.put(objectKey(),input(bytes),{maxBytes:bytes.length,expectedSha256:'bad'}),/CHECKSUM/);
});
test('failed promotion is invisible; orphan temp recovery is scoped and deletion idempotent',async()=>{
  const store=await LocalStore.create(root),key=objectKey();await assert.rejects(store.put(key,input(Buffer.from('synthetic')),{maxBytes:20,failAfterSync:true}),/INJECTED_CRASH/);
  assert.equal(await store.exists(key),false);assert.ok((await readdir(root)).some(p=>p.startsWith('.tmp-')));
  assert.equal(await store.sweepTemps(Date.now()+1000),1);await store.delete(key);await store.delete(key);
});
test('objects persist across fresh adapter instances; authorization precedes object access',async()=>{
  const a=await LocalStore.create(root),key=objectKey();await a.put(key,input(Buffer.from('synthetic')),{maxBytes:20});const b=await LocalStore.create(root);
  assert.equal(await new Response(await b.get(key)).text(),'synthetic');let reads=0;
  async function delivery(actor){if(!allowed(actor,'display'))throw Error('DENIED');reads++;return b.get(key);}
  await assert.rejects(delivery({role:'outsider'}));await assert.rejects(delivery({role:'guest',active:false}));await assert.rejects(delivery({role:'owner',session:false}));assert.equal(reads,0);
  await delivery({role:'guest'}).then(s=>s.cancel());assert.equal(reads,1);
});
test('objects survive an actual fresh Node process, without claiming power-loss durability',async()=>{
  const store=await LocalStore.create(root),key=objectKey();await store.put(key,input(Buffer.from('synthetic')),{maxBytes:20});
  const script=`import{LocalStore}from ${JSON.stringify(new URL('./storage.mjs',import.meta.url).href)};const s=await LocalStore.create(process.argv[1]);console.log(JSON.stringify(await s.head(process.argv[2])));`;
  const run=spawnSync(process.execPath,['--input-type=module','-e',script,root,key],{encoding:'utf8'});assert.equal(run.status,0);assert.equal(JSON.parse(run.stdout).bytes,9);
});
test('reference batch bound and per-file validation preserve independent outcomes',()=>{
  assert.throws(()=>batchPolicy([]),/BATCH_SIZE/);assert.throws(()=>batchPolicy(Array(11).fill({})),/BATCH_SIZE/);
  const results=batchPolicy([{clientFileId:'ok',declaredBytes:20_000_000},{clientFileId:'too-large',declaredBytes:20_000_001}]);
  assert.deepEqual(results.map(r=>r.status),['eligible','rejected']);assert.throws(()=>batchPolicy([{clientFileId:'same',declaredBytes:1},{clientFileId:'same',declaredBytes:1}]),/SLOT_ID/);
});
for(const role of ['owner','admin','member','guest','outsider']) test(`reference authorization ${role} with creator/current access rules`,()=>{
  assert.equal(allowed({role},'display'),role!=='outsider');assert.equal(allowed({role},'archival'),['owner','admin'].includes(role));
  assert.equal(allowed({role,creator:true},'archival'),role!=='outsider');assert.equal(allowed({role,creator:true,active:false},'archival'),false);
  assert.equal(allowed({role,photoState:'trashed'},'display'),false);assert.equal(allowed({role,creator:true,photoState:'trashed'},'restore'),role!=='outsider');assert.equal(allowed({role},'purge'),false);
});
test('reference quota: independent concurrent reservations never exceed500MB',async()=>{
  const q=new QuotaModel();const results=await Promise.allSettled(Array.from({length:10},(_,i)=>q.reserve(`slot-${i}`,'same',68_500_000)));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,7);assert.equal(q.reserved,479_500_000);assert.ok(q.used+q.reserved<=q.limit);
});
test('reference quota: replay is one reservation/finalization; changed intent conflicts',async()=>{
  const q=new QuotaModel();await Promise.all([q.reserve('slot','same',100),q.reserve('slot','same',100)]);assert.equal(q.reserved,100);
  await assert.rejects(q.reserve('slot','changed',100),/IDEMPOTENCY_CONFLICT/);await Promise.all([q.finalize('slot',80),q.finalize('slot',80)]);
  assert.equal(q.used,80);assert.equal(q.reserved,0);await assert.rejects(q.finalize('slot',81),/IDEMPOTENCY_CONFLICT/);
});
test('reference quota: partial files independent, failures retain reservations until writes/deletion confirmed',async()=>{
  const q=new QuotaModel();await q.reserve('ok','a',100);await q.reserve('failed','b',100);await q.finalize('ok',70);
  await assert.rejects(q.releaseFailed('failed',{writesSettled:false,objectsDeleted:true}),/CLEANUP_UNCONFIRMED/);
  await assert.rejects(q.releaseFailed('failed',{writesSettled:true,objectsDeleted:false}),/CLEANUP_UNCONFIRMED/);
  await q.releaseFailed('failed',{writesSettled:true,objectsDeleted:true});await q.releaseFailed('failed',{writesSettled:true,objectsDeleted:true});assert.equal(q.used,70);assert.equal(q.reserved,0);
});
test('reference quota: unexpected output expansion never overcommits the reservation',async()=>{
  const q=new QuotaModel();await q.reserve('slot','same',100);await assert.rejects(q.finalize('slot',101),/FINALIZATION/);assert.equal(q.reserved,100);assert.equal(q.used,0);
});
test('controlled30-day clock: trash retains quota, restore preserves charge, purge releases only after confirmed deletion',async()=>{
  const q=new QuotaModel();await q.reserve('slot','same',100);await q.finalize('slot',80);await q.trash('slot',0);assert.equal(q.used,80);
  await q.restore('slot',30*86400000-1);assert.equal(q.used,80);await q.trash('slot',0);await assert.rejects(q.restore('slot',30*86400000),/STATE/);
  await q.claimPurge('slot',30*86400000);await assert.rejects(q.finishPurge('slot',false),/DELETE_UNCONFIRMED/);assert.equal(q.used,80);
  await q.finishPurge('slot',true);await q.finishPurge('slot',true);assert.equal(q.used,0);
});
