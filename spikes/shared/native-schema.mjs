// Disposable experimental schema. No production migration or provider resources.
import fixture from './fixtures.json' with { type: 'json' };
const q = (s) => `'${String(s).replaceAll("'", "''")}'`;

export function schema(postgres = false) {
  const type = postgres ? 'BIGINT' : 'INTEGER';
  return `
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY,active INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),active INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY,owner_id TEXT REFERENCES users(id),state TEXT NOT NULL,members_create INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS trips (id TEXT PRIMARY KEY,project_id TEXT REFERENCES projects(id),state TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS places (id TEXT PRIMARY KEY,country TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS visits (id TEXT PRIMARY KEY,trip_id TEXT REFERENCES trips(id),place_id TEXT REFERENCES places(id),creator_id TEXT REFERENCES users(id),state TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS photos (id TEXT PRIMARY KEY,visit_id TEXT REFERENCES visits(id),author_id TEXT REFERENCES users(id),state TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS pm (project_id TEXT REFERENCES projects(id),user_id TEXT REFERENCES users(id),role TEXT NOT NULL,active INTEGER NOT NULL,PRIMARY KEY(project_id,user_id));
CREATE TABLE IF NOT EXISTS tm (trip_id TEXT REFERENCES trips(id),user_id TEXT REFERENCES users(id),active INTEGER NOT NULL,PRIMARY KEY(trip_id,user_id));
CREATE TABLE IF NOT EXISTS account (user_id TEXT PRIMARY KEY,used ${type} NOT NULL DEFAULT 0 CHECK(used>=0),reserved ${type} NOT NULL DEFAULT 0 CHECK(reserved>=0),quota ${type} NOT NULL CHECK(quota>=0),CHECK(used+reserved<=quota));
CREATE TABLE IF NOT EXISTS upload (
 user_id TEXT REFERENCES account(user_id),op TEXT,file TEXT,visit_id TEXT NOT NULL,fingerprint TEXT NOT NULL,
 estimate ${type} NOT NULL CHECK(estimate>0),actual ${type} NOT NULL DEFAULT 0 CHECK(actual>=0),
 original_bytes ${type} NOT NULL DEFAULT 0,display_bytes ${type} NOT NULL DEFAULT 0,
 state TEXT NOT NULL CHECK(state IN ('reserved','failed','ready','trash')),attempts INTEGER NOT NULL DEFAULT 1,
 expires ${type} NOT NULL,deleted_at ${type},PRIMARY KEY(user_id,op,file),
 CHECK(state NOT IN ('ready','trash') OR (actual=original_bytes+display_bytes AND original_bytes>0 AND display_bytes>0))
);
CREATE TABLE IF NOT EXISTS asset (user_id TEXT,op TEXT,file TEXT,kind TEXT,bytes ${type} NOT NULL CHECK(bytes>0),PRIMARY KEY(user_id,op,file,kind),FOREIGN KEY(user_id,op,file) REFERENCES upload(user_id,op,file));
CREATE TABLE IF NOT EXISTS invite (id TEXT PRIMARY KEY,token_hash TEXT UNIQUE NOT NULL,trip_id TEXT REFERENCES trips(id),expires ${type} NOT NULL,revoked INTEGER NOT NULL DEFAULT 0,used_by TEXT REFERENCES users(id));
CREATE TABLE IF NOT EXISTS rollback_probe (id TEXT PRIMARY KEY);
` + (postgres ? postgresTriggers() : sqliteTriggers());
}

function sqliteTriggers() {
  return `
CREATE TRIGGER IF NOT EXISTS upload_insert BEFORE INSERT ON upload BEGIN
 SELECT CASE WHEN NEW.state!='reserved' OR NOT EXISTS(SELECT 1 FROM account WHERE user_id=NEW.user_id AND used+reserved+NEW.estimate<=quota) THEN RAISE(ABORT,'quota_denied') END;
END;
CREATE TRIGGER IF NOT EXISTS upload_reserved AFTER INSERT ON upload BEGIN
 UPDATE account SET reserved=reserved+NEW.estimate WHERE user_id=NEW.user_id;
END;
CREATE TRIGGER IF NOT EXISTS upload_transition BEFORE UPDATE ON upload BEGIN
 SELECT CASE WHEN NEW.fingerprint!=OLD.fingerprint OR NEW.visit_id!=OLD.visit_id OR NEW.estimate!=OLD.estimate THEN RAISE(ABORT,'idempotency_conflict') END;
 SELECT CASE WHEN NOT((OLD.state='failed' AND NEW.state='reserved') OR (OLD.state='reserved' AND NEW.state IN ('failed','ready')) OR (OLD.state='ready' AND NEW.state='trash') OR (OLD.state='trash' AND NEW.state='ready')) THEN RAISE(ABORT,'invalid_state') END;
END;
CREATE TRIGGER IF NOT EXISTS upload_retry AFTER UPDATE ON upload WHEN OLD.state='failed' AND NEW.state='reserved' BEGIN
 UPDATE account SET reserved=reserved+NEW.estimate WHERE user_id=NEW.user_id;
END;
CREATE TRIGGER IF NOT EXISTS upload_fail AFTER UPDATE ON upload WHEN OLD.state='reserved' AND NEW.state='failed' BEGIN
 UPDATE account SET reserved=reserved-OLD.estimate WHERE user_id=NEW.user_id;
END;
CREATE TRIGGER IF NOT EXISTS upload_ready AFTER UPDATE ON upload WHEN OLD.state='reserved' AND NEW.state='ready' BEGIN
 UPDATE account SET used=used+NEW.actual,reserved=reserved-OLD.estimate WHERE user_id=NEW.user_id;
 INSERT INTO asset VALUES(NEW.user_id,NEW.op,NEW.file,'original',NEW.original_bytes);
 INSERT INTO asset VALUES(NEW.user_id,NEW.op,NEW.file,'display',NEW.display_bytes);
END;
CREATE TRIGGER IF NOT EXISTS invite_used AFTER UPDATE ON invite WHEN OLD.used_by IS NULL AND NEW.used_by IS NOT NULL BEGIN
 INSERT INTO tm(trip_id,user_id,active) VALUES(NEW.trip_id,NEW.used_by,1) ON CONFLICT(trip_id,user_id) DO UPDATE SET active=1;
END;
`;
}

