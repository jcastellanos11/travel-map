import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const source = await readFile(new URL('../../backend/openapi.json', import.meta.url), 'utf8');
const names = ['Me', 'Error', 'Health', 'Project', 'ProjectCreate', 'Trip', 'TripCreate', 'Visit', 'VisitCreate', 'VisitPatch', 'Place', 'MapMarker', 'VisitDate', 'ProjectPage', 'TripPage', 'VisitPage', 'PlacePage', 'MapMarkerPage'];
const all = JSON.parse(source).components.schemas;
const schemas = {};
function include(name) {
  if (schemas[name]) return;
  if (!all[name]) throw Error('Missing API schema: ' + name);
  schemas[name] = all[name];
  JSON.stringify(all[name], (key, value) => { if (key === '$ref') include(value.split('/').at(-1)); return value; });
}
names.forEach(include);
function type(s) {
  if (s.$ref) return s.$ref.split('/').at(-1);
  if (s.const !== undefined) return JSON.stringify(s.const);
  if (s.enum) return s.enum.map(v => JSON.stringify(v)).join(' | ');
  if (s.oneOf || s.anyOf) return (s.oneOf || s.anyOf).map(type).join(' | ');
  if (s.type === 'object') return `{ ${Object.entries(s.properties).map(([k, v]) => `readonly ${JSON.stringify(k)}${s.required?.includes(k) ? '' : '?'}: ${type(v)};`).join(' ')} }`;
  if (s.type === 'array') return `ReadonlyArray<${type(s.items)}>`;
  return { string: 'string', number: 'number', integer: 'number', boolean: 'boolean', null: 'null' }[s.type] ?? (() => { throw Error('Unsupported schema'); })();
}
const output = `// Generated from backend/openapi.json; do not hand-edit.\n// SHA-256: ${createHash('sha256').update(source).digest('hex')}\n${Object.entries(schemas).map(([n, s]) => `export type ${n} = ${type(s)};`).join('\n')}\nexport interface ApiDtos { ${Object.keys(schemas).map(n => `${n}: ${n};`).join(' ')} }\nexport const schemas = ${JSON.stringify(schemas, null, 2)} as const;\n`;
const target = new URL('../src/api/generated.ts', import.meta.url);
if (process.argv.includes('--check')) {
  if (await readFile(target, 'utf8') !== output) throw Error('API contracts drifted: review and run npm run api:generate');
} else await writeFile(target, output);
