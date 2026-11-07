import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
const root = new URL('../', import.meta.url);
test('normal production build includes separate demo/app entries and excludes local diagnostic', async () => {
  const files = await readdir(new URL('dist/', root), { recursive: true });
  assert.ok(files.includes('index.html')); assert.ok(files.includes('app.html')); assert.ok(!files.includes('integration.html'));
  for (const name of files.filter(name => name.endsWith('.js'))) {
    const text = await readFile(new URL('dist/' + name, root), 'utf8');
    assert.doesNotMatch(text, /E3\.1 integration check|Check current session|\/__local\/integration/);
  }
  assert.ok(files.includes('data/countries.geojson'));
  assert.ok(files.some(name => name.startsWith('images/') && name.endsWith('.webp')));
});
test('private app imports no demo memories and bundles no synthetic identities, secrets or source maps', async () => {
  const files = await readdir(new URL('dist/assets/', root));
  const app = files.find(n => n.startsWith('app-') && n.endsWith('.js'));
  assert.ok(app);
  const text = await importGraph(new URL('dist/assets/' + app, root));
  assert.match(text, /\/api\/v1\/me/);
  assert.match(text, /\/api\/v1\/auth\/google\/start/);
  assert.doesNotMatch(text, /images\/colombia|images\/turkiye|ankara-2026|bogota-2026|Explore our memories|www.geoboundaries.org|synthetic-csrf|Private Project 2|DATABASE_URL|SUPABASE_PUBLISHABLE_KEY|OAUTH_COOKIE_KEY/);
  assert.ok(!files.some(n => n.endsWith('.map')));
});
test('integration entries isolate static demo imports from API diagnostic', async () => {
  const files = await readdir(new URL('.local/integration-dist/assets/', root));
  const demo = files.find(n => n.startsWith('demo-') && n.endsWith('.js'));
  const diagnostic = files.find(n => n.startsWith('integration-') && n.endsWith('.js'));
  assert.ok(demo && diagnostic);
  const demoText = await importGraph(new URL('.local/integration-dist/assets/' + demo, root));
  const checkText = await readFile(new URL('.local/integration-dist/assets/' + diagnostic, root), 'utf8');
  assert.doesNotMatch(demoText, /csrfToken|\/api\/v1\/me/);
  assert.doesNotMatch(checkText, /geoboundaries|ankara-2026|bogota-2026|images\/turkiye/);
  // E3.2 shares the transport chunk between app and diagnostic; follow imports.
  assert.match(await importGraph(new URL('.local/integration-dist/assets/' + diagnostic, root)), /\/api\/v1\/me/);
});

async function importGraph(url, visited = new Set()) {
  if (visited.has(url.href)) return '';
  visited.add(url.href);
  const text = await readFile(url, 'utf8');
  const dependencies = [...text.matchAll(/(?:from|import)\s*["'](\.\/[^"']+\.js)["']/g)].map(match => new URL(match[1], url));
  return text + (await Promise.all(dependencies.map(dependency => importGraph(dependency, visited)))).join('\n');
}
