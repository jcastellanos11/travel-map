-- E2.1 only. Existing E1 migrations and RPC ACLs remain unchanged.
-- Must run as the existing function owner, including when an operator uses SET ROLE.
-- No role membership or privilege is granted to repair a failing preflight.
DO $preflight$
DECLARE owner_id oid; object_name text;
BEGIN
  SELECT proowner INTO owner_id FROM pg_proc WHERE oid='travel_map.api_call(text,text,jsonb)'::regprocedure;
  IF owner_id IS DISTINCT FROM (SELECT oid FROM pg_roles WHERE rolname=current_user) THEN
    RAISE EXCEPTION 'Migration requires the existing function owner' USING ERRCODE='42501';
  END IF;
  FOREACH object_name IN ARRAY ARRAY['users','projects','project_memberships','app_sessions','oauth_transactions'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='travel_map' AND c.relname=object_name AND c.relowner=owner_id
      AND c.relrowsecurity AND c.relforcerowsecurity
      AND EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid=c.oid AND p.polroles=ARRAY[owner_id]
        AND pg_get_expr(p.polqual,p.polrelid)='true' AND pg_get_expr(p.polwithcheck,p.polrelid)='true')
      AND NOT EXISTS (SELECT 1 FROM aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a
        WHERE a.grantee<>owner_id)) THEN
      RAISE EXCEPTION 'Unexpected E1 table ownership, RLS or ACL' USING ERRCODE='42501';
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_namespace n, LATERAL aclexplode(COALESCE(n.nspacl,acldefault('n',n.nspowner))) a
    WHERE n.nspname='travel_map' AND a.grantee=0) THEN
    RAISE EXCEPTION 'Private schema must not grant PUBLIC access' USING ERRCODE='42501';
  END IF;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='travel_map' AND p.proname IN ('api_call','oauth_begin','oauth_consume','login_complete')
      AND p.proowner=owner_id AND p.prosecdef AND p.proconfig @> ARRAY['search_path=pg_catalog','TimeZone=UTC'])<>4 THEN
    RAISE EXCEPTION 'Unexpected E1 RPC ownership or security settings' USING ERRCODE='42501';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace,
    LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
    LEFT JOIN pg_roles r ON r.oid=a.grantee
    WHERE n.nspname='travel_map' AND p.proname IN ('api_call','oauth_begin','oauth_consume','login_complete')
      AND a.grantee<>owner_id AND (a.grantee=0 OR r.rolsuper OR r.rolbypassrls OR r.rolcreatedb
        OR r.rolcreaterole OR r.rolreplication OR r.rolinherit OR pg_has_role(r.oid,owner_id,'MEMBER'))) THEN
    RAISE EXCEPTION 'Unexpected runtime RPC privileges' USING ERRCODE='42501';
  END IF;
END;
$preflight$;

CREATE TABLE travel_map.trips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES travel_map.projects(id) ON DELETE RESTRICT,
  created_by_user_id uuid NOT NULL REFERENCES travel_map.users(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 200 AND name !~ '[[:cntrl:]]'),
  description text CHECK (char_length(description)<=2000),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived','deletion_requested','deleted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  deleted_at timestamptz,
  CHECK ((status='deleted')=(deleted_at IS NOT NULL)),
  CHECK (status<>'archived' OR archived_at IS NOT NULL),
  CHECK (archived_at IS NULL OR archived_at>=created_at),
  CHECK (deleted_at IS NULL OR deleted_at>=created_at)
);
CREATE INDEX trips_project_page_idx ON travel_map.trips(project_id,created_at,id);
CREATE INDEX trips_creator_idx ON travel_map.trips(created_by_user_id);
CREATE TRIGGER trips_touch BEFORE UPDATE ON travel_map.trips
  FOR EACH ROW EXECUTE FUNCTION travel_map.touch_updated_at();

