-- E2.3: approved membership lifecycle/settings/archive only.
-- Must run as the existing function owner, including when an operator uses SET ROLE.
-- No role membership or privilege is granted to repair a failing preflight.
DO $preflight$
DECLARE owner_id oid; object_name text;
BEGIN
  SELECT proowner INTO owner_id FROM pg_proc WHERE oid='travel_map.api_call(text,text,jsonb)'::regprocedure;
  IF owner_id IS DISTINCT FROM (SELECT oid FROM pg_roles WHERE rolname=current_user) THEN
    RAISE EXCEPTION 'Migration requires the existing function owner' USING ERRCODE='42501';
  END IF;
  FOREACH object_name IN ARRAY ARRAY['users','projects','project_memberships','app_sessions','oauth_transactions','trips','trip_memberships','country_codes','places','visits'] LOOP
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
 OR to_regprocedure('travel_map.geography_action(uuid,text,jsonb)') IS NULL
 OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace,
  LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
  WHERE n.nspname='travel_map' AND p.proname IN ('trips_action','trip_dto','geography_action','place_dto','visit_dto','valid_calendar','valid_visit_date') AND
   (a.grantee<>p.proowner OR p.proowner<>(SELECT oid FROM pg_roles WHERE rolname=current_user)
    OR p.prosecdef OR (p.proconfig @> ARRAY['search_path=pg_catalog','TimeZone=UTC']) IS DISTINCT FROM true)) THEN
  RAISE EXCEPTION 'Unexpected private E2.1 helper security' USING ERRCODE='42501'; END IF;
END;
$helper_preflight$;
CREATE TABLE travel_map.domain_audit_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 actor_id uuid NOT NULL REFERENCES travel_map.users(id) ON DELETE RESTRICT,
 resource_id uuid NOT NULL,
 resource_type text NOT NULL CHECK(resource_type IN ('project','trip')),
 action text NOT NULL CHECK(action IN ('member_promoted','admin_demoted','member_removed','project_left',
   'guest_removed','trip_left','project_settings_changed','project_archived')),
 occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 metadata jsonb NOT NULL CHECK(jsonb_typeof(metadata)='object'),
 CHECK ((resource_type='trip')=(action IN ('guest_removed','trip_left'))),
 -- Only server-built transition metadata; never names, request bodies or secrets.
 CHECK (metadata - ARRAY['targetUserId','previousRole','newRole','revokedTripGrants','nameChanged',
   'previousPolicy','newPolicy','previousStatus','newStatus'] = '{}'::jsonb)
);
CREATE INDEX domain_audit_resource_idx ON travel_map.domain_audit_events(resource_type,resource_id,occurred_at,id);
CREATE INDEX domain_audit_actor_idx ON travel_map.domain_audit_events(actor_id);
ALTER TABLE travel_map.domain_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE travel_map.domain_audit_events FORCE ROW LEVEL SECURITY;
CREATE POLICY domain_audit_owner ON travel_map.domain_audit_events TO CURRENT_USER USING(true) WITH CHECK(true);
REVOKE ALL ON travel_map.domain_audit_events FROM PUBLIC;
CREATE FUNCTION travel_map.audit_append_only() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog SET timezone='UTC' AS $$
BEGIN RAISE EXCEPTION 'Audit events are append only' USING ERRCODE='42501'; END;
$$;
CREATE TRIGGER audit_no_rewrite BEFORE UPDATE OR DELETE ON travel_map.domain_audit_events
 FOR EACH STATEMENT EXECUTE FUNCTION travel_map.audit_append_only();
CREATE TRIGGER audit_no_truncate BEFORE TRUNCATE ON travel_map.domain_audit_events
 FOR EACH STATEMENT EXECUTE FUNCTION travel_map.audit_append_only();
REVOKE ALL ON FUNCTION travel_map.audit_append_only() FROM PUBLIC;

