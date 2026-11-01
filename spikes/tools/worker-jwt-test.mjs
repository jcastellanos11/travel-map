import {Client} from 'pg';
import {readFileSync,writeFileSync} from 'node:fs';
let stack;for(const line of readFileSync(new URL('../runs/supabase-native-start.log',import.meta.url),'utf8').split('\n')){try{const x=JSON.parse(line);if(x.env)stack=x;}catch{}}
const root=new URL('../',import.meta.url);
const identities=JSON.parse(readFileSync(new URL('runs/private/supabase-test-identities.json',root),'utf8'));
const appVarsPath=new URL('cloudflare-supabase/.dev.vars',root);
let vars=readFileSync(appVarsPath,'utf8').split('\n').filter((line)=>line&&!line.startsWith('POC_AUTH_URL=')).join('\n');
writeFileSync(appVarsPath,vars+`\nPOC_AUTH_URL="${stack.env.API_URL.replace(/\/$/,'')}"\n`,{mode:0o600});
const adminURL=new URL(stack.env.DB_URL);adminURL.pathname='/poc_candidate_b';
const client=new Client({connectionString:adminURL.toString()});await client.connect();
await client.query('CREATE TABLE IF NOT EXISTS poc_identity_link(actor TEXT PRIMARY KEY REFERENCES users(id),auth_id TEXT UNIQUE NOT NULL);GRANT SELECT ON poc_identity_link TO poc_app');
for(const [actor,id] of Object.entries(identities))await client.query('INSERT INTO poc_identity_link VALUES($1,$2) ON CONFLICT(actor) DO UPDATE SET auth_id=excluded.auth_id',[actor,id.id]);
await client.end();await new Promise((r)=>setTimeout(r,1500));
const cases=[];
for(const actor of ['guest','member']){
 const r=await fetch('http://127.0.0.1:8788/photos',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${identities[actor].access}`},body:'{}'});
 const data=await r.json();const expected=actor==='guest'?2:5;
 cases.push({actor,status:r.status,count:data.count,pass:r.status===200&&data.count===expected});
}
const token=identities.guest.access.split('.');const at=Math.floor(token[2].length/2);token[2]=token[2].slice(0,at)+(token[2][at]==='A'?'B':'A')+token[2].slice(at+1);
const bad=await fetch('http://127.0.0.1:8788/photos',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token.join('.')}`,'x-poc-session':'test-session:owner'},body:'{}'});
cases.push({actor:'tampered JWT with forged mock fallback',status:bad.status,pass:bad.status===404});
const report={scope:'Actual Worker B verifies LOCAL Supabase JWT and maps to fixture identity; NOT Google/cloud',cases,passed:cases.filter((x)=>x.pass).length,failed:cases.filter((x)=>!x.pass).length};
writeFileSync(new URL('evidence/native/worker-jwt-results.json',root),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));if(report.failed)process.exitCode=1;
