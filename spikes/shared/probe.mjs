import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const tools = ['wrangler', 'workerd', 'docker', 'psql', 'postgres', 'initdb', 'supabase', 'heif-enc', 'exiftool', 'magick', 'sips', 'sqlite3'];
const available = Object.fromEntries(tools.map((name) => {
  const probe = spawnSync('/bin/zsh', ['-c', `command -v ${name}`], { encoding: 'utf8' });
  return [name, probe.status === 0 ? probe.stdout.trim() : null];
}));
const db = new DatabaseSync(':memory:');
const sqlite = db.prepare('SELECT sqlite_version() version').get().version;
db.close();
const root = new URL('../', import.meta.url);
const localNodeTools = Object.fromEntries(['wrangler', 'workerd', 'supabase'].map((name) =>
  [name, existsSync(new URL(`../../frontend/node_modules/.bin/${name}`, import.meta.url))],
));
const documents = ['PRD', 'DATA_MODEL', 'AUTHORIZATION_MATRIX', 'ARCHITECTURE', 'POC_PLAN', 'FRONTEND_AUDIT'];
const documentHashes = Object.fromEntries(documents.map((name) => {
  const path = `docs/${name}.md`;
  return [path, createHash('sha256').update(readFileSync(new URL(`../${path}`, root))).digest('hex')];
}));
const report = { node: process.version, sqlite, platform: process.platform, arch: process.arch, tools: available,
  localFrontendBins: localNodeTools, documentHashes, credentialsRead: false, experimentNetworkRequests: 0 };
mkdirSync(new URL('evidence/', root), { recursive: true });
writeFileSync(new URL('evidence/environment.json', root), JSON.stringify(report, null, 2) + '\n');
for (const [folder, runtime, database, identity] of [
  ['cloudflare-only', 'Wrangler/workerd unavailable', 'D1 binding unavailable', 'Google OIDC intentionally mocked'],
  ['cloudflare-supabase', 'Wrangler/workerd unavailable', 'PostgreSQL server/client and Supabase CLI unavailable', 'Supabase Auth intentionally mocked'],
]) {
  const directory = new URL(`${folder}/`, root);
  mkdirSync(directory, { recursive: true });
  writeFileSync(new URL('capabilities.json', directory), JSON.stringify({
    candidate: folder, nativeLocalExecution: 'BLOCKED', runtime, database, identity,
    referenceSimulation: 'shared Node policy + SQLite only; not candidate validation',
    remoteExecution: 'NOT AUTHORIZED; no cloud resources created',
  }, null, 2) + '\n');
}
console.log(JSON.stringify(report, null, 2));
