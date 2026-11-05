-- Destructive only to E2.2 data in a disposable test database.
DO $disposable$ BEGIN
 IF current_database() !~ '^travel_map_test_[a-z0-9_]+$' THEN
  RAISE EXCEPTION 'Destructive rollback requires disposable test database' USING ERRCODE='42501'; END IF;
END; $disposable$;
-- Must run as the existing function owner, including when an operator uses SET ROLE.
-- No role membership or privilege is granted to repair a failing preflight.
DO $preflight$
DECLARE owner_id oid; object_name text;
BEGIN
  SELECT proowner INTO owner_id FROM pg_proc WHERE oid='travel_map.api_call(text,text,jsonb)'::regprocedure;
  IF owner_id IS DISTINCT FROM (SELECT oid FROM pg_roles WHERE rolname=current_user) THEN
    RAISE EXCEPTION 'Migration requires the existing function owner' USING ERRCODE='42501';
  END IF;
  FOREACH object_name IN ARRAY ARRAY['users','projects','project_memberships','app_sessions','oauth_transactions','trips','trip_memberships'] LOOP
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

DO $helper_preflight$
BEGIN
 IF to_regprocedure('travel_map.trips_action(uuid,text,jsonb)') IS NULL
 OR to_regprocedure('travel_map.trip_dto(travel_map.trips)') IS NULL
 OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace,
  LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
  WHERE n.nspname='travel_map' AND p.proname IN ('trips_action','trip_dto') AND
   (a.grantee<>p.proowner OR p.proowner<>(SELECT oid FROM pg_roles WHERE rolname=current_user)
    OR p.prosecdef OR (p.proconfig @> ARRAY['search_path=pg_catalog','TimeZone=UTC']) IS DISTINCT FROM true)) THEN
  RAISE EXCEPTION 'Unexpected private E2.1 helper security' USING ERRCODE='42501'; END IF;
END;
$helper_preflight$;
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
DROP FUNCTION travel_map.geography_action(uuid,text,jsonb);
DROP FUNCTION travel_map.valid_visit_date(jsonb);
DROP FUNCTION travel_map.valid_calendar(text);
DROP FUNCTION travel_map.visit_dto(travel_map.visits);
DROP FUNCTION travel_map.place_dto(travel_map.places);
DROP TABLE travel_map.visits;
DROP TABLE travel_map.places;
DROP TABLE travel_map.country_codes;
