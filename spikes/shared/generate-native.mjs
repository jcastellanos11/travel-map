import {writeFileSync} from 'node:fs';
import {schema,seed} from './native-schema.mjs';
writeFileSync(new URL('../cloudflare-only/fixture.sql',import.meta.url),schema()+seed());
writeFileSync(new URL('../cloudflare-supabase/fixture.sql',import.meta.url),schema(true)+seed());
console.log('Generated disposable D1/PostgreSQL schemas from the same synthetic fixture.');
