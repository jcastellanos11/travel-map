import {Client} from 'pg';
import {readFileSync,writeFileSync} from 'node:fs';
const root=new URL('../',import.meta.url);
let stack;for(const line of readFileSync(new URL('runs/supabase-native-start.log',root),'utf8').split('\n')){try{const x=JSON.parse(line);if(x.env)stack=x;}catch{}}
const identities=JSON.parse(readFileSync(new URL('runs/private/supabase-test-identities.json',root),'utf8'));
const token=identities.guest.access;
const auth=await fetch(stack.env.API_URL+'/auth/v1/user',{headers:{apikey:stack.env.ANON_KEY,Authorization:`Bearer ${token}`}});
const rest=await fetch(stack.env.API_URL+'/rest/v1/photos?select=id',{headers:{apikey:stack.env.ANON_KEY,Authorization:`Bearer ${token}`}});
const rows=await rest.json();
const url=new URL(stack.env.DB_URL);url.pathname='/poc_candidate_b';const db=new Client({connectionString:url.toString()});await db.connect();
const latest=JSON.parse(readFileSync(new URL('evidence/native/postgres-results.json',root),'utf8'));
const account=(await db.query('SELECT used,reserved FROM account WHERE user_id=$1',[`member:${latest.run}-partial`])).rows[0];await db.end();
const report={scope:'Restart of named LOCAL native Supabase stack, preserving state',authStatus:auth.status,rlsStatus:rest.status,guestPhotoCount:Array.isArray(rows)?rows.length:null,account,passed:auth.status===200&&rest.status===200&&rows.length===2&&+account.used===11_000_000&&+account.reserved===0};
writeFileSync(new URL('evidence/native/supabase-restart.json',root),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));if(!report.passed)process.exitCode=1;
