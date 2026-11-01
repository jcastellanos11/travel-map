import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';

test('Worker bundle contains no administrative tools, embedded credentials or harness', async () => {
  const files = await readdir(new URL('../dist/', import.meta.url));
  const bundles = files.filter((file) => file.endsWith('.js'));
  assert.ok(bundles.length > 0);
  for (const file of bundles) {
    const contents = await readFile(new URL(`../dist/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(contents, /postgres(?:ql)?:\/\/|BEGIN (?:RSA |EC )?PRIVATE KEY|SUPABASE_SERVICE_ROLE_KEY|service_role|\/harness\/|pg_advisory_lock/);
  }
  // Positive assurance that ignored environment files are not emitted as assets.
  assert.ok(!files.some((file) => file.startsWith('.env') || file.startsWith('.dev.vars')));
});

test('secret-file paths are ignored and no such files are in the Git index', () => {
  for (const path of ['backend/.env', 'backend/.env.test', 'backend/.dev.vars', 'backend/.dev.vars.dev']) {
    const ignored = spawnSync('git', ['check-ignore', '--no-index', path], {
      cwd: new URL('../../', import.meta.url), encoding: 'utf8',
    });
    assert.equal(ignored.status, 0, `${path} must be ignored`);
  }
  const indexed = spawnSync('git', ['ls-files', '--cached', '--', 'backend/'], {
    cwd: new URL('../../', import.meta.url), encoding: 'utf8',
  });
  assert.equal(indexed.status, 0);
  const secretPaths = indexed.stdout.split('\n').filter((path) =>
    /\/(?:\.env(?:\..*)?|\.dev\.vars(?:\..*)?)$/.test(path) && !path.endsWith('.example'));
  assert.deepEqual(secretPaths, []);
});
