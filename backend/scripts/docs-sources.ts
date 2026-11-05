import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
if (process.argv[2] !== '--accept-reviewed') throw new Error('Review OpenAPI against source changes before accepting new source hashes');
const root = new URL('../', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('openapi.sources.json', root), 'utf8')) as Record<string, string>;
for (const file of await readdir(new URL('src/', root), { recursive: true })) {
  if (/(routes|validation|types)\.ts$/.test(file)) manifest['src/' + file] = '';
}
for (const path of Object.keys(manifest)) manifest[path] = createHash('sha256').update(await readFile(new URL(path, root))).digest('hex');
await writeFile(new URL('openapi.sources.json', root), JSON.stringify(manifest, null, 2) + '\n');