function postgresTriggers() {
  return `
CREATE OR REPLACE FUNCTION poc_upload_trigger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
   IF NEW.state!='reserved' THEN RAISE EXCEPTION 'invalid_state'; END IF;
   UPDATE account SET reserved=reserved+NEW.estimate WHERE user_id=NEW.user_id AND used+reserved+NEW.estimate<=quota;
   IF NOT FOUND THEN RAISE EXCEPTION 'quota_denied'; END IF;
 ELSE
   IF NEW.fingerprint!=OLD.fingerprint OR NEW.visit_id!=OLD.visit_id OR NEW.estimate!=OLD.estimate THEN RAISE EXCEPTION 'idempotency_conflict'; END IF;
   IF OLD.state='failed' AND NEW.state='reserved' THEN
     UPDATE account SET reserved=reserved+NEW.estimate WHERE user_id=NEW.user_id AND used+reserved+NEW.estimate<=quota;
     IF NOT FOUND THEN RAISE EXCEPTION 'quota_denied'; END IF;
   ELSIF OLD.state='reserved' AND NEW.state='failed' THEN
     UPDATE account SET reserved=reserved-OLD.estimate WHERE user_id=NEW.user_id;
   ELSIF OLD.state='reserved' AND NEW.state='ready' THEN
     UPDATE account SET used=used+NEW.actual,reserved=reserved-OLD.estimate WHERE user_id=NEW.user_id;
   ELSIF NOT ((OLD.state='ready' AND NEW.state='trash') OR (OLD.state='trash' AND NEW.state='ready')) THEN
     RAISE EXCEPTION 'invalid_state';
   END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS poc_upload ON upload;
CREATE TRIGGER poc_upload BEFORE INSERT OR UPDATE ON upload FOR EACH ROW EXECUTE FUNCTION poc_upload_trigger();
CREATE OR REPLACE FUNCTION poc_asset_trigger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.state='reserved' AND NEW.state='ready' THEN
  INSERT INTO asset VALUES(NEW.user_id,NEW.op,NEW.file,'original',NEW.original_bytes);
  INSERT INTO asset VALUES(NEW.user_id,NEW.op,NEW.file,'display',NEW.display_bytes);
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS poc_assets ON upload;
CREATE TRIGGER poc_assets AFTER UPDATE ON upload FOR EACH ROW EXECUTE FUNCTION poc_asset_trigger();
CREATE OR REPLACE FUNCTION poc_invite_trigger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.used_by IS NULL AND NEW.used_by IS NOT NULL THEN
  INSERT INTO tm VALUES(NEW.trip_id,NEW.used_by,1) ON CONFLICT(trip_id,user_id) DO UPDATE SET active=1;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS poc_invite ON invite;
CREATE TRIGGER poc_invite AFTER UPDATE ON invite FOR EACH ROW EXECUTE FUNCTION poc_invite_trigger();
`;
}

export function seed() {
  const rows = [];
  const insert = (table, values) => rows.push(`INSERT INTO ${table} VALUES(${values.map((v) => typeof v === 'number' ? v : q(v)).join(',')}) ON CONFLICT DO NOTHING;`);
  fixture.users.forEach((id) => { insert('users', [id, id === 'inactive' ? 0 : 1]); insert('sessions', [`test-session:${id}`, id, 1]); });
  fixture.projects.forEach((p) => insert('projects', [p.id, p.owner, p.state, +p.membersCanCreateTrips]));
  fixture.trips.forEach((t) => insert('trips', [t.id,t.project,t.state]));
  fixture.places.forEach((p) => insert('places', [p.id,p.country]));
  fixture.visits.forEach((v) => insert('visits', [v.id,v.trip,v.place,v.creator,v.state]));
  fixture.photos.forEach((p) => insert('photos', [p.id,p.visit,p.author,p.state]));
  fixture.projectMemberships.forEach((m) => insert('pm', [m.project,m.user,m.role,+m.active]));
  fixture.tripMemberships.forEach((m) => insert('tm', [m.trip,m.user,+m.active]));
  return rows.join('\n');
}
