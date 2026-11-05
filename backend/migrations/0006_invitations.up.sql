-- E2.4 only. Existing migrations immutable.
-- Must run as the existing function owner, including when an operator uses SET ROLE.
-- No role membership or privilege is granted to repair a failing preflight.
DO $preflight$
DECLARE owner_id oid; object_name text;
BEGIN
  SELECT proowner INTO owner_id FROM pg_proc WHERE oid='travel_map.api_call(text,text,jsonb)'::regprocedure;
  IF owner_id IS DISTINCT FROM (SELECT oid FROM pg_roles WHERE rolname=current_user) THEN
    RAISE EXCEPTION 'Migration requires the existing function owner' USING ERRCODE='42501';
  END IF;
  FOREACH object_name IN ARRAY ARRAY['users','projects','project_memberships','app_sessions','oauth_transactions','trips','trip_memberships','country_codes','places','visits','domain_audit_events'] LOOP
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
  WHERE n.nspname='travel_map' AND p.proname IN ('trips_action','trip_dto','geography_action','place_dto','visit_dto','valid_calendar','valid_visit_date','collaboration_action','audit_append_only') AND
   (a.grantee<>p.proowner OR p.proowner<>(SELECT oid FROM pg_roles WHERE rolname=current_user)
    OR p.prosecdef OR (p.proconfig @> ARRAY['search_path=pg_catalog','TimeZone=UTC']) IS DISTINCT FROM true)) THEN
  RAISE EXCEPTION 'Unexpected private E2.1 helper security' USING ERRCODE='42501'; END IF;
END;
$helper_preflight$;
CREATE TABLE travel_map.invitations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 project_id uuid REFERENCES travel_map.projects(id) ON DELETE RESTRICT,
 trip_id uuid REFERENCES travel_map.trips(id) ON DELETE RESTRICT,
 token_digest text NOT NULL UNIQUE CHECK(token_digest ~ '^[a-f0-9]{64}$'),
 issuer_id uuid NOT NULL REFERENCES travel_map.users(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '7 days',
 redeemed_by uuid REFERENCES travel_map.users(id) ON DELETE RESTRICT,
 redeemed_at timestamptz,
 revoked_by uuid REFERENCES travel_map.users(id) ON DELETE RESTRICT,
 revoked_at timestamptz,
 CHECK(num_nonnulls(project_id,trip_id)=1),
 CHECK((redeemed_at IS NULL)=(redeemed_by IS NULL)),
 CHECK((revoked_at IS NULL)=(revoked_by IS NULL)),
 CHECK(redeemed_at IS NULL OR revoked_at IS NULL),
 CHECK(expires_at>created_at),
 CHECK(redeemed_at IS NULL OR redeemed_at>=created_at),
 CHECK(revoked_at IS NULL OR revoked_at>=created_at)
);
CREATE INDEX invitations_project_page ON travel_map.invitations(project_id,created_at,id);
CREATE INDEX invitations_trip_page ON travel_map.invitations(trip_id,created_at,id);
-- One bounded counter per account, not a log of secrets/attempt bodies.
CREATE TABLE travel_map.invitation_attempts (
 user_id uuid PRIMARY KEY REFERENCES travel_map.users(id) ON DELETE RESTRICT,
 window_at timestamptz NOT NULL,
 attempts integer NOT NULL CHECK(attempts BETWEEN 1 AND 31)
);
ALTER TABLE travel_map.invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE travel_map.invitations FORCE ROW LEVEL SECURITY;
ALTER TABLE travel_map.invitation_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE travel_map.invitation_attempts FORCE ROW LEVEL SECURITY;
CREATE POLICY invitations_owner ON travel_map.invitations TO CURRENT_USER USING(true) WITH CHECK(true);
CREATE POLICY invitation_attempts_owner ON travel_map.invitation_attempts TO CURRENT_USER USING(true) WITH CHECK(true);
REVOKE ALL ON travel_map.invitations,travel_map.invitation_attempts FROM PUBLIC;
ALTER TABLE travel_map.domain_audit_events DROP CONSTRAINT domain_audit_events_action_check, DROP CONSTRAINT domain_audit_events_check;
ALTER TABLE travel_map.domain_audit_events ADD CONSTRAINT domain_audit_events_action_check CHECK(action IN ('member_promoted','admin_demoted','member_removed','project_left','guest_removed','trip_left','project_settings_changed','project_archived','invitation_issued','invitation_revoked','invitation_redeemed'));
ALTER TABLE travel_map.domain_audit_events ADD CONSTRAINT domain_audit_events_check CHECK(action LIKE 'invitation_%' OR (resource_type='trip')=(action IN ('guest_removed','trip_left')));
CREATE FUNCTION travel_map.invitation_dto(v travel_map.invitations) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog SET timezone='UTC' AS $$
 SELECT jsonb_build_object('id',v.id,'scopeType',CASE WHEN v.trip_id IS NULL THEN 'project' ELSE 'trip' END,
 'scopeId',COALESCE(v.trip_id,v.project_id),'createdAt',v.created_at,'expiresAt',v.expires_at,
 'status',CASE WHEN v.redeemed_at IS NOT NULL THEN 'consumed' WHEN v.revoked_at IS NOT NULL THEN 'revoked'
 WHEN v.expires_at<=clock_timestamp() THEN 'expired' ELSE 'pending' END);
