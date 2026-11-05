import { readFile, mkdir, writeFile } from 'node:fs/promises';
// Reproducible local assets; no CDN, browser credentials, network or environment reads.
const directory = new URL('../.generated/', import.meta.url);
await mkdir(directory, { recursive: true });
const bundle = await readFile(new URL('../node_modules/swagger-ui-dist/swagger-ui-bundle.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../node_modules/swagger-ui-dist/swagger-ui.css', import.meta.url), 'utf8');
await writeFile(new URL('swagger-assets.ts', directory), `// Generated from pinned swagger-ui-dist. Do not edit.\nexport const bundle = ${JSON.stringify(bundle)};\nexport const css = ${JSON.stringify(css)};\n`);