-- Actor comes exclusively from api_call. Private SECURITY INVOKER helper, no runtime grant.
CREATE FUNCTION travel_map.collaboration_action(p_actor uuid,p_action text,p_data jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE parent travel_map.projects; child travel_map.trips; target travel_map.project_memberships;
 parent_id uuid; trip_id_value uuid; target_id uuid; role_value text; allowed text[];
 page_limit integer:=25; cursor_time timestamptz; cursor_id uuid; items jsonb;
 event_action text; event_metadata jsonb:='{}'; stamp timestamptz;
 revoked_count integer:=0; new_name text; new_policy text; new_role text; result jsonb:='{}';
BEGIN
 IF p_data IS NULL OR jsonb_typeof(p_data)<>'object' THEN RETURN jsonb_build_object('error','VALIDATION_ERROR'); END IF;
 CASE p_action
 WHEN 'collaboration.members' THEN allowed:=ARRAY['id','limit','cursorTime','cursorId'];
 WHEN 'collaboration.promote','collaboration.demote','collaboration.remove','collaboration.guest_remove' THEN allowed:=ARRAY['id','userId'];
 WHEN 'collaboration.leave','collaboration.guest_leave','collaboration.archive' THEN allowed:=ARRAY['id'];
 WHEN 'collaboration.settings' THEN allowed:=ARRAY['id','name','tripCreationPolicy'];
 ELSE RETURN jsonb_build_object('error','RESOURCE_NOT_FOUND'); END CASE;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_data) k WHERE k<>ALL(allowed))
 OR jsonb_typeof(p_data->'id') IS DISTINCT FROM 'string'
 OR p_data->>'id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 THEN RETURN jsonb_build_object('error','VALIDATION_ERROR'); END IF;
 IF 'userId'=ANY(allowed) THEN
  IF jsonb_typeof(p_data->'userId') IS DISTINCT FROM 'string'
   OR p_data->>'userId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   THEN RETURN jsonb_build_object('error','VALIDATION_ERROR'); END IF;
  target_id:=(p_data->>'userId')::uuid;
 ELSE target_id:=p_actor; END IF;
 IF p_action IN ('collaboration.guest_remove','collaboration.guest_leave') THEN
  trip_id_value:=(p_data->>'id')::uuid;
  SELECT project_id INTO parent_id FROM travel_map.trips WHERE id=trip_id_value;
 ELSE parent_id:=(p_data->>'id')::uuid; END IF;
 -- Session/account is already locked. Every management mutation takes the same
 -- exclusive parent lock BEFORE checking roles or touching descendant resources.
 IF p_action='collaboration.members' THEN
  SELECT * INTO parent FROM travel_map.projects WHERE id=parent_id AND status='active' FOR SHARE;
 ELSE
  SELECT * INTO parent FROM travel_map.projects WHERE id=parent_id AND status='active' FOR UPDATE;
 END IF;
 IF NOT FOUND THEN RETURN jsonb_build_object('error','RESOURCE_NOT_FOUND'); END IF;
 IF trip_id_value IS NOT NULL THEN
  SELECT * INTO child FROM travel_map.trips WHERE id=trip_id_value AND project_id=parent_id AND status='active' FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','RESOURCE_NOT_FOUND'); END IF;
 END IF;
 -- Parent lock makes these reads stable versus all authorized membership writers.
 IF parent.owner_user_id=p_actor THEN role_value:='owner';
 ELSE SELECT role INTO role_value FROM travel_map.project_memberships
   WHERE project_id=parent_id AND user_id=p_actor AND status='active'; END IF;
 IF p_action='collaboration.guest_leave' THEN
  IF role_value IS NOT NULL THEN RETURN jsonb_build_object('error','ACTION_FORBIDDEN'); END IF;
  PERFORM 1 FROM travel_map.trip_memberships WHERE trip_id=trip_id_value AND user_id=p_actor AND status='active';
  IF NOT FOUND THEN RETURN jsonb_build_object('error','RESOURCE_NOT_FOUND'); END IF;
 ELSE
  IF role_value IS NULL THEN RETURN jsonb_build_object('error','RESOURCE_NOT_FOUND'); END IF;
  IF p_action='collaboration.leave' THEN
   IF role_value='owner' THEN RETURN jsonb_build_object('error','ACTION_FORBIDDEN'); END IF;
  ELSIF p_action IN ('collaboration.promote','collaboration.demote','collaboration.archive') THEN
   IF role_value<>'owner' THEN RETURN jsonb_build_object('error','ACTION_FORBIDDEN'); END IF;
  ELSIF role_value NOT IN ('owner','admin') THEN RETURN jsonb_build_object('error','ACTION_FORBIDDEN'); END IF;
 END IF;
 IF p_action='collaboration.members' THEN
  IF p_data ? 'limit' THEN
   IF jsonb_typeof(p_data->'limit')<>'number' OR p_data->>'limit' !~ '^[0-9]+$' THEN RETURN jsonb_build_object('error','VALIDATION_ERROR'); END IF;
   page_limit:=(p_data->>'limit')::integer;
  END IF;
  IF page_limit NOT BETWEEN 1 AND 100 OR (p_data ? 'cursorTime')<>(p_data ? 'cursorId') THEN RETURN jsonb_build_object('error','VALIDATION_ERROR'); END IF;
  IF p_data ? 'cursorTime' THEN
   IF jsonb_typeof(p_data->'cursorTime')<>'string' OR jsonb_typeof(p_data->'cursorId')<>'string'
     OR p_data->>'cursorTime' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+(Z|\+00:00)$'
     OR p_data->>'cursorId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN RETURN jsonb_build_object('error','VALIDATION_ERROR'); END IF;
   cursor_time:=(p_data->>'cursorTime')::timestamptz; cursor_id:=(p_data->>'cursorId')::uuid;
  END IF;
  SELECT COALESCE(jsonb_agg(item ORDER BY created_at,user_id),'[]') INTO items FROM (
   SELECT r.created_at,r.user_id,jsonb_build_object('userId',r.user_id,'displayName',u.display_name,
     'role',r.role,'createdAt',r.created_at) item FROM (
     SELECT parent.owner_user_id user_id,'owner'::text role,parent.created_at
     UNION ALL SELECT m.user_id,m.role,m.created_at FROM travel_map.project_memberships m
      WHERE m.project_id=parent_id AND m.status='active') r
   JOIN travel_map.users u ON u.id=r.user_id AND u.status='active'
   WHERE cursor_time IS NULL OR (r.created_at,r.user_id)>(cursor_time,cursor_id)
   ORDER BY r.created_at,r.user_id LIMIT page_limit+1) page;
  RETURN jsonb_build_object('items',items);
 END IF;
 stamp:=clock_timestamp();
 IF p_action='collaboration.settings' THEN
  IF NOT(p_data ? 'name' OR p_data ? 'tripCreationPolicy') THEN RETURN jsonb_build_object('error','VALIDATION_ERROR'); END IF;
  new_name:=parent.name; new_policy:=parent.trip_creation_policy;
  IF p_data ? 'name' THEN
   IF jsonb_typeof(p_data->'name') IS DISTINCT FROM 'string' OR char_length(btrim(p_data->>'name')) NOT BETWEEN 1 AND 200
     OR p_data->>'name' ~ '[[:cntrl:]]' THEN RETURN jsonb_build_object('error','VALIDATION_ERROR'); END IF;
   new_name:=btrim(p_data->>'name');
  END IF;
  IF p_data ? 'tripCreationPolicy' THEN
   IF jsonb_typeof(p_data->'tripCreationPolicy') IS DISTINCT FROM 'string'
    OR p_data->>'tripCreationPolicy' NOT IN ('admins_only','all_project_members') THEN RETURN jsonb_build_object('error','VALIDATION_ERROR'); END IF;
   new_policy:=p_data->>'tripCreationPolicy';
  END IF;
  event_action:='project_settings_changed';
  event_metadata:=jsonb_build_object('nameChanged',new_name<>parent.name,'previousPolicy',parent.trip_creation_policy,'newPolicy',new_policy);
  UPDATE travel_map.projects SET name=new_name,trip_creation_policy=new_policy WHERE id=parent_id RETURNING * INTO parent;
  result:=jsonb_build_object('id',parent.id,'ownerUserId',parent.owner_user_id,'name',parent.name,
    'tripCreationPolicy',parent.trip_creation_policy,'status',parent.status,'createdAt',parent.created_at);
 ELSIF p_action='collaboration.archive' THEN
  UPDATE travel_map.projects SET status='archived',archived_at=stamp WHERE id=parent_id;
  event_action:='project_archived'; event_metadata:=jsonb_build_object('previousStatus','active','newStatus','archived');
 ELSIF p_action IN ('collaboration.guest_remove','collaboration.guest_leave') THEN
  PERFORM 1 FROM travel_map.trip_memberships WHERE trip_id=trip_id_value AND user_id=target_id AND status='active' FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','RESOURCE_NOT_FOUND'); END IF;
  UPDATE travel_map.trip_memberships SET status='revoked',revoked_at=stamp WHERE trip_id=trip_id_value AND user_id=target_id;
  event_action:=CASE WHEN p_action='collaboration.guest_leave' THEN 'trip_left' ELSE 'guest_removed' END;
  event_metadata:=jsonb_build_object('targetUserId',target_id);
 ELSE
  IF target_id=parent.owner_user_id THEN RETURN jsonb_build_object('error','ACTION_FORBIDDEN'); END IF;
  -- Lock descendants in deterministic order before membership rows. Include
  -- inactive Trips so no pre-existing explicit grant can survive Project exit.
  IF p_action IN ('collaboration.remove','collaboration.leave') THEN
   PERFORM id FROM travel_map.trips WHERE project_id=parent_id ORDER BY id FOR UPDATE;
  END IF;
  SELECT * INTO target FROM travel_map.project_memberships WHERE project_id=parent_id AND user_id=target_id AND status='active' FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','RESOURCE_NOT_FOUND'); END IF;
  IF p_action='collaboration.remove' AND role_value='admin' AND target.role<>'member' THEN RETURN jsonb_build_object('error','ACTION_FORBIDDEN'); END IF;
  IF p_action IN ('collaboration.promote','collaboration.demote') THEN
   IF (p_action='collaboration.promote' AND target.role<>'member') OR (p_action='collaboration.demote' AND target.role<>'admin')
    THEN RETURN jsonb_build_object('error','OPERATION_CONFLICT'); END IF;
   new_role:=CASE WHEN p_action='collaboration.promote' THEN 'admin' ELSE 'member' END;
   UPDATE travel_map.project_memberships SET role=new_role WHERE project_id=parent_id AND user_id=target_id;
   event_action:=CASE WHEN p_action='collaboration.promote' THEN 'member_promoted' ELSE 'admin_demoted' END;
   event_metadata:=jsonb_build_object('targetUserId',target_id,'previousRole',target.role,'newRole',new_role);
  ELSE
   PERFORM m.trip_id FROM travel_map.trip_memberships m JOIN travel_map.trips t ON t.id=m.trip_id
    WHERE t.project_id=parent_id AND m.user_id=target_id AND m.status='active' ORDER BY m.trip_id,m.user_id FOR UPDATE OF m;
   UPDATE travel_map.trip_memberships m SET status='revoked',revoked_at=stamp FROM travel_map.trips t
    WHERE m.trip_id=t.id AND t.project_id=parent_id AND m.user_id=target_id AND m.status='active';
   GET DIAGNOSTICS revoked_count=ROW_COUNT;
   UPDATE travel_map.project_memberships SET status='revoked',revoked_at=stamp WHERE project_id=parent_id AND user_id=target_id;
   event_action:=CASE WHEN p_action='collaboration.leave' THEN 'project_left' ELSE 'member_removed' END;
   event_metadata:=jsonb_build_object('targetUserId',target_id,'previousRole',target.role,'revokedTripGrants',revoked_count);
  END IF;
 END IF;
 INSERT INTO travel_map.domain_audit_events(actor_id,resource_id,resource_type,action,metadata)
  VALUES(p_actor,COALESCE(trip_id_value,parent_id),CASE WHEN trip_id_value IS NULL THEN 'project' ELSE 'trip' END,event_action,event_metadata);
 RETURN result;