$$;
CREATE FUNCTION travel_map.invitations_action(p_actor uuid,p_action text,p_data jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE parent travel_map.projects; inv travel_map.invitations; parent_id uuid; child_id uuid; effective text;
 allowed text[]; stamp timestamptz; existing boolean:=false; items jsonb; n integer;
BEGIN
 CASE p_action
 WHEN 'invitations.create' THEN allowed:=ARRAY['projectId','tripId','tokenDigest'];
 WHEN 'invitations.list' THEN allowed:=ARRAY['projectId','tripId','limit','cursorTime','cursorId'];
 WHEN 'invitations.revoke' THEN allowed:=ARRAY['projectId','tripId','id'];
 WHEN 'invitations.redeem' THEN allowed:=ARRAY['tokenDigest'];
 ELSE RETURN jsonb_build_object('error','RESOURCE_NOT_FOUND'); END CASE;
 IF p_data IS NULL OR jsonb_typeof(p_data)<>'object' THEN RETURN jsonb_build_object('error','VALIDATION_ERROR'); END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_data) k WHERE k<>ALL(allowed)) THEN RETURN jsonb_build_object('error','VALIDATION_ERROR'); END IF;
 IF p_action IN ('invitations.create','invitations.redeem') AND (jsonb_typeof(p_data->'tokenDigest') IS DISTINCT FROM 'string' OR p_data->>'tokenDigest' !~ '^[a-f0-9]{64}$') THEN RETURN jsonb_build_object('error','VALIDATION_ERROR'); END IF;
 IF p_action='invitations.redeem' THEN
  INSERT INTO travel_map.invitation_attempts(user_id,window_at,attempts) VALUES(p_actor,clock_timestamp(),1)
  ON CONFLICT(user_id) DO UPDATE SET attempts=CASE WHEN invitation_attempts.window_at<clock_timestamp()-interval '1 minute' THEN 1 ELSE LEAST(invitation_attempts.attempts+1,31) END,
  window_at=CASE WHEN invitation_attempts.window_at<clock_timestamp()-interval '1 minute' THEN clock_timestamp() ELSE invitation_attempts.window_at END RETURNING attempts INTO n;
  IF n>30 THEN RETURN jsonb_build_object('error','RATE_LIMITED'); END IF;
  SELECT * INTO inv FROM travel_map.invitations WHERE token_digest=p_data->>'tokenDigest';
  IF NOT FOUND THEN RETURN jsonb_build_object('error','INVITATION_INVALID'); END IF;
  child_id:=inv.trip_id; parent_id:=inv.project_id;
 ELSE
  IF (p_data ? 'projectId')=(p_data ? 'tripId') THEN RETURN jsonb_build_object('error','VALIDATION_ERROR'); END IF;
  IF p_data ? 'tripId' THEN child_id:=(p_data->>'tripId')::uuid; ELSE parent_id:=(p_data->>'projectId')::uuid; END IF;
 END IF;
 IF child_id IS NOT NULL THEN SELECT project_id INTO parent_id FROM travel_map.trips WHERE id=child_id; END IF;
 SELECT * INTO parent FROM travel_map.projects WHERE id=parent_id AND status='active' FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('error',CASE WHEN p_action='invitations.redeem' THEN 'INVITATION_INVALID' ELSE 'RESOURCE_NOT_FOUND' END); END IF;
 IF child_id IS NOT NULL THEN
  PERFORM 1 FROM travel_map.trips WHERE id=child_id AND project_id=parent_id AND status='active' FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error',CASE WHEN p_action='invitations.redeem' THEN 'INVITATION_INVALID' ELSE 'RESOURCE_NOT_FOUND' END); END IF;
 END IF;
 IF parent.owner_user_id=p_actor THEN effective:='owner'; ELSE SELECT role INTO effective FROM travel_map.project_memberships WHERE project_id=parent_id AND user_id=p_actor AND status='active'; END IF;
 IF p_action<>'invitations.redeem' THEN
  IF effective IS NULL THEN RETURN jsonb_build_object('error','RESOURCE_NOT_FOUND'); END IF;
  IF effective NOT IN ('owner','admin') THEN RETURN jsonb_build_object('error','ACTION_FORBIDDEN'); END IF;
 END IF;
 stamp:=clock_timestamp();
 IF p_action='invitations.create' THEN
  INSERT INTO travel_map.invitations(project_id,trip_id,token_digest,issuer_id,created_at,expires_at)
  VALUES(CASE WHEN child_id IS NULL THEN parent_id END,child_id,p_data->>'tokenDigest',p_actor,stamp,stamp+interval '7 days') RETURNING * INTO inv;
 ELSIF p_action='invitations.list' THEN
  n:=COALESCE((p_data->>'limit')::integer,25);
  IF n NOT BETWEEN 1 AND 100 OR (p_data ? 'cursorTime')<>(p_data ? 'cursorId') THEN RETURN jsonb_build_object('error','VALIDATION_ERROR'); END IF;
  SELECT COALESCE(jsonb_agg(item ORDER BY created_at,id),'[]') INTO items FROM (
   SELECT i.id,i.created_at,travel_map.invitation_dto(i) item FROM travel_map.invitations i
   WHERE ((child_id IS NOT NULL AND i.trip_id=child_id) OR (child_id IS NULL AND (i.project_id=parent_id OR i.trip_id IN (SELECT id FROM travel_map.trips WHERE project_id=parent_id))))
   AND i.redeemed_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>stamp
   AND (p_data->>'cursorTime' IS NULL OR (i.created_at,i.id)>((p_data->>'cursorTime')::timestamptz,(p_data->>'cursorId')::uuid))
   ORDER BY i.created_at,i.id LIMIT n+1) page;
  RETURN jsonb_build_object('items',items);
 ELSE
  IF p_action='invitations.redeem' THEN SELECT * INTO inv FROM travel_map.invitations WHERE id=inv.id FOR UPDATE;
  ELSE SELECT * INTO inv FROM travel_map.invitations WHERE id=(p_data->>'id')::uuid AND
   ((child_id IS NOT NULL AND trip_id=child_id) OR (child_id IS NULL AND (project_id=parent_id OR trip_id IN(SELECT id FROM travel_map.trips WHERE project_id=parent_id)))) FOR UPDATE; END IF;
  IF NOT FOUND THEN RETURN jsonb_build_object('error',CASE WHEN p_action='invitations.redeem' THEN 'INVITATION_INVALID' ELSE 'RESOURCE_NOT_FOUND' END); END IF;
  IF inv.redeemed_at IS NOT NULL OR inv.revoked_at IS NOT NULL OR inv.expires_at<=clock_timestamp() THEN RETURN jsonb_build_object('error',CASE WHEN p_action='invitations.redeem' THEN 'INVITATION_INVALID' ELSE 'OPERATION_CONFLICT' END); END IF;
  IF p_action='invitations.revoke' THEN UPDATE travel_map.invitations SET revoked_by=p_actor,revoked_at=clock_timestamp() WHERE id=inv.id;
  ELSE
   -- Conservative gate: an invitation cannot outlive the issuer's authority.
   IF NOT EXISTS(SELECT 1 FROM travel_map.users WHERE id=inv.issuer_id AND status='active') OR
    (inv.issuer_id<>parent.owner_user_id AND NOT EXISTS(SELECT 1 FROM travel_map.project_memberships WHERE project_id=parent_id AND user_id=inv.issuer_id AND role='admin' AND status='active')) THEN RETURN jsonb_build_object('error','INVITATION_INVALID'); END IF;
   existing:=effective IS NOT NULL;
   IF child_id IS NOT NULL THEN
    existing:=existing OR EXISTS(SELECT 1 FROM travel_map.trip_memberships WHERE trip_id=child_id AND user_id=p_actor AND status='active');
    IF NOT existing THEN INSERT INTO travel_map.trip_memberships(trip_id,user_id) VALUES(child_id,p_actor)
     ON CONFLICT(trip_id,user_id) DO UPDATE SET role='guest',status='active',revoked_at=NULL; END IF;
   ELSE
    IF NOT existing THEN INSERT INTO travel_map.project_memberships(project_id,user_id,role) VALUES(parent_id,p_actor,'member')
     ON CONFLICT(project_id,user_id) DO UPDATE SET role='member',status='active',revoked_at=NULL; END IF;
   END IF;
   UPDATE travel_map.invitations SET redeemed_by=p_actor,redeemed_at=clock_timestamp() WHERE id=inv.id;
  END IF;
 END IF;
 INSERT INTO travel_map.domain_audit_events(actor_id,resource_id,resource_type,action,metadata)
 VALUES(p_actor,COALESCE(child_id,parent_id),CASE WHEN child_id IS NULL THEN 'project' ELSE 'trip' END,
 CASE p_action WHEN 'invitations.create' THEN 'invitation_issued' WHEN 'invitations.revoke' THEN 'invitation_revoked' ELSE 'invitation_redeemed' END,'{}');
 IF p_action='invitations.redeem' THEN RETURN jsonb_build_object('scopeType',CASE WHEN child_id IS NULL THEN 'project' ELSE 'trip' END,'scopeId',COALESCE(child_id,parent_id),'result',CASE WHEN existing THEN 'already_has_access' ELSE 'access_granted' END); END IF;
 RETURN travel_map.invitation_dto(inv);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR datetime_field_overflow THEN RETURN jsonb_build_object('error','VALIDATION_ERROR');
 WHEN unique_violation OR serialization_failure OR deadlock_detected OR lock_not_available THEN RETURN jsonb_build_object('error','OPERATION_CONFLICT');
END;
$$;
REVOKE ALL ON FUNCTION travel_map.invitation_dto(travel_map.invitations),travel_map.invitations_action(uuid,text,jsonb) FROM PUBLIC;
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
  ELSIF p_action IN ('invitations.create','invitations.list','invitations.revoke','invitations.redeem') THEN
    RETURN travel_map.invitations_action(account.id,p_action,p_data);
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
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace,LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a WHERE n.nspname='travel_map' AND c.relname IN ('invitations','invitation_attempts') AND a.grantee<>c.relowner)
 OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace,LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a WHERE n.nspname='travel_map' AND p.proname IN ('invitation_dto','invitations_action') AND a.grantee<>p.proowner) THEN RAISE EXCEPTION 'Private ACL required' USING ERRCODE='42501'; END IF;
END $$;
