
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY,active INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),active INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY,owner_id TEXT REFERENCES users(id),state TEXT NOT NULL,members_create INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS trips (id TEXT PRIMARY KEY,project_id TEXT REFERENCES projects(id),state TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS places (id TEXT PRIMARY KEY,country TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS visits (id TEXT PRIMARY KEY,trip_id TEXT REFERENCES trips(id),place_id TEXT REFERENCES places(id),creator_id TEXT REFERENCES users(id),state TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS photos (id TEXT PRIMARY KEY,visit_id TEXT REFERENCES visits(id),author_id TEXT REFERENCES users(id),state TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS pm (project_id TEXT REFERENCES projects(id),user_id TEXT REFERENCES users(id),role TEXT NOT NULL,active INTEGER NOT NULL,PRIMARY KEY(project_id,user_id));
CREATE TABLE IF NOT EXISTS tm (trip_id TEXT REFERENCES trips(id),user_id TEXT REFERENCES users(id),active INTEGER NOT NULL,PRIMARY KEY(trip_id,user_id));
CREATE TABLE IF NOT EXISTS account (user_id TEXT PRIMARY KEY,used BIGINT NOT NULL DEFAULT 0 CHECK(used>=0),reserved BIGINT NOT NULL DEFAULT 0 CHECK(reserved>=0),quota BIGINT NOT NULL CHECK(quota>=0),CHECK(used+reserved<=quota));
CREATE TABLE IF NOT EXISTS upload (
 user_id TEXT REFERENCES account(user_id),op TEXT,file TEXT,visit_id TEXT NOT NULL,fingerprint TEXT NOT NULL,
 estimate BIGINT NOT NULL CHECK(estimate>0),actual BIGINT NOT NULL DEFAULT 0 CHECK(actual>=0),
 original_bytes BIGINT NOT NULL DEFAULT 0,display_bytes BIGINT NOT NULL DEFAULT 0,
 state TEXT NOT NULL CHECK(state IN ('reserved','failed','ready','trash')),attempts INTEGER NOT NULL DEFAULT 1,
 expires BIGINT NOT NULL,deleted_at BIGINT,PRIMARY KEY(user_id,op,file),
 CHECK(state NOT IN ('ready','trash') OR (actual=original_bytes+display_bytes AND original_bytes>0 AND display_bytes>0))
);
CREATE TABLE IF NOT EXISTS asset (user_id TEXT,op TEXT,file TEXT,kind TEXT,bytes BIGINT NOT NULL CHECK(bytes>0),PRIMARY KEY(user_id,op,file,kind),FOREIGN KEY(user_id,op,file) REFERENCES upload(user_id,op,file));
CREATE TABLE IF NOT EXISTS invite (id TEXT PRIMARY KEY,token_hash TEXT UNIQUE NOT NULL,trip_id TEXT REFERENCES trips(id),expires BIGINT NOT NULL,revoked INTEGER NOT NULL DEFAULT 0,used_by TEXT REFERENCES users(id));
CREATE TABLE IF NOT EXISTS rollback_probe (id TEXT PRIMARY KEY);

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
INSERT INTO users VALUES('owner',1) ON CONFLICT DO NOTHING;
INSERT INTO sessions VALUES('test-session:owner','owner',1) ON CONFLICT DO NOTHING;
INSERT INTO users VALUES('admin',1) ON CONFLICT DO NOTHING;
INSERT INTO sessions VALUES('test-session:admin','admin',1) ON CONFLICT DO NOTHING;
INSERT INTO users VALUES('member',1) ON CONFLICT DO NOTHING;
INSERT INTO sessions VALUES('test-session:member','member',1) ON CONFLICT DO NOTHING;
INSERT INTO users VALUES('guest',1) ON CONFLICT DO NOTHING;
INSERT INTO sessions VALUES('test-session:guest','guest',1) ON CONFLICT DO NOTHING;
INSERT INTO users VALUES('outsider',1) ON CONFLICT DO NOTHING;
INSERT INTO sessions VALUES('test-session:outsider','outsider',1) ON CONFLICT DO NOTHING;
INSERT INTO users VALUES('overlap',1) ON CONFLICT DO NOTHING;
INSERT INTO sessions VALUES('test-session:overlap','overlap',1) ON CONFLICT DO NOTHING;
INSERT INTO users VALUES('inactive',0) ON CONFLICT DO NOTHING;
INSERT INTO sessions VALUES('test-session:inactive','inactive',1) ON CONFLICT DO NOTHING;
INSERT INTO projects VALUES('project-main','owner','active',0) ON CONFLICT DO NOTHING;
INSERT INTO projects VALUES('project-other','outsider','active',0) ON CONFLICT DO NOTHING;
INSERT INTO trips VALUES('trip-italy','project-main','active') ON CONFLICT DO NOTHING;
INSERT INTO trips VALUES('trip-colombia','project-main','active') ON CONFLICT DO NOTHING;
INSERT INTO trips VALUES('trip-colombia-repeat','project-main','active') ON CONFLICT DO NOTHING;
INSERT INTO trips VALUES('trip-other','project-other','active') ON CONFLICT DO NOTHING;
INSERT INTO places VALUES('place-rome','ITA') ON CONFLICT DO NOTHING;
INSERT INTO places VALUES('place-bogota','COL') ON CONFLICT DO NOTHING;
INSERT INTO visits VALUES('visit-rome','trip-italy','place-rome','guest','active') ON CONFLICT DO NOTHING;
INSERT INTO visits VALUES('visit-bogota-1','trip-colombia','place-bogota','member','active') ON CONFLICT DO NOTHING;
INSERT INTO visits VALUES('visit-bogota-2','trip-colombia','place-bogota','admin','active') ON CONFLICT DO NOTHING;
INSERT INTO visits VALUES('visit-bogota-3','trip-colombia-repeat','place-bogota','member','active') ON CONFLICT DO NOTHING;
INSERT INTO visits VALUES('visit-other','trip-other','place-bogota','outsider','active') ON CONFLICT DO NOTHING;
INSERT INTO photos VALUES('photo-rome-guest','visit-rome','guest','ready') ON CONFLICT DO NOTHING;
INSERT INTO photos VALUES('photo-rome-member','visit-rome','member','ready') ON CONFLICT DO NOTHING;
INSERT INTO photos VALUES('photo-bogota-1','visit-bogota-1','member','ready') ON CONFLICT DO NOTHING;
INSERT INTO photos VALUES('photo-bogota-2','visit-bogota-2','admin','ready') ON CONFLICT DO NOTHING;
INSERT INTO photos VALUES('photo-bogota-3','visit-bogota-3','member','ready') ON CONFLICT DO NOTHING;
INSERT INTO photos VALUES('photo-other','visit-other','outsider','ready') ON CONFLICT DO NOTHING;
INSERT INTO pm VALUES('project-main','admin','admin',1) ON CONFLICT DO NOTHING;
INSERT INTO pm VALUES('project-main','member','member',1) ON CONFLICT DO NOTHING;
INSERT INTO pm VALUES('project-main','overlap','member',1) ON CONFLICT DO NOTHING;
INSERT INTO tm VALUES('trip-italy','guest',1) ON CONFLICT DO NOTHING;
INSERT INTO tm VALUES('trip-colombia','overlap',1) ON CONFLICT DO NOTHING;