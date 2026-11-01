// Local SQLite transaction experiment. NOT a D1 binding or PostgreSQL emulator.
import { DatabaseSync } from 'node:sqlite';

export function open(path: string) {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA busy_timeout=10000; PRAGMA foreign_keys=ON;');
  return db;
}

export function initialize(path: string, used = 0, limit = 500_000_000) {
  const db = open(path);
  db.exec(`
    PRAGMA journal_mode=WAL;
    CREATE TABLE account (
      user TEXT PRIMARY KEY, used INTEGER NOT NULL CHECK(used>=0),
      reserved INTEGER NOT NULL DEFAULT 0 CHECK(reserved>=0),
      quota INTEGER NOT NULL, CHECK(used+reserved<=quota)
    );
    CREATE TABLE upload (
      user TEXT NOT NULL REFERENCES account(user), op TEXT NOT NULL, file TEXT NOT NULL,
      fingerprint TEXT NOT NULL, visit TEXT NOT NULL, estimate INTEGER NOT NULL CHECK(estimate>0),
      state TEXT NOT NULL CHECK(state IN ('reserved','failed','ready')), attempts INTEGER NOT NULL,
      photo TEXT NOT NULL UNIQUE, PRIMARY KEY(user,op,file)
    );
    CREATE TABLE asset (
      photo TEXT NOT NULL REFERENCES upload(photo), kind TEXT NOT NULL,
      bytes INTEGER NOT NULL CHECK(bytes>=0), PRIMARY KEY(photo,kind)
    );
  `);
  db.prepare('INSERT INTO account(user,used,quota) VALUES (?,?,?)').run('member', used, limit);
  db.close();
}

function transaction(db: DatabaseSync, work: () => any) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export type Reservation = { user: string; op: string; file: string; fingerprint: string; visit: string; estimate: number };
const keys = (r: Reservation) => [r.user, r.op, r.file];

export function reserve(db: DatabaseSync, r: Reservation) {
  if (!Number.isSafeInteger(r.estimate) || r.estimate <= 0) throw new Error('invalid_bytes');
  return transaction(db, () => {
    const existing = db.prepare('SELECT * FROM upload WHERE user=? AND op=? AND file=?').get(...keys(r));
    if (existing) {
      if (existing.fingerprint !== r.fingerprint || existing.visit !== r.visit || existing.estimate !== r.estimate) throw new Error('idempotency_conflict');
      if (existing.state !== 'failed') return { result: 'replay', photo: existing.photo };
    }
    const update = db.prepare('UPDATE account SET reserved=reserved+? WHERE user=? AND used+reserved+?<=quota').run(r.estimate, r.user, r.estimate);
    if (update.changes !== 1) return { result: 'quota_denied' };
    if (existing) {
      db.prepare("UPDATE upload SET state='reserved',attempts=attempts+1 WHERE user=? AND op=? AND file=?").run(...keys(r));
    } else {
      db.prepare("INSERT INTO upload VALUES (?,?,?,?,?,?,'reserved',1,?)").run(
        ...keys(r), r.fingerprint, r.visit, r.estimate, JSON.stringify(keys(r)),
      );
    }
    return { result: 'reserved' };
  });
}

export function fail(db: DatabaseSync, r: Reservation) {
  return transaction(db, () => {
    const row = db.prepare('SELECT * FROM upload WHERE user=? AND op=? AND file=?').get(...keys(r));
    if (!row || row.state !== 'reserved') return 'noop';
    db.prepare('UPDATE account SET reserved=reserved-? WHERE user=?').run(row.estimate, r.user);
    db.prepare("UPDATE upload SET state='failed' WHERE user=? AND op=? AND file=?").run(...keys(r));
    return 'released';
  });
}

export function complete(db: DatabaseSync, r: Reservation, original: number, display: number) {
  if (![original, display].every((n) => Number.isSafeInteger(n) && n > 0)) throw new Error('invalid_assets');
  return transaction(db, () => {
    const row = db.prepare('SELECT * FROM upload WHERE user=? AND op=? AND file=?').get(...keys(r));
    if (!row) throw new Error('missing_upload');
    if (row.state === 'ready') {
      const assets = db.prepare('SELECT kind,bytes FROM asset WHERE photo=?').all(row.photo);
      if (!assets.some((a) => a.kind === 'original' && a.bytes === original)
        || !assets.some((a) => a.kind === 'display' && a.bytes === display)) throw new Error('completion_conflict');
      return 'replay';
    }
    if (row.state !== 'reserved') throw new Error('invalid_state');
    const actual = original + display;
    const update = db.prepare('UPDATE account SET used=used+?, reserved=reserved-? WHERE user=? AND used+reserved-?+?<=quota')
      .run(actual, row.estimate, r.user, row.estimate, actual);
    if (update.changes !== 1) throw new Error('quota_actual_bytes');
    const insert = db.prepare('INSERT INTO asset VALUES (?,?,?)');
    insert.run(row.photo, 'original', original);
    insert.run(row.photo, 'display', display);
    db.prepare("UPDATE upload SET state='ready' WHERE user=? AND op=? AND file=?").run(...keys(r));
    return 'ready';
  });
}

export function snapshot(db: DatabaseSync) {
  return {
    account: db.prepare('SELECT * FROM account WHERE user=?').get('member'),
    uploads: db.prepare('SELECT state,count(*) n,sum(attempts) attempts FROM upload GROUP BY state ORDER BY state').all(),
    assets: db.prepare('SELECT count(*) n,coalesce(sum(bytes),0) bytes FROM asset').get(),
  };
}
