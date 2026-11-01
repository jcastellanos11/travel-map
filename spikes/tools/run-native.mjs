import {spawnSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const commands=[['spikes/shared/native-tests.mjs','d1'],['spikes/shared/native-tests.mjs','postgres'],['spikes/tools/worker-jwt-test.mjs'],['spikes/tools/expiry-check.mjs']];
const results=[];
for(const args of commands){
 const result=spawnSync(process.execPath,args,{cwd:root,encoding:'utf8',timeout:120000});
 // These runners deliberately output only synthetic IDs/counts/statuses, never bearer values.
 writeFileSync(root+`spikes/evidence/native/final-${results.length}.log`,result.stdout+result.stderr);
 results.push({command:['node',...args].join(' '),exit:result.status,error:result.error?.message});
 console.log(JSON.stringify(results.at(-1)));
}
writeFileSync(root+'spikes/evidence/native/final-regression.json',JSON.stringify(results,null,2)+'\n');if(results.some((r)=>r.exit!==0))process.exitCode=1;
