import {totalmem,platform,arch} from 'node:os';
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {Client} from 'pg';
const root=new URL('../',import.meta.url);
let stack;for(const line of readFileSync(new URL('runs/supabase-native-start.log',root),'utf8').split('\n')){try{const x=JSON.parse(line);if(x.env)stack=x;}catch{}}
const db=new Client({connectionString:stack.env.DB_URL});await db.connect();
const sizes=(await db.query("SELECT datname,pg_database_size(datname) bytes FROM pg_database WHERE datname IN ('poc_candidate_b','poc_candidate_b_restore')")).rows;await db.end();
const processes=spawnSync('ps',['-axo','pid=,rss=,comm='],{encoding:'utf8'}).stdout.split('\n').map((line)=>line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/)).filter(Boolean).filter((m)=>/(?:^|\/)(?:workerd|supabase|\.postgres|postgres|\.auth[^/]*|postgrest|mailpit)$/.test(m[3])).map((m)=>({pid:+m[1],rssKiB:+m[2],executable:m[3].split('/').pop()}));
const size=(path)=>spawnSync('du',['-sk',path],{encoding:'utf8'}).stdout.trim().split(/\s+/)[0];
const report={platform:platform(),arch:arch(),totalRAMBytes:totalmem(),databaseSizes:sizes,nodeDependenciesKiB:+size(new URL('tools/node_modules/',root).pathname),nativeServiceCacheKiB:+size(process.env.HOME+'/.supabase/cache/stack'),d1StateKiB:+size(new URL('cloudflare-only/.state/',root).pathname),processSnapshot:processes,note:'RSS is a point-in-time per-process estimate and double-counts shared mappings; not peak or unique RAM. No cloud CPU/cost measurement.'};
writeFileSync(new URL('evidence/native/resources.json',root),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
