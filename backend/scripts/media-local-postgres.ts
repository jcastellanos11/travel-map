import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, access } from 'node:fs/promises';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import { join, resolve } from 'node:path';
import pg from 'pg';

// NEW isolated native cluster only. Never accepts DATABASE_URL or reads .env.
const backend = new URL('../', import.meta.url).pathname;
const marker = randomBytes(16).toString('hex');
let directory: string | undefined;
let started = false;
const pgBin = process.env.PG_BIN ? resolve(process.env.PG_BIN) : '';
function command(binary: string, args: string[]): void {
  const r = spawnSync(join(pgBin, binary), args, { encoding: 'utf8', timeout: 30000 });
  if (r.status !== 0) throw new Error(`E41_${binary}_FAILED`);
}
try {
  if (!pgBin || process.env.DATABASE_URL || process.env.PGHOST || process.env.PGSERVICE || process.env.PGOPTIONS) {
    throw new Error('E41_REQUIRES_PG_BIN_WITHOUT_CONNECTION_OVERRIDES');
  }
  for (const bin of ['initdb', 'pg_ctl', 'postgres']) await access(join(pgBin, bin));
  await mkdir(join(backend, '.local'), { recursive: true });
  directory = await mkdtemp(join(backend, '.local/e41-'));
  await mkdir(join(directory, 'socket'), { mode: 0o700 });
  const server = createServer();
  await new Promise<void>((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  const address = server.address();
  if (!address || typeof address === 'string' || address.port === 57422) throw new Error('E41_RANDOM_PORT_REQUIRED');
  const port = address.port;
  await new Promise<void>((done, reject) => server.close(e => e ? reject(e) : done()));
  command('initdb', ['-D', join(directory, 'data'), '-U', 'e41_harness', '--auth-local=trust', '--auth-host=trust', '--encoding=UTF8', '--locale=C']);
  command('pg_ctl', ['-D', join(directory, 'data'), '-l', join(directory, 'postgres.log'), '-o',
    `-h 127.0.0.1 -p ${port} -k ${directory}/socket -c max_connections=60 -c travel_map.e41_marker=${marker}`, '-w', 'start']);
  started = true;
  const database = `travel_map_test_e41_${marker}`;
  const admin = new pg.Client({ connectionString: `postgresql://e41_harness@127.0.0.1:${port}/postgres` });
  await admin.connect();
  try {
    // This connection is to the process we just spawned; verify before CREATE DATABASE.
    const r = (await admin.query("SELECT current_setting('data_directory') d,current_setting('travel_map.e41_marker',true) m,host(inet_server_addr()) h,inet_server_port() p")).rows[0];
    if (r.d !== join(directory, 'data') || r.m !== marker || r.h !== '127.0.0.1' || r.p !== port) throw new Error('E41_SPAWN_IDENTITY_MISMATCH');
    await admin.query(`CREATE DATABASE ${database}`);
    await admin.query(`COMMENT ON DATABASE ${database} IS 'travel-map:e41:disposable:${marker}'`);
  } finally { await admin.end(); }
  const files = process.argv.includes('--all') ? ['tests/database.test.ts', 'tests/e1.integration.test.ts', 'tests/trips.integration.test.ts', 'tests/geography.integration.test.ts', 'tests/collaboration.integration.test.ts', 'tests/invitations.integration.test.ts', 'tests/media.integration.test.ts'] : ['tests/media.integration.test.ts'];
  const status = await new Promise<number>((done, reject) => {
    const child = spawn(process.execPath, ['--test', ...files], { cwd: backend,
      env: { ...process.env, LOCAL_DATABASE_ONLY: '1', DATABASE_URL: `postgresql://e41_harness@127.0.0.1:${port}/${database}`,
        E41_CLUSTER_MARKER: marker, E41_CLUSTER_DIRECTORY: directory }, stdio: 'inherit' });
    child.once('error', reject); child.once('exit', code => done(code ?? 1));
  });
  if (status) process.exitCode = status;
} catch (e) { console.error(e instanceof Error ? e.message : 'E41_LOCAL_TEST_FAILED'); process.exitCode = 1; }
finally {
  if (started && directory) {
    try { command('pg_ctl', ['-D', join(directory, 'data'), '-m', 'fast', '-w', 'stop']); started = false; }
    catch { process.exitCode = 1; }
    if (!started) { await rm(directory, { recursive: true }); console.log('Only the generated E4.1 cluster stopped and removed.'); }
  }
}
