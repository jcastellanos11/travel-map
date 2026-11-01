// Exact local container only; generates credentials in ignored private storage.
import {spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {Client} from 'pg';
const docker='/Applications/Docker.app/Contents/Resources/bin/docker';
const name='travel-map-poc-pg';
const root=new URL('../',import.meta.url);
const privateDir=new URL('runs/private/',root);mkdirSync(privateDir,{recursive:true,mode:0o700});
const credential=new URL('postgres.json',privateDir);
const secret=existsSync(credential)?JSON.parse(readFileSync(credential)): {password:randomBytes(32).toString('hex')};
writeFileSync(credential,JSON.stringify(secret),{mode:0o600});
const run=(args,options={})=>{
 const r=spawnSync(docker,args,{encoding:'utf8',...options});
 if(r.status!==0)throw new Error(`docker ${args.slice(0,2).join(' ')} failed: ${r.stderr??r.error?.message}`);
 return r.stdout;
};
run(['version','--format','{{.Server.Version}}']);
run(['pull','--platform','linux/arm64','postgres:17.10-trixie']);
const digest=JSON.parse(run(['image','inspect','postgres:17.10-trixie']))[0].RepoDigests[0];
const existing=spawnSync(docker,['container','inspect',name],{encoding:'utf8'});
if(existing.status===0){
 const container=JSON.parse(existing.stdout)[0];
 if(container.Config.Labels['travel-map.poc']!=='native-local')throw new Error('name_collision_unowned_container');
 if(!container.State.Running)run(['start',name]);
}else{
 run(['volume','create','--label','travel-map.poc=native-local','travel-map-poc-pgdata']);
 run(['run','--detach','--name',name,'--label','travel-map.poc=native-local','--platform','linux/arm64',
  '--publish','127.0.0.1:55432:5432','--cpus','2','--memory','2g',
  '--env','POSTGRES_USER=poc_bootstrap','--env','POSTGRES_DB=travel_map_poc','--env','POSTGRES_PASSWORD',
  '--mount','source=travel-map-poc-pgdata,target=/var/lib/postgresql/data',digest],{env:{...process.env,POSTGRES_PASSWORD:secret.password}});
}
let ready=false;
for(let i=0;i<30;i++){
 if(spawnSync(docker,['exec',name,'pg_isready','-U','poc_bootstrap','-d','travel_map_poc'],{encoding:'utf8'}).status===0){ready=true;break;}
 await new Promise((r)=>setTimeout(r,1000));
}
if(!ready)throw new Error('container_not_ready');
const admin=new Client({host:'127.0.0.1',port:55432,user:'poc_bootstrap',password:secret.password,database:'travel_map_poc'});await admin.connect();
const version=(await admin.query('SELECT version() version')).rows[0].version;
await admin.query(`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='poc_app') THEN CREATE ROLE poc_app LOGIN NOSUPERUSER NOBYPASSRLS; END IF; END $$`);
// Password is random hex and never written into a report or command-line argument.
await admin.query(`ALTER ROLE poc_app PASSWORD '${secret.password}'`);
await admin.query(readFileSync(new URL('cloudflare-supabase/fixture.sql',root),'utf8'));
await admin.query('GRANT USAGE ON SCHEMA public TO poc_app; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO poc_app');
await admin.end();
writeFileSync(new URL('cloudflare-supabase/.dev.vars',root),`POC_DATABASE_URL="postgresql://poc_app:${secret.password}@127.0.0.1:55432/travel_map_poc"\n`,{mode:0o600});
const container=JSON.parse(run(['container','inspect',name]))[0];
const image=JSON.parse(run(['image','inspect',digest]))[0];
const report={version,digest,architecture:image.Architecture,container:name,ports:container.NetworkSettings.Ports,limits:{memory:container.HostConfig.Memory,nanoCPUs:container.HostConfig.NanoCpus},applicationRole:'poc_app NOSUPERUSER NOBYPASSRLS',credentials:'generated locally, ignored files only; REDACTED'};
writeFileSync(new URL('evidence/native/postgres-environment.json',root),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