EXCEPTION
 WHEN invalid_text_representation OR numeric_value_out_of_range OR datetime_field_overflow OR invalid_datetime_format OR check_violation OR not_null_violation
  THEN RETURN jsonb_build_object('error','VALIDATION_ERROR');
 WHEN serialization_failure OR deadlock_detected OR lock_not_available THEN RETURN jsonb_build_object('error','OPERATION_CONFLICT');
END;
$$;
REVOKE ALL ON FUNCTION travel_map.collaboration_action(uuid,text,jsonb) FROM PUBLIC;
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
  ELSIF p_action IN ('collaboration.members','collaboration.promote','collaboration.demote','collaboration.remove',
    'collaboration.leave','collaboration.guest_remove','collaboration.guest_leave','collaboration.settings','collaboration.archive') THEN
    RETURN travel_map.collaboration_action(account.id,p_action,p_data);
  ELSIF p_action IN ('places.list','visits.list','visits.create','visits.get','visits.update','maps.project','maps.trip') THEN
    RETURN travel_map.geography_action(account.id,p_action,p_data);
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
DO $acl_check$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace,
  LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a
  WHERE n.nspname='travel_map' AND c.relname='domain_audit_events' AND a.grantee<>c.relowner)
 OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace,
  LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
  WHERE n.nspname='travel_map' AND p.proname IN ('collaboration_action','audit_append_only') AND a.grantee<>p.proowner)
 THEN RAISE EXCEPTION 'Default privileges expose private E2.3 objects' USING ERRCODE='42501'; END IF;
END; $acl_check$;
