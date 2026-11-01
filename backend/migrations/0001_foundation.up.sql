-- PostgreSQL 17+. No auth schema dependency, extensions or production grants.
-- gen_random_uuid() is built in. Identity mapping is finalized in E1.
CREATE SCHEMA travel_map;
REVOKE ALL ON SCHEMA travel_map FROM PUBLIC;

CREATE TABLE travel_map.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supabase_auth_user_id uuid NOT NULL UNIQUE,
  display_name text NOT NULL CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 200),
  email text,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'deletion_requested', 'deleted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CHECK ((status = 'deleted') = (deleted_at IS NOT NULL)),
  CHECK (deleted_at IS NULL OR deleted_at >= created_at)
);

CREATE TABLE travel_map.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES travel_map.users(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 200),
  trip_creation_policy text NOT NULL DEFAULT 'admins_only'
    CHECK (trip_creation_policy IN ('admins_only', 'all_project_members')),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived', 'deletion_requested', 'deleted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  deleted_at timestamptz,
  CHECK ((status = 'deleted') = (deleted_at IS NOT NULL)),
  CHECK (status <> 'archived' OR archived_at IS NOT NULL),
  CHECK (archived_at IS NULL OR archived_at >= created_at),
  CHECK (deleted_at IS NULL OR deleted_at >= created_at)
);
CREATE INDEX projects_owner_idx ON travel_map.projects (owner_user_id, status);

CREATE TABLE travel_map.project_memberships (
  project_id uuid NOT NULL REFERENCES travel_map.projects(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES travel_map.users(id) ON DELETE RESTRICT,
  role text NOT NULL CHECK (role IN ('admin', 'member')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  PRIMARY KEY (project_id, user_id),
  CHECK ((status = 'revoked') = (revoked_at IS NOT NULL)),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);
CREATE INDEX memberships_user_idx
  ON travel_map.project_memberships (user_id, project_id) WHERE status = 'active';

CREATE TABLE travel_map.app_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES travel_map.users(id) ON DELETE RESTRICT,
  token_digest text NOT NULL UNIQUE CHECK (token_digest ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  idle_expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK (expires_at > created_at),
  CHECK (idle_expires_at > created_at AND idle_expires_at <= expires_at),
  CHECK (last_seen_at >= created_at AND last_seen_at <= expires_at),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);
CREATE INDEX sessions_user_live_idx
  ON travel_map.app_sessions (user_id, expires_at) WHERE revoked_at IS NULL;

CREATE FUNCTION travel_map.touch_updated_at() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;
CREATE TRIGGER users_touch BEFORE UPDATE ON travel_map.users
  FOR EACH ROW EXECUTE FUNCTION travel_map.touch_updated_at();
CREATE TRIGGER projects_touch BEFORE UPDATE ON travel_map.projects
  FOR EACH ROW EXECUTE FUNCTION travel_map.touch_updated_at();
CREATE TRIGGER memberships_touch BEFORE UPDATE ON travel_map.project_memberships
  FOR EACH ROW EXECUTE FUNCTION travel_map.touch_updated_at();

-- A single source of ownership: no owner membership role or duplicate owner row.
-- Lock parent rows to serialize conflicting ownership/membership writes.
CREATE FUNCTION travel_map.check_membership_owner() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE owner_id uuid;
BEGIN
  SELECT owner_user_id INTO owner_id FROM travel_map.projects
    WHERE id = NEW.project_id FOR SHARE;
  IF owner_id = NEW.user_id THEN
    RAISE EXCEPTION 'Owner is represented by projects.owner_user_id'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER memberships_owner BEFORE INSERT OR UPDATE
  ON travel_map.project_memberships FOR EACH ROW
  EXECUTE FUNCTION travel_map.check_membership_owner();

CREATE FUNCTION travel_map.check_project_owner() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE owner_status text;
BEGIN
  SELECT status INTO owner_status FROM travel_map.users
    WHERE id = NEW.owner_user_id FOR SHARE;
  IF owner_status IS DISTINCT FROM 'active' AND NEW.status <> 'deleted' THEN
    RAISE EXCEPTION 'Retained projects require an active owner' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM travel_map.project_memberships
    WHERE project_id = NEW.id AND user_id = NEW.owner_user_id) THEN
    RAISE EXCEPTION 'Owner must not also be a membership row' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER projects_owner BEFORE INSERT OR UPDATE ON travel_map.projects
  FOR EACH ROW EXECUTE FUNCTION travel_map.check_project_owner();

CREATE FUNCTION travel_map.protect_project_owner() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF NEW.status <> 'active' AND EXISTS (SELECT 1 FROM travel_map.projects
    WHERE owner_user_id = NEW.id AND status <> 'deleted') THEN
    RAISE EXCEPTION 'Resolve ownership before deactivating account' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER users_owner BEFORE UPDATE OF status ON travel_map.users
  FOR EACH ROW EXECUTE FUNCTION travel_map.protect_project_owner();

-- Defense in depth: private schema, no PUBLIC grants, RLS with no allow policy.
-- E1 must introduce reviewed minimal server privileges/authorization, not BYPASSRLS.
ALTER TABLE travel_map.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE travel_map.users FORCE ROW LEVEL SECURITY;
ALTER TABLE travel_map.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE travel_map.projects FORCE ROW LEVEL SECURITY;
ALTER TABLE travel_map.project_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE travel_map.project_memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE travel_map.app_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE travel_map.app_sessions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA travel_map FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA travel_map FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA travel_map REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA travel_map REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
