import assert from 'node:assert/strict';
import { readFile,writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { sharp } from './deps.mjs';
import { safeWebp } from './containers.mjs';
const require=createRequire(new URL('../tools/package.json',import.meta.url)),{createTestHarness}=require('wrangler');
const root=new URL('./runs/current/',import.meta.url),vectors=[];
for(const format of ['jpeg','png','webp','heic','heif']){
  try{vectors.push({format,base64:(await readFile(new URL(`synthetic.${format}`,root))).toString('base64')});}catch(error){if(error.code!=='ENOENT')throw error;}
}
await writeFile(new URL('probe-vectors.json',root),JSON.stringify(vectors),{mode:0o600});
const marker=new URL('host-marker.txt',root);await writeFile(marker,'synthetic-host-marker',{mode:0o600});
// Wrangler cache/state belongs to this ignored experiment, never the repository root.
process.chdir(root.pathname);
const runtime=createTestHarness({workers:[{config:{name:'travel-map-e40-disposable-probe',main:new URL('./probe-worker.mjs',import.meta.url).pathname,compatibility_date:'2026-10-30',compatibility_flags:['nodejs_compat'],workers_dev:false,send_metrics:false,dev:{ip:'127.0.0.1'},vars:{HOST_MARKER:marker.pathname},images:{binding:'IMAGES',remote:false},r2_buckets:[{binding:'MEDIA',bucket_name:'e40-local-synthetic-only',remote:false}]}}]});
const report={scope:'Actual LOCAL workerd; R2/Images are LOCAL EMULATORS, not cloud verification',assertions:[],images:[]};
async function check(id,fn){try{await fn();report.assertions.push({id,status:'PASS'});}catch(e){report.assertions.push({id,status:'FAIL',error:e.message.slice(0,400)});}}
try{
  await runtime.listen();
  report.capabilities=await(await runtime.fetch('/capabilities')).json();
  await check('workerd cannot read the host filesystem marker',()=>assert.equal(report.capabilities.hostVisible,false));
  await check('no native browser image decoder APIs in workerd',()=>{assert.equal(report.capabilities.imageDecoder,'undefined');assert.equal(report.capabilities.createImageBitmap,'undefined');});
  await check('native addon loading unavailable for the installed Sharp build',()=>assert.match(report.capabilities.nativeAddon,/not.*(implement|support)|not available|unsupported/i));
  report.vfs=[await(await runtime.fetch('/vfs')).json(),await(await runtime.fetch('/vfs')).json()];
  await check('Worker tmp is writable but request-ephemeral, not durable media storage',()=>{assert.ok(report.vfs.every(v=>v.writeRead));assert.equal(report.vfs[1].existed,false);});
  report.objects=await(await runtime.fetch('/objects')).json();
  await check('local R2 contract: put/get/head/conditional immutable write/delete',()=>{assert.equal(report.objects.size,4);assert.deepEqual(report.objects.read,[1,2,3,4]);assert.equal(report.objects.conditionalRejected,true);assert.deepEqual(report.objects.unchanged,[1,2,3,4]);assert.equal(report.objects.deleted,true);});
  const images=await(await runtime.fetch('/images')).json();
  for(const {bytes,...entry} of images){
    if(typeof entry.status==='number'&&entry.status===200&&bytes){const b=Buffer.from(bytes);try{entry.chunks=safeWebp(b);const meta=await sharp(b).metadata();entry.output={bytes:b.length,width:meta.width,height:meta.height};entry.privacy='Verified output chunk allowlist';}catch(error){entry.privacy='FAILED';entry.error=error.message;}}
    report.images.push(entry);
  }
  await check('local Images JPEG/PNG/WebP conversion and output metadata stripping',()=>{
    for(const format of ['jpeg','png','webp']){const image=report.images.find(i=>i.format===format);assert.equal(image.status,200);assert.ok(image.privacy.startsWith('Verified'));}
  });
}catch(error){report.blocker={code:error.code,message:error.message.slice(0,600)};process.exitCode=1;}
finally{await runtime.close();}
report.summary={passed:report.assertions.filter(t=>t.status==='PASS').length,failed:report.assertions.filter(t=>t.status==='FAIL').length,skipped:0};
await writeFile(new URL('./workerd-results.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));if(report.summary.failed)process.exitCode=1;
