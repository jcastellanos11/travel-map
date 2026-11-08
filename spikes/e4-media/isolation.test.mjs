import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile,readdir} from 'node:fs/promises';
const root=new URL('../../',import.meta.url);
async function texts(dir){const out=[];for(const name of await readdir(dir,{recursive:true}))if(/\.(js|mjs|ts|tsx|html|jsonc)$/.test(name))out.push(await readFile(new URL(name,dir),'utf8'));return out.join('\n');}
test('application sources/configuration import no E4 experiments or media bindings',async()=>{
  for(const dir of ['frontend/src/','backend/src/'])assert.doesNotMatch(await texts(new URL(dir,root)),/spikes\/e4-media|E40_SYNTHETIC_PRIVATE_METADATA|travel-map-e40-disposable-probe/);
  const config=JSON.parse(await readFile(new URL('backend/wrangler.jsonc',root),'utf8'));assert.ok(!config.r2_buckets&&!config.images);
});
test('current production artifacts contain no experimental codec/storage/probe code',async()=>{
  for(const dir of ['frontend/dist/','backend/dist/'])assert.doesNotMatch(await texts(new URL(dir,root)),/E40_SYNTHETIC_PRIVATE_METADATA|travel-map-e40-disposable-probe|INJECTED_CRASH|spikes\/e4-media/);
});
