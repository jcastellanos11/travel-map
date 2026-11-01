import {Client} from 'pg';
import {randomBytes} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
let status;
for(const line of readFileSync(new URL('../runs/supabase-native-start.log',import.meta.url),'utf8').split('\n')){
 try{const value=JSON.parse(line);if(value.endpoints)status=value;}catch{}
}
if(status?.runtime!=='native')throw new Error('expected_native_stack');
const root=new URL('../',import.meta.url);
const privateDir=new URL('runs/private/',root);mkdirSync(privateDir,{recursive:true,mode:0o700});
const path=new URL('postgres-native.json',privateDir);
const secret=existsSync(path)?JSON.parse(readFileSync(path)): {password:randomBytes(32).toString('hex')};
writeFileSync(path,JSON.stringify(secret),{mode:0o600});
const admin=new Client({connectionString:status.env.DB_URL});await admin.connect();
if(!(await admin.query("SELECT 1 FROM pg_roles WHERE rolname='poc_app'")).rows.length)await admin.query('CREATE ROLE poc_app LOGIN NOSUPERUSER NOBYPASSRLS');
await admin.query(`ALTER ROLE poc_app PASSWORD '${secret.password}'`);
if(!(await admin.query('SELECT 1 FROM pg_database WHERE datname=$1',['poc_candidate_b'])).rows.length)await admin.query('CREATE DATABASE poc_candidate_b');
const version=(await admin.query('SELECT version() version')).rows[0].version;
await admin.end();
const bootstrap=new URL(status.env.DB_URL);bootstrap.pathname='/poc_candidate_b';
const setup=new Client({connectionString:bootstrap.toString()});await setup.connect();
await setup.query(readFileSync(new URL('cloudflare-supabase/fixture.sql',root),'utf8'));
await setup.query('GRANT USAGE ON SCHEMA public TO poc_app; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO poc_app');
await setup.end();
const app=new URL(bootstrap);app.username='poc_app';app.password=secret.password;
writeFileSync(new URL('cloudflare-supabase/.dev.vars',root),`POC_DATABASE_URL="${app.toString()}"\n`,{mode:0o600});
const report={scope:'Actual PostgreSQL native ARM64 process managed by experimental local Supabase; NOT Docker or managed cloud',version,database:'poc_candidate_b',architecture:'darwin-arm64 (locked native archive)',applicationRole:'poc_app NOSUPERUSER NOBYPASSRLS',listenAddress:app.hostname,port:Number(app.port),credentials:'REDACTED; ignored files only'};
writeFileSync(new URL('evidence/native/postgres-environment.json',root),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
