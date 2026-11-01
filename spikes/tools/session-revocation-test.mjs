import {readFileSync,writeFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {Client} from 'pg';
let stack;for(const line of readFileSync(new URL('../runs/supabase-native-start.log',import.meta.url),'utf8').split('\n')){try{const x=JSON.parse(line);if(x.env)stack=x;}catch{}}
const phase=process.argv[2]??'jwt-only';
const varsPath=new URL('../cloudflare-supabase/.dev.vars',import.meta.url);
let vars=readFileSync(varsPath,'utf8').split('\n').filter((s)=>s&&!/^POC_(SESSION_CHECK|ANON_KEY)=/.test(s)).join('\n');
vars+=`\nPOC_SESSION_CHECK="${phase==='live-check'}"\nPOC_ANON_KEY="${stack.env.ANON_KEY}"\n`;
writeFileSync(varsPath,vars,{mode:0o600});
const configPath=new URL('../cloudflare-supabase/wrangler.jsonc',import.meta.url);writeFileSync(configPath,readFileSync(configPath));
const expected=phase==='live-check';let ready=false;
for(let i=0;i<30;i++){try{const r=await fetch('http://127.0.0.1:8788/health',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});if((await r.json()).sessionCheck===expected){ready=true;break;}}catch{}await new Promise((r)=>setTimeout(r,500));}
if(!ready)throw new Error('restart_worker_to_load_session_check_setting');
const email=`poc-session-${Date.now()}@example.invalid`;const password=randomBytes(24).toString('hex');
const auth=async(path,body,token=stack.env.SERVICE_ROLE_KEY)=>fetch(stack.env.API_URL+'/auth/v1'+path,{method:'POST',headers:{apikey:stack.env.ANON_KEY,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
const created=await auth('/admin/users',{email,password,email_confirm:true});if(!created.ok)throw new Error('create_local_user_failed');const user=await created.json();
const signed=await auth('/token?grant_type=password',{email,password},stack.env.ANON_KEY);if(!signed.ok)throw new Error('local_signin_failed');const tokens=await signed.json();
const url=new URL(stack.env.DB_URL);url.pathname='/poc_candidate_b';const db=new Client({connectionString:url.toString()});await db.connect();
await db.query("INSERT INTO users VALUES('session-user',1) ON CONFLICT DO NOTHING;INSERT INTO pm VALUES('project-main','session-user','member',1) ON CONFLICT DO NOTHING");
await db.query("INSERT INTO poc_identity_link VALUES('session-user',$1) ON CONFLICT(actor) DO UPDATE SET auth_id=excluded.auth_id",[user.id]);await db.end();
const fetchPrivate=()=>fetch('http://127.0.0.1:8788/photos',{method:'POST',headers:{Authorization:`Bearer ${tokens.access_token}`,'Content-Type':'application/json'},body:'{}'});
const before=await fetchPrivate();
const logout=await auth('/logout?scope=global',{},tokens.access_token);
const after=await fetchPrivate();
const report={phase,beforeStatus:before.status,logoutStatus:logout.status,afterStatus:after.status,
 expectedAfterStatus:expected?404:200,pass:before.status===200&&logout.ok&&after.status===(expected?404:200),
 interpretation:expected?'Local live Auth check denies logged-out session; extra service round trip, not production strategy selected':'NEGATIVE CONTROL: valid signed JWT alone still grants private reads after logout. Signature validation is not session revocation.'};
writeFileSync(new URL(`../evidence/native/session-${phase}.json`,import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));if(!report.pass)process.exitCode=1;
