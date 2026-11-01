import { open, reserve, complete } from './sqlite-reference.ts';

const [path, mode, payload] = process.argv.slice(2);
const db = open(path);
const r = JSON.parse(payload);
if (mode === 'unsafe') {
  // Intentional negative control: check before a process barrier, update later.
  const row = db.prepare('SELECT used,reserved,quota FROM unsafe').get();
  process.send!({ phase: 'ready', eligible: Number(row.used) + Number(row.reserved) + r.estimate <= Number(row.quota) });
} else {
  process.send!({ phase: 'ready' });
}
process.once('message', () => {
  try {
    let result;
    if (mode === 'unsafe') {
      db.prepare('UPDATE unsafe SET reserved=reserved+?').run(r.estimate);
      result = { result: 'reserved' };
    } else if (mode === 'crash') {
      db.exec('BEGIN IMMEDIATE');
      db.prepare('UPDATE account SET reserved=reserved+? WHERE user=?').run(r.estimate, r.user);
      // Simulated process death after account mutation but before operation insert/commit.
      process.exit(17);
    } else if (mode === 'complete') {
      result = { result: complete(db, r, 1_000_000, 100_000) };
    } else {
      result = reserve(db, r);
    }
    process.send!({ phase: 'result', ...result });
    db.close();
    process.disconnect();
  } catch (error) {
    process.send!({ phase: 'error', message: (error as Error).message });
    db.close();
    process.disconnect();
    process.exitCode = 1;
  }
});
