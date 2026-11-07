import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
const root = new URL('../', import.meta.url);
test('normal production demo excludes the development diagnostic and private API client', async () => {
  const files = await readdir(new URL('dist/', root), { recursive: true });
  assert.ok(files.includes('index.html')); assert.ok(!files.includes('integration.html'));
  for (const name of files.filter(name => name.endsWith('.js'))) {
    const text = await readFile(new URL('dist/' + name, root), 'utf8');
    assert.doesNotMatch(text, /E3\.1 integration check|Check current session|csrfToken|\/api\/v1\/me/);
  }
  assert.ok(files.includes('data/countries.geojson'));
  assert.ok(files.some(name => name.startsWith('images/') && name.endsWith('.webp')));
});
test('integration entries isolate static demo imports from API diagnostic', async () => {
  const files = await readdir(new URL('.local/integration-dist/assets/', root));
  const demo = files.find(n => n.startsWith('demo-') && n.endsWith('.js'));
  const diagnostic = files.find(n => n.startsWith('integration-') && n.endsWith('.js'));
  assert.ok(demo && diagnostic);
  const demoText = await readFile(new URL('.local/integration-dist/assets/' + demo, root), 'utf8');
  const checkText = await readFile(new URL('.local/integration-dist/assets/' + diagnostic, root), 'utf8');
  assert.doesNotMatch(demoText, /csrfToken|\/api\/v1\/me/);
  assert.doesNotMatch(checkText, /geoboundaries|ankara-2026|bogota-2026|images\/turkiye/);
  assert.match(checkText, /\/api\/v1\/me/);
});
