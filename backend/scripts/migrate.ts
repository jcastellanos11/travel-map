import pg from 'pg';
import { localDatabaseUrl, migrate } from './migrations.ts';

const direction = process.argv[2] ?? 'status';
let client: pg.Client | undefined;
try {
  if (!['up', 'down', 'status'].includes(direction)) throw new Error('INVALID_MIGRATION_DIRECTION');
  if (direction === 'down' && process.argv[3] !== '--allow-destructive-local') {
    throw new Error('ROLLBACK_CONFIRMATION_REQUIRED');
  }
  const connectionString = localDatabaseUrl(process.env.DATABASE_URL, process.env.LOCAL_DATABASE_ONLY);
  client = new pg.Client({ connectionString, connectionTimeoutMillis: 5000, application_name: 'travel-map-local-migrations' });
  await client.connect();
  await client.query("SET lock_timeout = '5s'; SET statement_timeout = '30s'");
  const changed = await migrate(client, direction as 'up' | 'down' | 'status');
  console.log(JSON.stringify({ direction, versions: changed }));
} catch (error) {
  // Never print pg messages/URLs: they can contain credentials, SQL or row data.
  const code = error instanceof pg.DatabaseError ? error.code : 'LOCAL_MIGRATION_ERROR';
  console.error(JSON.stringify({ error: code, message: 'Migration failed; check local configuration and migration history' }));
  process.exitCode = 1;
} finally {
  await client?.end();
}
