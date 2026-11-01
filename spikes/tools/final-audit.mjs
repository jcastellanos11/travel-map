import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,existsSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const git=(args)=>spawnSync('git',args,{cwd:root,encoding:'utf8'});
const changed=git(['status','--porcelain']).stdout.trim().split('\n').filter(Boolean);
const protectedPaths=['frontend','backend','docs/PRD.md','docs/DATA_MODEL.md','docs/AUTHORIZATION_MATRIX.md','docs/ARCHITECTURE.md','docs/POC_PLAN.md'];
const scope=git(['diff','--exit-code','HEAD','--',...protectedPaths]).status===0;
let stack;
for(const line of readFileSync(root+'spikes/runs/supabase-native-start.log','utf8').split('\n')){try{const x=JSON.parse(line);if(x.env)stack=x;}catch{}}
const secretValues=Object.entries(stack.env).filter(([key,value])=>/KEY|TOKEN|SECRET|PASSWORD/.test(key)&&typeof value==='string'&&value.length>20).map(([key,value])=>({key,value}));
for(const name of ['postgres-native.json','postgres.json']){
 const p=root+'spikes/runs/private/'+name;if(existsSync(p)){const x=JSON.parse(readFileSync(p));if(x.password)secretValues.push({key:'generated-pg-password',value:x.password});}
}
const files=git(['ls-files','--cached','--others','--exclude-standard','--','spikes','docs/POC_RESULTS.md']).stdout.trim().split('\n').filter(Boolean);
const leaks=[];
for(const file of files){try{const contents=readFileSync(root+file);for(const secret of secretValues)if(contents.includes(Buffer.from(secret.value)))leaks.push({file,kind:secret.key});}catch{}}
const hashes=Object.fromEntries(protectedPaths.filter((p)=>p.endsWith('.md')).map((p)=>[p,createHash('sha256').update(readFileSync(root+p)).digest('hex')]));
const versions=Object.fromEntries(['wrangler','miniflare','pg','supabase','jose','sharp','exifr','@cloudflare/workerd-darwin-arm64'].map((name)=>[name,JSON.parse(readFileSync(root+`spikes/tools/node_modules/${name}/package.json`)).version]));
const report={baselineCommit:git(['rev-parse','HEAD']).stdout.trim(),node:process.version,versions,protectedPathsUnchanged:scope,approvedInputDocumentHashes:hashes,nonIgnoredCredentialMatches:leaks,filesChecked:files.length,changedPaths:changed,scope:'Local synthetic PoC only; installed-runtime caches outside repo require OS permission; no cloud resources'};
writeFileSync(root+'spikes/evidence/native/final-audit.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));if(!scope||leaks.length)process.exitCode=1;
