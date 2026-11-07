import { spawnSync, spawn } from 'node:child_process';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
// Local-only orchestration. No API/schema/env/OAuth changes; no Vite server exposed.
const root = new URL('../', import.meta.url);
const frontend = new URL('../../frontend/', import.meta.url);
const assets = new URL('.local/e31-assets/', root);
const built = new URL('.local/integration-dist/', frontend);
function run(args: string[], cwd: URL) {
  const result = spawnSync('npm', args, { cwd, stdio: 'inherit' });
  if (result.status !== 0) throw new Error('Local frontend preparation failed');
}
if (!process.argv.includes('--prepare-only')) {
  const port = createServer();
  await new Promise<void>((resolve, reject) => { port.once('error', reject); port.listen(8789, '127.0.0.1', resolve); });
  await new Promise<void>((resolve, reject) => port.close(error => error ? reject(error) : resolve()));
}
run(['run', 'build:integration'], frontend);
run(['run', 'docs:assets'], root);
await mkdir(new URL('demo/', assets), { recursive: true });
await cp(built, new URL('demo/', assets), { recursive: true });
// Keep an existing local-only API test interface if present, without copying vars.
let oldHeaders = '';
try {
  await cp(new URL('.local/e22-api-assets/__local/', root), new URL('__local/', assets), { recursive: true });
  oldHeaders = await readFile(new URL('.local/e22-api-assets/_headers', root), 'utf8');
} catch (error) { if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error; }
const diagnostic = await readFile(new URL('demo/integration.html', assets), 'utf8');
await mkdir(new URL('__local/integration/', assets), { recursive: true });
await writeFile(new URL('__local/integration/index.html', assets), diagnostic);
// Diagnostic should have one development-only address, separate from demo paths.
await writeFile(new URL('demo/integration.html', assets), '<!doctype html><title>Use local integration check</title><a href="/__local/integration/">Local integration check</a>');
await writeFile(new URL('_headers', assets), `${oldHeaders}
/demo/*
  Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' https://www.geoboundaries.org https://raw.githubusercontent.com https://media.githubusercontent.com; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
  Referrer-Policy: no-referrer
  Cache-Control: private, no-store
  X-Content-Type-Options: nosniff
/__local/integration/*
  Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
  Referrer-Policy: no-referrer
  Cache-Control: private, no-store
  X-Content-Type-Options: nosniff
`);
if (process.argv.includes('--prepare-only')) {
  console.log('Local assets prepared; no server started.');
} else {
  // CLI asset binding only in explicitly local dev. No prod config or SPA fallback.
  const child = spawn(fileURLToPath(new URL('node_modules/.bin/wrangler', root)), ['dev', '--local', '--env', 'dev', '--ip', '127.0.0.1', '--port', '8789', '--local-protocol', 'https', '--assets', fileURLToPath(assets)], { cwd: root, stdio: 'inherit' });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => child.kill(signal));
  child.once('error', () => { process.exitCode = 1; });
  child.once('exit', code => { process.exitCode = code ?? 1; });
}
