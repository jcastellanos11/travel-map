import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, access } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Starts a NEW cluster, never connects to a PoC/service or downloads binaries.
const backend = fileURLToPath(new URL('../', import.meta.url));
let cluster: string | undefined;
let started = false;
let pgBin: string | undefined;

function command(binary: string, args: string[]): void {
  if (!pgBin) throw new Error('PG_BIN_REQUIRED');
  const result = spawnSync(join(pgBin, binary), args, { encoding: 'utf8', timeout: 30_000 });
  if (result.status !== 0) {
    // These processes use only this generated synthetic cluster, no supplied URL.
    console.error(result.stderr);
    throw new Error(`${binary}_FAILED`);
  }
}

try {
  if (!process.env.PG_BIN) throw new Error('Set PG_BIN to an existing PostgreSQL 17+ bin directory');
  pgBin = resolve(process.env.PG_BIN);
  for (const binary of ['initdb', 'pg_ctl', 'postgres']) await access(join(pgBin, binary));
  await mkdir(join(backend, '.local'), { recursive: true });
  cluster = await mkdtemp(join(backend, '.local/pg-e0-'));
  const data = join(cluster, 'data');
  const socket = join(cluster, 'socket');
  await mkdir(socket, { mode: 0o700 });
  const server = createServer();
  await new Promise<void>((resolvePort, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolvePort);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('LOCAL_PORT_UNAVAILABLE');
  const port = address.port;
  await new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done()));
  command('postgres', ['--version']);
  command('initdb', ['-D', data, '-U', 'travel_map_e0', '--auth-local=trust', '--auth-host=trust', '--encoding=UTF8', '--locale=C']);
  command('pg_ctl', ['-D', data, '-l', join(cluster, 'postgres.log'), '-o',
    `-h 127.0.0.1 -p ${port} -k ${socket} -c max_connections=10`, '-w', 'start']);
  started = true;
  console.log('Disposable PostgreSQL started on loopback; running E0 migration tests.');
  const status = await new Promise<number>((done, reject) => {
    const child = spawn(process.execPath, ['--test', 'tests/database.test.ts'], {
      cwd: backend,
      env: { ...process.env, LOCAL_DATABASE_ONLY: '1',
        DATABASE_URL: `postgresql://travel_map_e0@127.0.0.1:${port}/travel_map_test_e0` },
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code) => done(code ?? 1));
  });
  if (status !== 0) process.exitCode = status;
} catch (error) {
  console.error(error instanceof Error ? error.message : 'LOCAL_POSTGRES_FAILED');
  process.exitCode = 1;
} finally {
  if (started && cluster) {
    try { command('pg_ctl', ['-D', join(cluster, 'data'), '-m', 'fast', '-w', 'stop']); }
    catch { process.exitCode = 1; started = false; }
    // Delete only this script's disposable directory after successful shutdown.
    if (started) { await rm(cluster, { recursive: true }); console.log('Disposable PostgreSQL stopped and removed.'); }
  }
}