CREATE TABLE travel_map.trip_memberships (
  trip_id uuid NOT NULL REFERENCES travel_map.trips(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES travel_map.users(id) ON DELETE RESTRICT,
  role text NOT NULL DEFAULT 'guest' CHECK (role='guest'),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  PRIMARY KEY (trip_id,user_id),
  CHECK ((status='revoked')=(revoked_at IS NOT NULL)),
  CHECK (revoked_at IS NULL OR revoked_at>=created_at)
);
CREATE INDEX trip_memberships_user_active_idx ON travel_map.trip_memberships(user_id,trip_id) WHERE status='active';
CREATE TRIGGER trip_memberships_touch BEFORE UPDATE ON travel_map.trip_memberships
  FOR EACH ROW EXECUTE FUNCTION travel_map.touch_updated_at();

ALTER TABLE travel_map.trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE travel_map.trips FORCE ROW LEVEL SECURITY;
ALTER TABLE travel_map.trip_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE travel_map.trip_memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY trips_owner ON travel_map.trips TO CURRENT_USER USING (true) WITH CHECK (true);
CREATE POLICY trip_memberships_owner ON travel_map.trip_memberships TO CURRENT_USER USING (true) WITH CHECK (true);
REVOKE ALL ON travel_map.trips,travel_map.trip_memberships FROM PUBLIC;

CREATE FUNCTION travel_map.trip_dto(value travel_map.trips) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog SET timezone='UTC' AS $$
  SELECT jsonb_build_object('id',value.id,'projectId',value.project_id,
    'createdByUserId',value.created_by_user_id,'name',value.name,'description',value.description,
    'status',value.status,'createdAt',value.created_at,'updatedAt',value.updated_at);
$$;
REVOKE ALL ON FUNCTION travel_map.trip_dto(travel_map.trips) FROM PUBLIC;

-- Private handler: actor is supplied ONLY by the authenticated dispatcher.
CREATE FUNCTION travel_map.trips_action(p_actor uuid,p_action text,p_data jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE parent travel_map.projects; item travel_map.trips;
  parent_id uuid; v_trip_id uuid; effective_role text; guest boolean:=false;
  allowed_keys text[]; page_limit integer:=25; cursor_time timestamptz; cursor_id uuid;
  new_name text; new_description text; items jsonb;
BEGIN
  IF p_data IS NULL OR jsonb_typeof(p_data)<>'object' THEN
    RETURN jsonb_build_object('error','VALIDATION_ERROR');
  END IF;
  CASE p_action
    WHEN 'trips.list' THEN allowed_keys:=ARRAY['projectId','limit','cursorTime','cursorId'];
    WHEN 'trips.create' THEN allowed_keys:=ARRAY['projectId','name','description'];
    WHEN 'trips.get' THEN allowed_keys:=ARRAY['id'];
    WHEN 'trips.update' THEN allowed_keys:=ARRAY['id','name','description'];
    ELSE RETURN jsonb_build_object('error','RESOURCE_NOT_FOUND');
  END CASE;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_data) AS keys(key) WHERE key<>ALL(allowed_keys)) THEN
    RETURN jsonb_build_object('error','VALIDATION_ERROR');
  END IF;
  IF p_action IN ('trips.list','trips.create') THEN
    IF jsonb_typeof(p_data->'projectId') IS DISTINCT FROM 'string'
      OR (p_data->>'projectId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RETURN jsonb_build_object('error','VALIDATION_ERROR');
    END IF;
    parent_id:=(p_data->>'projectId')::uuid;
  ELSE
    IF jsonb_typeof(p_data->'id') IS DISTINCT FROM 'string'
      OR (p_data->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RETURN jsonb_build_object('error','VALIDATION_ERROR');
    END IF;
    v_trip_id:=(p_data->>'id')::uuid;
    -- Ancestry discovery is not authorization and does not release any data.
    SELECT project_id INTO parent_id FROM travel_map.trips WHERE id=v_trip_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('error','RESOURCE_NOT_FOUND'); END IF;
  END IF;

  -- Lock order: dispatcher session/account, then parent, trip, membership.
  SELECT * INTO parent FROM travel_map.projects WHERE id=parent_id AND status='active' FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','RESOURCE_NOT_FOUND'); END IF;
  IF v_trip_id IS NOT NULL THEN
    IF p_action='trips.update' THEN
      SELECT * INTO item FROM travel_map.trips WHERE id=v_trip_id AND project_id=parent_id AND status='active' FOR UPDATE;
    ELSE
      SELECT * INTO item FROM travel_map.trips WHERE id=v_trip_id AND project_id=parent_id AND status='active' FOR SHARE;
    END IF;
    IF NOT FOUND THEN RETURN jsonb_build_object('error','RESOURCE_NOT_FOUND'); END IF;
  END IF;
  IF parent.owner_user_id=p_actor THEN effective_role:='owner';
  ELSE
    SELECT role INTO effective_role FROM travel_map.project_memberships
      WHERE project_id=parent_id AND user_id=p_actor AND status='active' FOR SHARE;
  END IF;
  IF effective_role IS NULL AND v_trip_id IS NOT NULL THEN
    PERFORM 1 FROM travel_map.trip_memberships WHERE trip_memberships.trip_id=v_trip_id
      AND user_id=p_actor AND status='active' FOR SHARE;
    guest:=FOUND;
  END IF;
  IF effective_role IS NULL AND NOT guest THEN RETURN jsonb_build_object('error','RESOURCE_NOT_FOUND'); END IF;
  IF p_action='trips.get' THEN RETURN travel_map.trip_dto(item); END IF;
  IF p_action='trips.update' AND effective_role IS DISTINCT FROM 'owner' AND effective_role IS DISTINCT FROM 'admin' THEN
    RETURN jsonb_build_object('error','ACTION_FORBIDDEN');
  END IF;
  IF p_action='trips.create' AND effective_role='member' AND parent.trip_creation_policy<>'all_project_members' THEN
    RETURN jsonb_build_object('error','ACTION_FORBIDDEN');
  END IF;

  IF p_action IN ('trips.create','trips.update') THEN
    IF (p_action='trips.create' OR p_data?'name') AND
      (jsonb_typeof(p_data->'name') IS DISTINCT FROM 'string' OR char_length(btrim(p_data->>'name')) NOT BETWEEN 1 AND 200
        OR (p_data->>'name') ~ '[[:cntrl:]]') THEN
      RETURN jsonb_build_object('error','VALIDATION_ERROR');
    END IF;
    IF p_data?'description' AND (jsonb_typeof(p_data->'description') NOT IN ('string','null')
      OR char_length(p_data->>'description')>2000) THEN
      RETURN jsonb_build_object('error','VALIDATION_ERROR');
    END IF;
    IF p_action='trips.update' AND NOT (p_data?'name' OR p_data?'description') THEN
      RETURN jsonb_build_object('error','VALIDATION_ERROR');
    END IF;
    IF p_action='trips.create' THEN
      INSERT INTO travel_map.trips(project_id,created_by_user_id,name,description)
        VALUES(parent_id,p_actor,btrim(p_data->>'name'),p_data->>'description') RETURNING * INTO item;
    ELSE
      new_name:=CASE WHEN p_data?'name' THEN btrim(p_data->>'name') ELSE item.name END;
      new_description:=CASE WHEN p_data?'description' THEN p_data->>'description' ELSE item.description END;
      UPDATE travel_map.trips SET name=new_name,description=new_description WHERE id=v_trip_id RETURNING * INTO item;
    END IF;
    RETURN travel_map.trip_dto(item);
  END IF;

  IF p_data?'limit' THEN
    IF jsonb_typeof(p_data->'limit') IS DISTINCT FROM 'number' OR (p_data->>'limit') !~ '^[0-9]{1,3}$' THEN
      RETURN jsonb_build_object('error','VALIDATION_ERROR');
    END IF;
    page_limit:=(p_data->>'limit')::integer;
    IF page_limit NOT BETWEEN 1 AND 100 THEN RETURN jsonb_build_object('error','VALIDATION_ERROR'); END IF;
  END IF;
  IF (p_data?'cursorTime')<>(p_data?'cursorId') THEN RETURN jsonb_build_object('error','VALIDATION_ERROR'); END IF;
  IF p_data?'cursorTime' THEN
    IF jsonb_typeof(p_data->'cursorTime') IS DISTINCT FROM 'string' OR jsonb_typeof(p_data->'cursorId') IS DISTINCT FROM 'string'
      OR (p_data->>'cursorTime') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?(Z|[+]00:00)$'
      OR (p_data->>'cursorId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RETURN jsonb_build_object('error','VALIDATION_ERROR');
    END IF;
    cursor_time:=(p_data->>'cursorTime')::timestamptz; cursor_id:=(p_data->>'cursorId')::uuid;
  END IF;
  SELECT COALESCE(jsonb_agg(dto ORDER BY created_at,id),'[]'::jsonb) INTO items FROM (
    SELECT t.id,t.created_at,travel_map.trip_dto(t) AS dto FROM travel_map.trips t
      WHERE t.project_id=parent_id AND t.status='active'
        AND (cursor_time IS NULL OR (t.created_at,t.id)>(cursor_time,cursor_id))
      ORDER BY t.created_at,t.id LIMIT page_limit+1
  ) visible;
  RETURN jsonb_build_object('items',items);
EXCEPTION
  WHEN invalid_text_representation OR datetime_field_overflow OR invalid_datetime_format OR check_violation OR not_null_violation THEN
    RETURN jsonb_build_object('error','VALIDATION_ERROR');
  WHEN unique_violation OR serialization_failure OR deadlock_detected OR lock_not_available THEN
    RETURN jsonb_build_object('error','OPERATION_CONFLICT');
END;
$$;
REVOKE ALL ON FUNCTION travel_map.trips_action(uuid,text,jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION travel_map.api_call(p_token text, p_action text, p_data jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog SET timezone = 'UTC' AS $$
DECLARE session travel_map.app_sessions; account travel_map.users;
  project travel_map.projects; result jsonb; stamp timestamptz := clock_timestamp();
BEGIN
  -- Serialize with logout, and never cache an allow decision across requests.
  SELECT * INTO session FROM travel_map.app_sessions WHERE token_digest=p_token FOR UPDATE;
  IF NOT FOUND OR session.revoked_at IS NOT NULL
    THEN RETURN jsonb_build_object('error','SESSION_REQUIRED'); END IF;
  SELECT * INTO account FROM travel_map.users WHERE id=session.user_id FOR SHARE;
  stamp := clock_timestamp();
  IF NOT FOUND OR account.status <> 'active' OR session.expires_at <= stamp OR session.idle_expires_at <= stamp
    THEN RETURN jsonb_build_object('error','SESSION_REQUIRED'); END IF;
  IF p_action='logout' THEN
    UPDATE travel_map.app_sessions SET revoked_at=stamp WHERE id=session.id;
    RETURN '{}'::jsonb;
  END IF;
  UPDATE travel_map.app_sessions SET last_seen_at=stamp,
    idle_expires_at=LEAST(expires_at,stamp+interval '30 minutes') WHERE id=session.id;
  IF p_action='me' THEN
    RETURN jsonb_build_object('id',account.id,'displayName',account.display_name,'email',account.email,
      'storage',jsonb_build_object('usedBytes',0,'reservedBytes',0,'quotaBytes',500000000));
  ELSIF p_action IN ('trips.list','trips.create','trips.get','trips.update') THEN
    RETURN travel_map.trips_action(account.id,p_action,p_data);
  ELSIF p_action='projects.create' THEN
    INSERT INTO travel_map.projects(owner_user_id,name,trip_creation_policy)
      VALUES(account.id,p_data->>'name',p_data->>'tripCreationPolicy') RETURNING * INTO project;
    RETURN jsonb_build_object('id',project.id,'ownerUserId',project.owner_user_id,'name',project.name,
      'tripCreationPolicy',project.trip_creation_policy,'status',project.status,'createdAt',project.created_at);
  ELSIF p_action IN ('projects.list','projects.get') THEN
    -- Shared locks make removal serialize with already-authorized operations.
    PERFORM 1 FROM travel_map.project_memberships WHERE user_id=account.id AND status='active' FOR SHARE;
    SELECT jsonb_agg(item ORDER BY created_at,id) INTO result FROM (
      SELECT p.created_at,p.id,jsonb_build_object('id',p.id,'ownerUserId',p.owner_user_id,'name',p.name,
        'tripCreationPolicy',p.trip_creation_policy,'status',p.status,'createdAt',p.created_at) AS item
      FROM travel_map.projects p WHERE p.status='active'
      AND (p.owner_user_id=account.id OR EXISTS (SELECT 1 FROM travel_map.project_memberships m
        WHERE m.project_id=p.id AND m.user_id=account.id AND m.status='active'))
      AND (p_action <> 'projects.get' OR p.id=(p_data->>'id')::uuid)
      AND (p_data->>'cursorTime' IS NULL OR (p.created_at,p.id)>
        ((p_data->>'cursorTime')::timestamptz,(p_data->>'cursorId')::uuid))
      ORDER BY p.created_at,p.id LIMIT LEAST(COALESCE((p_data->>'limit')::integer,25),100)+1
    ) visible;
    IF p_action='projects.get' THEN
      RETURN COALESCE(result->0,jsonb_build_object('error','RESOURCE_NOT_FOUND'));
    END IF;
    RETURN jsonb_build_object('items',COALESCE(result,'[]'::jsonb));
  END IF;
  RETURN jsonb_build_object('error','RESOURCE_NOT_FOUND');
END;
$$;

-- Fail atomically if operator default privileges would expose newly created
-- tables or private helpers. Do not silently rewrite unrelated role grants.
DO $acl_check$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace,
      LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a
    WHERE n.nspname='travel_map' AND c.relname IN ('trips','trip_memberships') AND a.grantee<>c.relowner)
    OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace,
      LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
    WHERE n.nspname='travel_map' AND p.proname IN ('trips_action','trip_dto') AND a.grantee<>p.proowner) THEN
    RAISE EXCEPTION 'Default privileges expose private E2.1 objects' USING ERRCODE='42501';
  END IF;
END;
$acl_check$;
