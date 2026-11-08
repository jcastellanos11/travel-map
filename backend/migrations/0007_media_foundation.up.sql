-- E4.1 foundations only: no object I/O, HTTP media routes or processor.
DO $preflight$
DECLARE owner_id oid; object_name text;
BEGIN
  SELECT proowner INTO owner_id FROM pg_proc WHERE oid='travel_map.api_call(text,text,jsonb)'::regprocedure;
  IF owner_id IS DISTINCT FROM (SELECT oid FROM pg_roles WHERE rolname=current_user) THEN
    RAISE EXCEPTION 'Migration requires the existing function owner' USING ERRCODE='42501';
  END IF;
  FOREACH object_name IN ARRAY ARRAY['users','projects','project_memberships','app_sessions','oauth_transactions','trips','trip_memberships','country_codes','places','visits','domain_audit_events','invitations','invitation_attempts'] LOOP
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
  WHERE n.nspname='travel_map' AND p.proname IN ('trips_action','trip_dto','geography_action','place_dto','visit_dto','valid_calendar','valid_visit_date','collaboration_action','audit_append_only','invitations_action','invitation_dto') AND
   (a.grantee<>p.proowner OR p.proowner<>(SELECT oid FROM pg_roles WHERE rolname=current_user)
    OR p.prosecdef OR (p.proconfig @> ARRAY['search_path=pg_catalog','TimeZone=UTC']) IS DISTINCT FROM true)) THEN
  RAISE EXCEPTION 'Unexpected private E2.1 helper security' USING ERRCODE='42501'; END IF;
END;
$helper_preflight$;

DO $media_prerequisites$
DECLARE role_id oid;
BEGIN
 SELECT oid INTO role_id FROM pg_roles WHERE rolname='travel_map_media_maintenance'
  AND NOT (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR rolinherit OR rolcanlogin);
 IF role_id IS NULL OR EXISTS(SELECT 1 FROM pg_auth_members WHERE member=role_id OR roleid=role_id)
  OR EXISTS(SELECT 1 FROM pg_database WHERE datdba=role_id)
  OR pg_has_role(role_id,current_user,'MEMBER')
  OR has_schema_privilege(role_id,'travel_map','USAGE')
  OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='travel_map' AND (has_table_privilege(role_id,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')))
  OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='travel_map' AND has_function_privilege(role_id,p.oid,'EXECUTE')) THEN
  RAISE EXCEPTION 'Restricted maintenance group must be preprovisioned without domain privileges' USING ERRCODE='42501';
 END IF;
 -- Existing runtime grants are untouched; reject widened defaults instead of repairing them.
 IF EXISTS(SELECT 1 FROM pg_default_acl d,LATERAL aclexplode(d.defaclacl) a
   WHERE d.defaclrole=(SELECT oid FROM pg_roles WHERE rolname=current_user)
    AND d.defaclnamespace IN (0,'travel_map'::regnamespace) AND a.grantee<>d.defaclrole) THEN
  RAISE EXCEPTION 'Unexpected owner default privileges' USING ERRCODE='42501';
 END IF;
END;
$media_prerequisites$;

CREATE TABLE travel_map.user_media_quotas (
 user_id uuid PRIMARY KEY REFERENCES travel_map.users(id) ON DELETE RESTRICT,
 used_bytes bigint NOT NULL DEFAULT 0 CHECK(used_bytes>=0),
 reserved_bytes bigint NOT NULL DEFAULT 0 CHECK(reserved_bytes>=0),
 limit_bytes bigint NOT NULL DEFAULT 500000000 CHECK(limit_bytes=500000000),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(used_bytes<=limit_bytes AND reserved_bytes<=limit_bytes-used_bytes)
);
CREATE TABLE travel_map.photos (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 visit_id uuid NOT NULL REFERENCES travel_map.visits(id) ON DELETE RESTRICT,
 creator_id uuid NOT NULL REFERENCES travel_map.users(id) ON DELETE RESTRICT,
 quota_user_id uuid NOT NULL REFERENCES travel_map.users(id) ON DELETE RESTRICT,
 description text CHECK(char_length(description)<=2000 AND description !~ '[[:cntrl:]]'),
 status text NOT NULL DEFAULT 'pending_upload' CHECK(status IN
  ('pending_upload','processing','active','failed','cleanup_pending','trashed','restoring','purge_pending','purged')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 trashed_at timestamptz, purge_after timestamptz, purged_at timestamptz,
 CHECK(creator_id=quota_user_id),
 CHECK((trashed_at IS NULL)=(purge_after IS NULL)),
 CHECK(purge_after IS NULL OR purge_after=trashed_at+interval '2592000 seconds'),
 CHECK((status IN ('trashed','restoring','purge_pending','purged'))=(trashed_at IS NOT NULL)),
 CHECK((status='purged')=(purged_at IS NOT NULL)),
 UNIQUE(id,visit_id,creator_id)
);
CREATE INDEX photos_visit_page ON travel_map.photos(visit_id,status,created_at,id);
CREATE INDEX photos_quota_state ON travel_map.photos(quota_user_id,status);
CREATE TABLE travel_map.upload_operations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 actor_id uuid NOT NULL REFERENCES travel_map.users(id) ON DELETE RESTRICT,
 visit_id uuid NOT NULL REFERENCES travel_map.visits(id) ON DELETE RESTRICT,
 idempotency_key text NOT NULL CHECK(idempotency_key ~ '^[A-Za-z0-9_-]{16,128}$'),
 fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),
 policy_version text NOT NULL DEFAULT 'sanitized-v1' CHECK(policy_version='sanitized-v1'),
 file_count integer NOT NULL CHECK(file_count BETWEEN 1 AND 10),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','completed','partial_failure','failed')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(actor_id,idempotency_key), UNIQUE(id,visit_id,actor_id)
);
CREATE TABLE travel_map.upload_file_slots (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), operation_id uuid NOT NULL,
 visit_id uuid NOT NULL, actor_id uuid NOT NULL,
 photo_id uuid NOT NULL UNIQUE,
 client_file_id text NOT NULL CHECK(client_file_id ~ '^[A-Za-z0-9_-]{1,64}$'),
 declared_bytes bigint NOT NULL CHECK(declared_bytes BETWEEN 1 AND 20000000),
 declared_mime text CHECK(declared_mime IN ('image/jpeg','image/png','image/webp')),
 generation bigint NOT NULL DEFAULT 0 CHECK(generation>=0),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','ready','active','cleanup_pending','failed')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(operation_id,visit_id,actor_id) REFERENCES travel_map.upload_operations(id,visit_id,actor_id) ON DELETE RESTRICT,
 FOREIGN KEY(photo_id,visit_id,actor_id) REFERENCES travel_map.photos(id,visit_id,creator_id) ON DELETE RESTRICT,
 UNIQUE(operation_id,client_file_id), UNIQUE(id,actor_id)
);
CREATE TABLE travel_map.quota_reservations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slot_id uuid NOT NULL,
 user_id uuid NOT NULL REFERENCES travel_map.user_media_quotas(user_id) ON DELETE RESTRICT,
 generation bigint NOT NULL CHECK(generation>0),
 reserved_bytes bigint NOT NULL CHECK(reserved_bytes BETWEEN 1 AND 500000000),
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','cleanup_pending','finalized','released')),
 expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '15 minutes',
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 settled_at timestamptz, settlement_id uuid UNIQUE, actual_bytes bigint,
 FOREIGN KEY(slot_id,user_id) REFERENCES travel_map.upload_file_slots(id,actor_id) ON DELETE RESTRICT,
 UNIQUE(slot_id,generation), UNIQUE(id,slot_id,generation),
 CHECK(expires_at>created_at),
 CHECK((status IN ('finalized','released'))=(settlement_id IS NOT NULL AND settled_at IS NOT NULL)),
 CHECK((settlement_id IS NULL)=(settled_at IS NULL)),
 CHECK(actual_bytes IS NULL OR actual_bytes BETWEEN 0 AND reserved_bytes),
 CHECK((status='finalized')=(actual_bytes IS NOT NULL))
);
CREATE UNIQUE INDEX reservation_one_live ON travel_map.quota_reservations(slot_id) WHERE status IN ('active','cleanup_pending');
CREATE INDEX reservation_expiry ON travel_map.quota_reservations(expires_at) WHERE status='active';
CREATE TABLE travel_map.processing_attempts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slot_id uuid NOT NULL REFERENCES travel_map.upload_file_slots(id) ON DELETE RESTRICT,
 generation bigint NOT NULL CHECK(generation>0), reservation_id uuid NOT NULL UNIQUE,
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','claimed','ready','fenced','finalized','cleaned')),
 writes_settled boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(reservation_id,slot_id,generation) REFERENCES travel_map.quota_reservations(id,slot_id,generation) ON DELETE RESTRICT,
 UNIQUE(slot_id,generation), UNIQUE(id,slot_id,generation)
);
-- Artifact journal IS the candidate manifest. Keys are allocated before any future PUT.
CREATE TABLE travel_map.photo_assets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), photo_id uuid NOT NULL REFERENCES travel_map.photos(id) ON DELETE RESTRICT,
 attempt_id uuid NOT NULL REFERENCES travel_map.processing_attempts(id) ON DELETE RESTRICT,
 variant text NOT NULL CHECK(variant IN ('archival','display','thumbnail')),
 object_key text NOT NULL UNIQUE DEFAULT encode(sha256(uuid_send(gen_random_uuid())||uuid_send(gen_random_uuid())),'hex')
  CHECK(object_key ~ '^[a-f0-9]{64}$'),
 policy_version text NOT NULL DEFAULT 'sanitized-v1' CHECK(policy_version='sanitized-v1'),
 content_type text, byte_length bigint CHECK(byte_length BETWEEN 1 AND 500000000),
 width integer CHECK(width>0), height integer CHECK(height>0), sha256 text CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 status text NOT NULL DEFAULT 'expected' CHECK(status IN ('expected','verified','deleted')),
 verified_at timestamptz, availability_verified_at timestamptz, deleted_at timestamptz,
 CHECK(content_type IS NULL OR (variant='archival' AND content_type IN ('image/jpeg','image/png'))
  OR (variant IN ('display','thumbnail') AND content_type='image/webp')),
 CHECK(variant<>'display' OR (width<=2560 AND height<=2560)),
 CHECK(variant<>'thumbnail' OR (width<=480 AND height<=480)),
 CHECK(status<>'verified' OR (content_type IS NOT NULL AND byte_length IS NOT NULL
  AND width IS NOT NULL AND height IS NOT NULL AND sha256 IS NOT NULL AND verified_at IS NOT NULL)),
 CHECK((status='deleted')=(deleted_at IS NOT NULL)),
 UNIQUE(attempt_id,variant)
);
CREATE INDEX photo_assets_photo ON travel_map.photo_assets(photo_id,attempt_id,variant);
CREATE TABLE travel_map.media_tasks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 photo_id uuid NOT NULL REFERENCES travel_map.photos(id) ON DELETE RESTRICT,
 attempt_id uuid NOT NULL REFERENCES travel_map.processing_attempts(id) ON DELETE RESTRICT,
 generation bigint NOT NULL CHECK(generation>0),
 kind text NOT NULL CHECK(kind IN ('process','cleanup','restore','purge')),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','claimed','completed','fenced')),
 eligible_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 claim_id uuid, lease_until timestamptz, claim_count integer NOT NULL DEFAULT 0 CHECK(claim_count BETWEEN 0 AND 20),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), completed_at timestamptz,
 CHECK((claim_id IS NULL)=(lease_until IS NULL)),
 CHECK(state<>'claimed' OR claim_id IS NOT NULL),
 CHECK((state='completed')=(completed_at IS NOT NULL))
);
CREATE UNIQUE INDEX media_task_one_open ON travel_map.media_tasks(photo_id,kind) WHERE state IN ('pending','claimed');
CREATE INDEX media_task_claim ON travel_map.media_tasks(kind,eligible_at,id) WHERE state IN ('pending','claimed');

-- No caller-controlled clock. Disposable tests may replace this private function
-- as migration owner inside their test database, never through runtime parameters.
CREATE FUNCTION travel_map.media_retention_now() RETURNS timestamptz
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path=pg_catalog SET timezone='UTC' AS $$ SELECT clock_timestamp(); $$;

DO $private_tables$
DECLARE tab text;
BEGIN
 FOREACH tab IN ARRAY ARRAY['user_media_quotas','photos','upload_operations','upload_file_slots','quota_reservations','processing_attempts','photo_assets','media_tasks'] LOOP
  EXECUTE format('ALTER TABLE travel_map.%I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('ALTER TABLE travel_map.%I FORCE ROW LEVEL SECURITY',tab);
  EXECUTE format('CREATE POLICY media_owner ON travel_map.%I TO %I USING(true) WITH CHECK(true)',tab,current_user);
  EXECUTE format('REVOKE ALL ON travel_map.%I FROM PUBLIC',tab);
 END LOOP;
END;
$private_tables$;

CREATE FUNCTION travel_map.media_photo_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog SET timezone='UTC' AS $$
BEGIN
 IF NEW.id<>OLD.id OR NEW.visit_id<>OLD.visit_id OR NEW.creator_id<>OLD.creator_id
  OR NEW.quota_user_id<>OLD.quota_user_id OR NEW.created_at<>OLD.created_at THEN
  RAISE EXCEPTION 'Immutable media ancestry' USING ERRCODE='23514'; END IF;
 IF NEW.status<>OLD.status AND NOT (
  (OLD.status='pending_upload' AND NEW.status='processing') OR
  (OLD.status='processing' AND NEW.status IN ('active','cleanup_pending')) OR
  (OLD.status='cleanup_pending' AND NEW.status='failed') OR
  (OLD.status='failed' AND NEW.status='processing') OR
  (OLD.status='active' AND NEW.status='trashed') OR
  (OLD.status='trashed' AND NEW.status IN ('restoring','purge_pending')) OR
  (OLD.status='restoring' AND NEW.status IN ('active','trashed','purge_pending')) OR
  (OLD.status='purge_pending' AND NEW.status='purged')) THEN
  RAISE EXCEPTION 'Invalid media transition' USING ERRCODE='23514'; END IF;
 IF NEW.status='active' AND OLD.status<>'active' THEN
  IF NOT EXISTS(SELECT 1 FROM travel_map.processing_attempts a JOIN travel_map.upload_file_slots s ON s.id=a.slot_id
   WHERE s.photo_id=NEW.id AND a.generation=s.generation AND a.status='finalized'
   AND (SELECT count(*) FROM travel_map.photo_assets x WHERE x.attempt_id=a.id AND x.photo_id=NEW.id AND x.status='verified')=3) THEN
   RAISE EXCEPTION 'Incomplete media manifest' USING ERRCODE='23514'; END IF;
  IF OLD.status='restoring' AND OLD.purge_after<=travel_map.media_retention_now() THEN
   RAISE EXCEPTION 'Restoration expired' USING ERRCODE='23514'; END IF;
 END IF;
 NEW.updated_at:=clock_timestamp(); RETURN NEW;
END;
$$;
CREATE TRIGGER media_photo_transition BEFORE UPDATE ON travel_map.photos FOR EACH ROW EXECUTE FUNCTION travel_map.media_photo_guard();
CREATE FUNCTION travel_map.media_manifest_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog SET timezone='UTC' AS $$
BEGIN
 IF TG_TABLE_NAME='photo_assets' THEN
  IF (NEW.id,NEW.photo_id,NEW.attempt_id,NEW.variant,NEW.object_key,NEW.policy_version)
   IS DISTINCT FROM (OLD.id,OLD.photo_id,OLD.attempt_id,OLD.variant,OLD.object_key,OLD.policy_version)
   OR (OLD.status<>'expected' AND (NEW.content_type,NEW.byte_length,NEW.width,NEW.height,NEW.sha256)
    IS DISTINCT FROM (OLD.content_type,OLD.byte_length,OLD.width,OLD.height,OLD.sha256))
   OR (OLD.status='deleted' AND NEW.status<>'deleted') OR (OLD.status='verified' AND NEW.status='expected') THEN
   RAISE EXCEPTION 'Immutable media evidence' USING ERRCODE='23514'; END IF;
 ELSE
  IF (NEW.id,NEW.actor_id,NEW.visit_id,NEW.idempotency_key,NEW.fingerprint,NEW.policy_version,NEW.file_count,NEW.created_at)
   IS DISTINCT FROM (OLD.id,OLD.actor_id,OLD.visit_id,OLD.idempotency_key,OLD.fingerprint,OLD.policy_version,OLD.file_count,OLD.created_at) THEN
   RAISE EXCEPTION 'Immutable upload intent' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER media_asset_immutable BEFORE UPDATE ON travel_map.photo_assets FOR EACH ROW EXECUTE FUNCTION travel_map.media_manifest_guard();
CREATE TRIGGER media_intent_immutable BEFORE UPDATE ON travel_map.upload_operations FOR EACH ROW EXECUTE FUNCTION travel_map.media_manifest_guard();

CREATE FUNCTION travel_map.media_resource_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog SET timezone='UTC' AS $$
BEGIN
 IF TG_TABLE_NAME='upload_file_slots' THEN
  IF (NEW.id,NEW.operation_id,NEW.visit_id,NEW.actor_id,NEW.photo_id,NEW.client_file_id,NEW.declared_bytes,NEW.declared_mime,NEW.created_at)
   IS DISTINCT FROM (OLD.id,OLD.operation_id,OLD.visit_id,OLD.actor_id,OLD.photo_id,OLD.client_file_id,OLD.declared_bytes,OLD.declared_mime,OLD.created_at)
   OR (NEW.generation<>OLD.generation AND NOT (NEW.generation=OLD.generation+1 AND OLD.status IN ('pending','failed') AND NEW.status='processing')) THEN
   RAISE EXCEPTION 'Immutable file identity' USING ERRCODE='23514'; END IF;
  IF NEW.status<>OLD.status AND NOT ((OLD.status IN ('pending','failed') AND NEW.status='processing') OR
   (OLD.status='processing' AND NEW.status IN ('ready','cleanup_pending')) OR (OLD.status='ready' AND NEW.status IN ('active','cleanup_pending')) OR
   (OLD.status='cleanup_pending' AND NEW.status='failed')) THEN RAISE EXCEPTION 'Invalid slot transition' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='processing_attempts' THEN
  IF (NEW.id,NEW.slot_id,NEW.generation,NEW.reservation_id,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.slot_id,OLD.generation,OLD.reservation_id,OLD.created_at)
   OR (OLD.writes_settled AND NOT NEW.writes_settled) OR (NEW.status<>OLD.status AND NOT (
    (OLD.status='queued' AND NEW.status IN ('claimed','fenced')) OR (OLD.status='claimed' AND NEW.status IN ('ready','fenced')) OR
    (OLD.status='ready' AND NEW.status IN ('finalized','fenced')) OR (OLD.status='fenced' AND NEW.status='cleaned'))) THEN
   RAISE EXCEPTION 'Invalid attempt transition' USING ERRCODE='23514'; END IF;
 ELSE
  IF (NEW.id,NEW.slot_id,NEW.user_id,NEW.generation,NEW.reserved_bytes,NEW.created_at) IS DISTINCT FROM
   (OLD.id,OLD.slot_id,OLD.user_id,OLD.generation,OLD.reserved_bytes,OLD.created_at) OR (NEW.status<>OLD.status AND NOT
   ((OLD.status='active' AND NEW.status IN ('cleanup_pending','finalized')) OR (OLD.status='cleanup_pending' AND NEW.status='released')))
   OR (OLD.status IN ('released','finalized') AND NEW IS DISTINCT FROM OLD) THEN
   RAISE EXCEPTION 'Invalid reservation transition' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER media_slot_immutable BEFORE UPDATE ON travel_map.upload_file_slots FOR EACH ROW EXECUTE FUNCTION travel_map.media_resource_guard();
CREATE TRIGGER media_attempt_immutable BEFORE UPDATE ON travel_map.processing_attempts FOR EACH ROW EXECUTE FUNCTION travel_map.media_resource_guard();
CREATE TRIGGER media_reservation_immutable BEFORE UPDATE ON travel_map.quota_reservations FOR EACH ROW EXECUTE FUNCTION travel_map.media_resource_guard();
CREATE FUNCTION travel_map.media_operation_sync() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE total integer; complete_count integer; failed_count integer; busy integer;
BEGIN
 SELECT count(*),count(*) FILTER(WHERE status='active'),count(*) FILTER(WHERE status='failed'),
  count(*) FILTER(WHERE status IN ('processing','ready','cleanup_pending')) INTO total,complete_count,failed_count,busy
  FROM travel_map.upload_file_slots WHERE operation_id=NEW.operation_id;
 UPDATE travel_map.upload_operations SET status=CASE WHEN busy>0 THEN 'processing'
  WHEN total=file_count AND complete_count=file_count THEN 'completed'
  WHEN total=file_count AND complete_count+failed_count=file_count THEN CASE WHEN complete_count>0 THEN 'partial_failure' ELSE 'failed' END
  ELSE 'pending' END,updated_at=clock_timestamp() WHERE id=NEW.operation_id;
 RETURN NULL;
END;
$$;
CREATE TRIGGER media_operation_state AFTER INSERT OR UPDATE ON travel_map.upload_file_slots FOR EACH ROW EXECUTE FUNCTION travel_map.media_operation_sync();

-- Preserve existing audit history and append-only triggers; extend only fixed media actions.
ALTER TABLE travel_map.domain_audit_events DROP CONSTRAINT domain_audit_events_resource_type_check,
 DROP CONSTRAINT domain_audit_events_action_check,DROP CONSTRAINT domain_audit_events_check;
ALTER TABLE travel_map.domain_audit_events ADD CONSTRAINT domain_audit_events_resource_type_check CHECK(resource_type IN ('project','trip','photo'));
ALTER TABLE travel_map.domain_audit_events ADD CONSTRAINT domain_audit_events_action_check CHECK(action IN
 ('member_promoted','admin_demoted','member_removed','project_left','guest_removed','trip_left','project_settings_changed','project_archived',
 'invitation_issued','invitation_revoked','invitation_redeemed','photo_activated','photo_trashed','photo_restored','photo_description_changed','photo_cleanup_completed','photo_purged'));
ALTER TABLE travel_map.domain_audit_events ADD CONSTRAINT domain_audit_events_check CHECK(
 (resource_type='photo' AND action LIKE 'photo_%') OR
 (resource_type IN ('project','trip') AND (action LIKE 'invitation_%' OR
 ((resource_type='trip')=(action IN ('guest_removed','trip_left')) AND action NOT LIKE 'photo_%'))));

-- Pure private authorization helper. Caller locks quota BEFORE ancestry.
CREATE FUNCTION travel_map.media_context(p_actor uuid,p_visit uuid) RETURNS text
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE trip_id_value uuid; project_id_value uuid; parent travel_map.projects; role_value text;
BEGIN
 SELECT v.trip_id,t.project_id INTO trip_id_value,project_id_value FROM travel_map.visits v
  JOIN travel_map.trips t ON t.id=v.trip_id WHERE v.id=p_visit;
 SELECT * INTO parent FROM travel_map.projects WHERE id=project_id_value AND status='active' FOR SHARE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 PERFORM 1 FROM travel_map.trips WHERE id=trip_id_value AND project_id=parent.id AND status='active' FOR SHARE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 PERFORM 1 FROM travel_map.visits WHERE id=p_visit AND trip_id=trip_id_value AND status='active' FOR SHARE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF parent.owner_user_id=p_actor THEN RETURN 'owner'; END IF;
 SELECT role INTO role_value FROM travel_map.project_memberships WHERE project_id=parent.id AND user_id=p_actor AND status='active' FOR SHARE;
 IF role_value IS NOT NULL THEN RETURN role_value; END IF;
 PERFORM 1 FROM travel_map.trip_memberships WHERE trip_id=trip_id_value AND user_id=p_actor AND status='active' FOR SHARE;
 IF FOUND THEN RETURN 'guest'; END IF;
 RETURN NULL;
END;
$$;
CREATE FUNCTION travel_map.media_photo_dto(p travel_map.photos) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog SET timezone='UTC' AS $$
 SELECT jsonb_build_object('id',p.id,'visitId',p.visit_id,'createdByUserId',p.creator_id,'description',p.description,
  'status',p.status,'createdAt',p.created_at,'updatedAt',p.updated_at);
$$;

CREATE FUNCTION travel_map.media_action(p_actor uuid,p_action text,p_data jsonb,p_session uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE allowed text[]; visit_id_value uuid; charged_user uuid; role_value text;
 op travel_map.upload_operations; slot travel_map.upload_file_slots; photo travel_map.photos;
 reservation travel_map.quota_reservations; attempt travel_map.processing_attempts;
 quota travel_map.user_media_quotas; file_value jsonb; fingerprint_value text; items jsonb;
 count_value integer; bytes_value bigint; actual_value bigint; page_limit integer;
 stamp timestamptz; task travel_map.media_tasks;
BEGIN
 CASE p_action
 WHEN 'media.begin' THEN allowed:=ARRAY['visitId','idempotencyKey','files'];
 WHEN 'media.operation' THEN allowed:=ARRAY['id'];
 WHEN 'media.reserve' THEN allowed:=ARRAY['slotId','reservedBytes'];
 WHEN 'media.finalize','media.cancel' THEN allowed:=ARRAY['slotId'];
 WHEN 'media.list' THEN allowed:=ARRAY['visitId','state','limit','cursorTime','cursorId'];
 WHEN 'media.get','media.archival','media.trash','media.restore' THEN allowed:=ARRAY['id'];
 WHEN 'media.describe' THEN allowed:=ARRAY['id','description'];
 ELSE RETURN jsonb_build_object('error','RESOURCE_NOT_FOUND'); END CASE;
 IF p_data IS NULL OR jsonb_typeof(p_data)<>'object' OR octet_length(p_data::text)>32768
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_data) k WHERE k<>ALL(allowed)) THEN
  RETURN jsonb_build_object('error','VALIDATION_ERROR'); END IF;
 IF EXISTS(SELECT 1 FROM jsonb_each(p_data) e WHERE e.key IN ('id','visitId','slotId','cursorId') AND
  (jsonb_typeof(e.value)<>'string' OR (e.value#>>'{}') !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$')) THEN
  RETURN jsonb_build_object('error','VALIDATION_ERROR'); END IF;
 charged_user:=p_actor;
 IF p_action IN ('media.begin','media.list') THEN
  IF NOT p_data?'visitId' THEN RETURN jsonb_build_object('error','VALIDATION_ERROR'); END IF;
  visit_id_value:=(p_data->>'visitId')::uuid;
 ELSIF p_action='media.operation' THEN
  IF NOT p_data?'id' THEN RETURN jsonb_build_object('error','VALIDATION_ERROR'); END IF;
  SELECT * INTO op FROM travel_map.upload_operations WHERE id=(p_data->>'id')::uuid AND actor_id=p_actor;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','RESOURCE_NOT_FOUND'); END IF;
  visit_id_value:=op.visit_id;
 ELSIF p_action IN ('media.reserve','media.finalize','media.cancel') THEN
  IF NOT p_data?'slotId' THEN RETURN jsonb_build_object('error','VALIDATION_ERROR'); END IF;
  SELECT * INTO slot FROM travel_map.upload_file_slots WHERE id=(p_data->>'slotId')::uuid AND actor_id=p_actor;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','RESOURCE_NOT_FOUND'); END IF;
  visit_id_value:=slot.visit_id;
 ELSE
  IF NOT p_data?'id' THEN RETURN jsonb_build_object('error','VALIDATION_ERROR'); END IF;
  SELECT * INTO photo FROM travel_map.photos WHERE id=(p_data->>'id')::uuid;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','RESOURCE_NOT_FOUND'); END IF;
  visit_id_value:=photo.visit_id; charged_user:=photo.quota_user_id;
 END IF;
 -- Account phase, quota, ancestry, then resource rows. Never acquire quota after parent locks.
 PERFORM 1 FROM travel_map.users WHERE id=charged_user FOR SHARE;
 INSERT INTO travel_map.user_media_quotas(user_id) VALUES(charged_user) ON CONFLICT DO NOTHING;
 SELECT * INTO quota FROM travel_map.user_media_quotas WHERE user_id=charged_user FOR UPDATE;
 role_value:=travel_map.media_context(p_actor,visit_id_value);
 IF role_value IS NULL THEN RETURN jsonb_build_object('error','RESOURCE_NOT_FOUND'); END IF;
 IF NOT EXISTS(SELECT 1 FROM travel_map.app_sessions WHERE id=p_session AND user_id=p_actor AND revoked_at IS NULL
   AND expires_at>clock_timestamp() AND idle_expires_at>clock_timestamp()) THEN RETURN jsonb_build_object('error','SESSION_REQUIRED'); END IF;
 IF p_action='media.begin' THEN
  IF jsonb_typeof(p_data->'idempotencyKey') IS DISTINCT FROM 'string'
   OR p_data->>'idempotencyKey' !~ '^[A-Za-z0-9_-]{16,128}$'
   OR jsonb_typeof(p_data->'files') IS DISTINCT FROM 'array' THEN RETURN jsonb_build_object('error','VALIDATION_ERROR'); END IF;
  count_value:=jsonb_array_length(p_data->'files');
  IF count_value NOT BETWEEN 1 AND 10 THEN RETURN jsonb_build_object('error','VALIDATION_ERROR'); END IF;
  FOR file_value IN SELECT value FROM jsonb_array_elements(p_data->'files') LOOP
   IF jsonb_typeof(file_value)<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(file_value) k WHERE k NOT IN ('clientFileId','declaredBytes','declaredMime'))
    OR jsonb_typeof(file_value->'clientFileId') IS DISTINCT FROM 'string'
    OR file_value->>'clientFileId' !~ '^[A-Za-z0-9_-]{1,64}$'
    OR jsonb_typeof(file_value->'declaredBytes') IS DISTINCT FROM 'number'
    OR (file_value->>'declaredBytes')::bigint NOT BETWEEN 1 AND 20000000
    OR (file_value?'declaredMime' AND (jsonb_typeof(file_value->'declaredMime')<>'string' OR file_value->>'declaredMime' NOT IN ('image/jpeg','image/png','image/webp'))) THEN
    RETURN jsonb_build_object('error','VALIDATION_ERROR'); END IF;
  END LOOP;
  IF (SELECT count(DISTINCT value->>'clientFileId') FROM jsonb_array_elements(p_data->'files'))<>count_value THEN
   RETURN jsonb_build_object('error','VALIDATION_ERROR'); END IF;
  fingerprint_value:=encode(sha256(convert_to(jsonb_build_object('visitId',visit_id_value,'files',p_data->'files','policyVersion','sanitized-v1')::text,'UTF8')),'hex');
  SELECT * INTO op FROM travel_map.upload_operations WHERE actor_id=p_actor AND idempotency_key=p_data->>'idempotencyKey' FOR UPDATE;
  IF FOUND THEN
   IF op.fingerprint<>fingerprint_value THEN RETURN jsonb_build_object('error','OPERATION_CONFLICT'); END IF;
  ELSE
   INSERT INTO travel_map.upload_operations(actor_id,visit_id,idempotency_key,fingerprint,file_count)
    VALUES(p_actor,visit_id_value,p_data->>'idempotencyKey',fingerprint_value,count_value) RETURNING * INTO op;
   FOR file_value IN SELECT value FROM jsonb_array_elements(p_data->'files') LOOP
    INSERT INTO travel_map.photos(visit_id,creator_id,quota_user_id) VALUES(visit_id_value,p_actor,p_actor) RETURNING * INTO photo;
    INSERT INTO travel_map.upload_file_slots(operation_id,visit_id,actor_id,photo_id,client_file_id,declared_bytes,declared_mime)
     VALUES(op.id,visit_id_value,p_actor,photo.id,file_value->>'clientFileId',(file_value->>'declaredBytes')::bigint,file_value->>'declaredMime');
   END LOOP;
  END IF;
 END IF;
 IF p_action IN ('media.begin','media.operation') THEN
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',s.id,'photoId',s.photo_id,'clientFileId',s.client_file_id,'status',s.status) ORDER BY s.client_file_id),'[]') INTO items
   FROM travel_map.upload_file_slots s WHERE s.operation_id=op.id;
  SELECT * INTO op FROM travel_map.upload_operations WHERE id=op.id;
  RETURN jsonb_build_object('id',op.id,'visitId',op.visit_id,'policyVersion',op.policy_version,'status',op.status,
   'createdAt',op.created_at,'updatedAt',op.updated_at,'files',items);
 END IF;
 IF p_action IN ('media.reserve','media.finalize','media.cancel') THEN
  PERFORM 1 FROM travel_map.upload_operations WHERE id=slot.operation_id FOR UPDATE;
  SELECT * INTO slot FROM travel_map.upload_file_slots WHERE id=slot.id FOR UPDATE;
  SELECT * INTO photo FROM travel_map.photos WHERE id=slot.photo_id FOR UPDATE;
  SELECT * INTO reservation FROM travel_map.quota_reservations WHERE slot_id=slot.id AND generation=slot.generation FOR UPDATE;
  SELECT * INTO attempt FROM travel_map.processing_attempts WHERE slot_id=slot.id AND generation=slot.generation FOR UPDATE;
  IF NOT EXISTS(SELECT 1 FROM travel_map.app_sessions WHERE id=p_session AND user_id=p_actor AND revoked_at IS NULL
   AND expires_at>clock_timestamp() AND idle_expires_at>clock_timestamp()) THEN RETURN jsonb_build_object('error','SESSION_REQUIRED'); END IF;
  IF p_action='media.reserve' THEN
   IF jsonb_typeof(p_data->'reservedBytes') IS DISTINCT FROM 'number' THEN RETURN jsonb_build_object('error','VALIDATION_ERROR'); END IF;
   bytes_value:=(p_data->>'reservedBytes')::bigint;
   IF bytes_value NOT BETWEEN 1 AND 500000000 THEN RETURN jsonb_build_object('error','VALIDATION_ERROR'); END IF;
   IF reservation.status='active' AND photo.status='processing' AND reservation.expires_at>clock_timestamp() THEN
    IF reservation.reserved_bytes<>bytes_value THEN RETURN jsonb_build_object('error','OPERATION_CONFLICT'); END IF;
    RETURN jsonb_build_object('reservationId',reservation.id,'generation',slot.generation);
   END IF;
   IF photo.status NOT IN ('pending_upload','failed') OR
    EXISTS(SELECT 1 FROM travel_map.quota_reservations WHERE slot_id=slot.id AND status IN ('active','cleanup_pending','finalized')) THEN
    RETURN jsonb_build_object('error','OPERATION_CONFLICT'); END IF;
   IF bytes_value>quota.limit_bytes-quota.used_bytes-quota.reserved_bytes THEN RETURN jsonb_build_object('error','QUOTA_EXCEEDED'); END IF;
   UPDATE travel_map.user_media_quotas SET reserved_bytes=reserved_bytes+bytes_value,updated_at=clock_timestamp() WHERE user_id=charged_user;
   UPDATE travel_map.upload_file_slots SET generation=generation+1,status='processing' WHERE id=slot.id RETURNING * INTO slot;
   INSERT INTO travel_map.quota_reservations(slot_id,user_id,generation,reserved_bytes) VALUES(slot.id,p_actor,slot.generation,bytes_value) RETURNING * INTO reservation;
   INSERT INTO travel_map.processing_attempts(slot_id,generation,reservation_id) VALUES(slot.id,slot.generation,reservation.id) RETURNING * INTO attempt;
   INSERT INTO travel_map.photo_assets(photo_id,attempt_id,variant) SELECT photo.id,attempt.id,v FROM unnest(ARRAY['archival','display','thumbnail']) v;
   INSERT INTO travel_map.media_tasks(photo_id,attempt_id,generation,kind) VALUES(photo.id,attempt.id,slot.generation,'process');
   UPDATE travel_map.photos SET status='processing' WHERE id=photo.id;
   RETURN jsonb_build_object('reservationId',reservation.id,'generation',slot.generation);
  ELSIF p_action='media.cancel' THEN
   IF photo.status='failed' AND reservation.status='released' THEN RETURN '{}'::jsonb; END IF;
   IF photo.status NOT IN ('processing','cleanup_pending') THEN RETURN jsonb_build_object('error','OPERATION_CONFLICT'); END IF;
   UPDATE travel_map.photos SET status='cleanup_pending' WHERE id=photo.id;
   UPDATE travel_map.upload_file_slots SET status='cleanup_pending' WHERE id=slot.id;
   UPDATE travel_map.quota_reservations SET status='cleanup_pending' WHERE id=reservation.id;
   UPDATE travel_map.processing_attempts SET status='fenced' WHERE id=attempt.id;
   UPDATE travel_map.media_tasks SET state='fenced' WHERE attempt_id=attempt.id AND kind='process' AND state IN ('pending','claimed');
   INSERT INTO travel_map.media_tasks(photo_id,attempt_id,generation,kind) VALUES(photo.id,attempt.id,slot.generation,'cleanup') ON CONFLICT DO NOTHING;
   RETURN '{}'::jsonb;
  ELSE
   IF photo.status='active' AND reservation.status='finalized' THEN RETURN travel_map.media_photo_dto(photo); END IF;
   IF attempt.status IS DISTINCT FROM 'ready' OR NOT attempt.writes_settled OR slot.status<>'ready'
    OR reservation.status<>'active' OR reservation.expires_at<=clock_timestamp() OR attempt.generation<>slot.generation THEN
    RETURN jsonb_build_object('error','OPERATION_CONFLICT'); END IF;
   SELECT count(*),sum(byte_length) INTO count_value,actual_value FROM travel_map.photo_assets
    WHERE attempt_id=attempt.id AND photo_id=photo.id AND status='verified';
   IF count_value<>3 OR actual_value>reservation.reserved_bytes THEN RETURN jsonb_build_object('error','OPERATION_CONFLICT'); END IF;
   UPDATE travel_map.user_media_quotas SET reserved_bytes=reserved_bytes-reservation.reserved_bytes,used_bytes=used_bytes+actual_value,updated_at=clock_timestamp() WHERE user_id=charged_user;
   UPDATE travel_map.quota_reservations SET status='finalized',actual_bytes=actual_value,settlement_id=gen_random_uuid(),settled_at=clock_timestamp() WHERE id=reservation.id;
   UPDATE travel_map.processing_attempts SET status='finalized' WHERE id=attempt.id;
   UPDATE travel_map.upload_file_slots SET status='active' WHERE id=slot.id;
   UPDATE travel_map.photos SET status='active' WHERE id=photo.id RETURNING * INTO photo;
   INSERT INTO travel_map.domain_audit_events(actor_id,resource_id,resource_type,action,metadata) VALUES(p_actor,photo.id,'photo','photo_activated','{}');
   RETURN travel_map.media_photo_dto(photo);
  END IF;
 END IF;
 IF p_action='media.list' THEN
  page_limit:=COALESCE((p_data->>'limit')::integer,25);
  IF page_limit NOT BETWEEN 1 AND 100 OR (p_data?'cursorTime')<>(p_data?'cursorId') OR
   (p_data?'state' AND (jsonb_typeof(p_data->'state')<>'string' OR p_data->>'state' NOT IN ('active','trashed')))
   OR (p_data?'limit' AND jsonb_typeof(p_data->'limit')<>'number') THEN RETURN jsonb_build_object('error','VALIDATION_ERROR'); END IF;
  SELECT COALESCE(jsonb_agg(item ORDER BY created_at,id),'[]') INTO items FROM (
   SELECT p.created_at,p.id,travel_map.media_photo_dto(p) item FROM travel_map.photos p WHERE p.visit_id=visit_id_value
    AND p.status=COALESCE(p_data->>'state','active')
    AND (p.status='active' OR p.creator_id=p_actor OR role_value IN ('owner','admin'))
    AND (p_data->>'cursorTime' IS NULL OR (p.created_at,p.id)>((p_data->>'cursorTime')::timestamptz,(p_data->>'cursorId')::uuid))
    ORDER BY p.created_at,p.id LIMIT page_limit+1) page;
  RETURN jsonb_build_object('items',items);
 END IF;
 SELECT * INTO photo FROM travel_map.photos WHERE id=photo.id FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM travel_map.app_sessions WHERE id=p_session AND user_id=p_actor AND revoked_at IS NULL
   AND expires_at>clock_timestamp() AND idle_expires_at>clock_timestamp()) THEN RETURN jsonb_build_object('error','SESSION_REQUIRED'); END IF;
 IF p_action IN ('media.get','media.archival') THEN
  IF photo.status<>'active' THEN RETURN jsonb_build_object('error','RESOURCE_NOT_FOUND'); END IF;
  IF p_action='media.archival' AND photo.creator_id<>p_actor AND role_value NOT IN ('owner','admin') THEN RETURN jsonb_build_object('error','ACTION_FORBIDDEN'); END IF;
  RETURN travel_map.media_photo_dto(photo); -- Never returns a key/stream, even for archival authorization.
 END IF;
 IF photo.status NOT IN ('active','trashed','restoring') THEN RETURN jsonb_build_object('error','RESOURCE_NOT_FOUND'); END IF;
 IF photo.creator_id<>p_actor AND role_value NOT IN ('owner','admin') THEN RETURN jsonb_build_object('error','ACTION_FORBIDDEN'); END IF;
 IF p_action='media.describe' THEN
  IF photo.status<>'active' THEN RETURN jsonb_build_object('error','OPERATION_CONFLICT'); END IF;
  IF NOT p_data?'description' OR (p_data->'description'<>'null'::jsonb AND
   (jsonb_typeof(p_data->'description')<>'string' OR char_length(p_data->>'description')>2000 OR p_data->>'description' ~ '[[:cntrl:]]')) THEN
   RETURN jsonb_build_object('error','VALIDATION_ERROR'); END IF;
  UPDATE travel_map.photos SET description=p_data->>'description' WHERE id=photo.id RETURNING * INTO photo;
  INSERT INTO travel_map.domain_audit_events(actor_id,resource_id,resource_type,action,metadata) VALUES(p_actor,photo.id,'photo','photo_description_changed','{}');
 ELSIF p_action='media.trash' THEN
  IF photo.status='trashed' THEN RETURN travel_map.media_photo_dto(photo); END IF;
  IF photo.status<>'active' THEN RETURN jsonb_build_object('error','OPERATION_CONFLICT'); END IF;
  stamp:=travel_map.media_retention_now();
  UPDATE travel_map.photos SET status='trashed',trashed_at=stamp,purge_after=stamp+interval '2592000 seconds' WHERE id=photo.id RETURNING * INTO photo;
  SELECT a.* INTO attempt FROM travel_map.processing_attempts a JOIN travel_map.upload_file_slots s ON s.id=a.slot_id WHERE s.photo_id=photo.id AND a.status='finalized';
  INSERT INTO travel_map.media_tasks(photo_id,attempt_id,generation,kind,eligible_at) VALUES(photo.id,attempt.id,attempt.generation,'purge',photo.purge_after);
  INSERT INTO travel_map.domain_audit_events(actor_id,resource_id,resource_type,action,metadata) VALUES(p_actor,photo.id,'photo','photo_trashed','{}');
 ELSE
  IF photo.status NOT IN ('trashed','restoring') THEN RETURN jsonb_build_object('error','OPERATION_CONFLICT'); END IF;
  IF photo.purge_after<=travel_map.media_retention_now() THEN RETURN jsonb_build_object('error','OPERATION_CONFLICT'); END IF;
  SELECT a.* INTO attempt FROM travel_map.processing_attempts a JOIN travel_map.upload_file_slots s ON s.id=a.slot_id WHERE s.photo_id=photo.id AND a.status='finalized';
  IF photo.status='trashed' THEN
   UPDATE travel_map.photos SET status='restoring' WHERE id=photo.id;
   INSERT INTO travel_map.media_tasks(photo_id,attempt_id,generation,kind) VALUES(photo.id,attempt.id,attempt.generation,'restore');
   RETURN jsonb_build_object('status','restoring');
  END IF;
  SELECT * INTO task FROM travel_map.media_tasks WHERE photo_id=photo.id AND kind='restore' ORDER BY created_at DESC,id DESC LIMIT 1;
  IF NOT FOUND OR task.state<>'completed' OR EXISTS(SELECT 1 FROM travel_map.photo_assets WHERE attempt_id=attempt.id AND (status<>'verified' OR availability_verified_at IS NULL OR availability_verified_at<task.created_at)) THEN
   RETURN jsonb_build_object('error','OPERATION_CONFLICT'); END IF;
  UPDATE travel_map.media_tasks SET state='fenced' WHERE photo_id=photo.id AND kind='purge' AND state='pending';
  UPDATE travel_map.photos SET status='active',trashed_at=NULL,purge_after=NULL WHERE id=photo.id RETURNING * INTO photo;
  INSERT INTO travel_map.domain_audit_events(actor_id,resource_id,resource_type,action,metadata) VALUES(p_actor,photo.id,'photo','photo_restored','{}');
 END IF;
 RETURN travel_map.media_photo_dto(photo);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR datetime_field_overflow OR check_violation OR not_null_violation THEN
 RETURN jsonb_build_object('error','VALIDATION_ERROR');
 WHEN unique_violation OR serialization_failure OR deadlock_detected OR lock_not_available THEN RETURN jsonb_build_object('error','OPERATION_CONFLICT');
END;
$$;

-- Technical events are explicitly attributed to the technical principal, never a fake user.
ALTER TABLE travel_map.domain_audit_events ALTER COLUMN actor_id DROP NOT NULL;
ALTER TABLE travel_map.domain_audit_events ADD COLUMN technical_principal text CHECK(technical_principal='media_maintenance');
ALTER TABLE travel_map.domain_audit_events ADD CONSTRAINT domain_audit_actor_kind CHECK(
 (actor_id IS NOT NULL AND technical_principal IS NULL) OR
 (actor_id IS NULL AND technical_principal IS NOT NULL AND technical_principal='media_maintenance' AND action IN ('photo_cleanup_completed','photo_purged')));
ALTER TABLE travel_map.media_tasks ADD COLUMN result_digest text CHECK(result_digest ~ '^[a-f0-9]{64}$');

CREATE FUNCTION travel_map.media_link_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE expected_photo uuid; expected_generation bigint;
BEGIN
 SELECT s.photo_id,a.generation INTO expected_photo,expected_generation FROM travel_map.processing_attempts a
  JOIN travel_map.upload_file_slots s ON s.id=a.slot_id WHERE a.id=NEW.attempt_id;
 IF expected_photo IS DISTINCT FROM NEW.photo_id THEN RAISE EXCEPTION 'Invalid artifact ancestry' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='media_tasks' THEN
  IF expected_generation IS DISTINCT FROM NEW.generation OR (TG_OP='UPDATE' AND
   (NEW.id,NEW.photo_id,NEW.attempt_id,NEW.generation,NEW.kind,NEW.created_at) IS DISTINCT FROM
   (OLD.id,OLD.photo_id,OLD.attempt_id,OLD.generation,OLD.kind,OLD.created_at)) THEN
   RAISE EXCEPTION 'Invalid task generation' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER media_asset_ancestry BEFORE INSERT ON travel_map.photo_assets FOR EACH ROW EXECUTE FUNCTION travel_map.media_link_guard();
CREATE TRIGGER media_task_ancestry BEFORE INSERT OR UPDATE ON travel_map.media_tasks FOR EACH ROW EXECUTE FUNCTION travel_map.media_link_guard();
-- Deferred triggers run at COMMIT after the caller definer frame exits.
-- This count-only trigger needs owner authority, never runtime EXECUTE.
CREATE FUNCTION travel_map.media_slot_bound() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE op_id uuid; expected integer; actual integer;
BEGIN
 IF TG_TABLE_NAME='upload_operations' THEN op_id:=NEW.id; ELSE op_id:=NEW.operation_id; END IF;
 SELECT file_count INTO expected FROM travel_map.upload_operations WHERE id=op_id;
 SELECT count(*) INTO actual FROM travel_map.upload_file_slots WHERE operation_id=op_id;
 IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Invalid upload slot count' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER media_operation_slots AFTER INSERT OR UPDATE ON travel_map.upload_operations
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION travel_map.media_slot_bound();
CREATE CONSTRAINT TRIGGER media_slot_count AFTER INSERT OR UPDATE ON travel_map.upload_file_slots
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION travel_map.media_slot_bound();

-- Shared lock implementation for all technical operations. Read routing IDs first,
-- then account/quota -> Project/Trip/Visit -> operation/slot/Photo/attempt/task.
CREATE FUNCTION travel_map.media_lock_task(p_id uuid) RETURNS travel_map.media_tasks
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE task travel_map.media_tasks; photo travel_map.photos; slot travel_map.upload_file_slots;
 project_id_value uuid; trip_id_value uuid;
BEGIN
 SELECT * INTO task FROM travel_map.media_tasks WHERE id=p_id;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO photo FROM travel_map.photos WHERE id=task.photo_id;
 PERFORM 1 FROM travel_map.users WHERE id=photo.quota_user_id FOR SHARE;
 PERFORM 1 FROM travel_map.user_media_quotas WHERE user_id=photo.quota_user_id FOR UPDATE;
 SELECT v.trip_id,t.project_id INTO trip_id_value,project_id_value FROM travel_map.visits v JOIN travel_map.trips t ON t.id=v.trip_id WHERE v.id=photo.visit_id;
 PERFORM 1 FROM travel_map.projects WHERE id=project_id_value FOR SHARE;
 PERFORM 1 FROM travel_map.trips WHERE id=trip_id_value FOR SHARE;
 PERFORM 1 FROM travel_map.visits WHERE id=photo.visit_id FOR SHARE;
 SELECT s.* INTO slot FROM travel_map.upload_file_slots s JOIN travel_map.processing_attempts a ON a.slot_id=s.id WHERE a.id=task.attempt_id;
 PERFORM 1 FROM travel_map.upload_operations WHERE id=slot.operation_id FOR UPDATE;
 PERFORM 1 FROM travel_map.upload_file_slots WHERE id=slot.id FOR UPDATE;
 PERFORM 1 FROM travel_map.photos WHERE id=photo.id FOR UPDATE;
 PERFORM 1 FROM travel_map.quota_reservations r JOIN travel_map.processing_attempts a ON a.reservation_id=r.id
  WHERE a.id=task.attempt_id FOR UPDATE OF r;
 PERFORM 1 FROM travel_map.processing_attempts WHERE id=task.attempt_id FOR UPDATE;
 SELECT * INTO task FROM travel_map.media_tasks WHERE id=p_id FOR UPDATE;
 RETURN task;
END;
$$;

CREATE SCHEMA travel_map_jobs;
REVOKE ALL ON SCHEMA travel_map_jobs FROM PUBLIC;
GRANT USAGE ON SCHEMA travel_map_jobs TO travel_map_media_maintenance;
CREATE FUNCTION travel_map_jobs.claim(p_kind text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE candidate uuid; task travel_map.media_tasks; attempt travel_map.processing_attempts;
 slot travel_map.upload_file_slots; photo travel_map.photos; reservation travel_map.quota_reservations; assets jsonb;
BEGIN
 IF p_kind NOT IN ('process','cleanup','restore','purge') OR p_kind IS NULL THEN RETURN jsonb_build_object('error','VALIDATION_ERROR'); END IF;
 IF p_kind='cleanup' THEN
  -- One bounded stale attempt per call; expiration fences, but NEVER proves I/O settled.
  SELECT j.id INTO candidate FROM travel_map.media_tasks j JOIN travel_map.processing_attempts a ON a.id=j.attempt_id
   JOIN travel_map.quota_reservations r ON r.id=a.reservation_id JOIN travel_map.photos p ON p.id=j.photo_id
   WHERE j.kind='process' AND a.status IN ('queued','claimed','ready') AND p.status='processing'
   AND (r.expires_at<=clock_timestamp() OR (j.state='claimed' AND j.lease_until<=clock_timestamp())) ORDER BY j.eligible_at,j.id LIMIT 1;
  IF FOUND THEN
   task:=travel_map.media_lock_task(candidate);
   SELECT * INTO attempt FROM travel_map.processing_attempts WHERE id=task.attempt_id;
   SELECT * INTO reservation FROM travel_map.quota_reservations WHERE id=attempt.reservation_id;
   IF attempt.status IN ('queued','claimed','ready') AND (reservation.expires_at<=clock_timestamp() OR
    (task.state='claimed' AND task.lease_until<=clock_timestamp())) THEN
    UPDATE travel_map.processing_attempts SET status='fenced' WHERE id=attempt.id;
    UPDATE travel_map.quota_reservations SET status='cleanup_pending' WHERE id=reservation.id;
    UPDATE travel_map.upload_file_slots SET status='cleanup_pending' WHERE id=attempt.slot_id;
    UPDATE travel_map.photos SET status='cleanup_pending' WHERE id=task.photo_id;
    UPDATE travel_map.media_tasks SET state='fenced',completed_at=NULL WHERE id=task.id;
    INSERT INTO travel_map.media_tasks(photo_id,attempt_id,generation,kind) VALUES(task.photo_id,attempt.id,attempt.generation,'cleanup') ON CONFLICT DO NOTHING;
   END IF;
  END IF;
 END IF;
 -- Claims are bounded; expired PROCESS leases are not reissued to a second writer.
 FOR candidate IN SELECT id FROM travel_map.media_tasks WHERE kind=p_kind AND eligible_at<=CASE WHEN kind='purge' THEN travel_map.media_retention_now() ELSE clock_timestamp() END
  AND claim_count<20 AND (state='pending' OR (p_kind<>'process' AND state='claimed' AND lease_until<=clock_timestamp()))
  ORDER BY eligible_at,id LIMIT 8 LOOP
  task:=travel_map.media_lock_task(candidate);
  IF task.state<>'pending' AND NOT (p_kind<>'process' AND task.state='claimed' AND task.lease_until<=clock_timestamp()) THEN CONTINUE; END IF;
  SELECT * INTO attempt FROM travel_map.processing_attempts WHERE id=task.attempt_id;
  SELECT * INTO slot FROM travel_map.upload_file_slots WHERE id=attempt.slot_id;
  SELECT * INTO photo FROM travel_map.photos WHERE id=task.photo_id;
  SELECT * INTO reservation FROM travel_map.quota_reservations WHERE id=attempt.reservation_id;
  IF task.generation<>attempt.generation OR slot.generation<>attempt.generation THEN CONTINUE; END IF;
  IF p_kind='process' THEN
   IF attempt.status<>'queued' OR reservation.status<>'active' OR reservation.expires_at<=clock_timestamp()
    OR photo.status<>'processing' OR NOT EXISTS(SELECT 1 FROM travel_map.users WHERE id=slot.actor_id AND status='active')
    OR travel_map.media_context(slot.actor_id,photo.visit_id) IS NULL THEN CONTINUE; END IF;
   UPDATE travel_map.processing_attempts SET status='claimed' WHERE id=attempt.id;
  ELSIF p_kind='cleanup' THEN
   IF attempt.status<>'fenced' OR photo.status<>'cleanup_pending' OR reservation.status<>'cleanup_pending' THEN CONTINUE; END IF;
  ELSIF p_kind='restore' THEN
   IF photo.status<>'restoring' OR photo.purge_after<=travel_map.media_retention_now() THEN CONTINUE; END IF;
  ELSE
   IF photo.status NOT IN ('trashed','restoring','purge_pending') OR photo.purge_after>travel_map.media_retention_now()
    OR attempt.status<>'finalized' THEN CONTINUE; END IF;
   UPDATE travel_map.photos SET status='purge_pending' WHERE id=photo.id;
   UPDATE travel_map.media_tasks SET state='fenced' WHERE photo_id=photo.id AND kind='restore' AND state IN ('pending','claimed');
  END IF;
  UPDATE travel_map.media_tasks SET state='claimed',claim_id=gen_random_uuid(),lease_until=clock_timestamp()+interval '5 minutes',claim_count=claim_count+1 WHERE id=task.id RETURNING * INTO task;
  SELECT jsonb_agg(jsonb_build_object('id',a.id,'variant',a.variant,'objectKey',a.object_key,'status',a.status,'byteLength',a.byte_length) ORDER BY a.variant) INTO assets
   FROM travel_map.photo_assets a WHERE a.attempt_id=attempt.id AND a.photo_id=photo.id;
  RETURN jsonb_build_object('id',task.id,'claimId',task.claim_id,'generation',task.generation,'kind',task.kind,'policyVersion','sanitized-v1','assets',assets);
 END LOOP;
 RETURN jsonb_build_object('idle',true);
END;
$$;

CREATE FUNCTION travel_map_jobs.record(p_task uuid,p_claim uuid,p_generation bigint,p_action text,p_evidence jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE task travel_map.media_tasks; attempt travel_map.processing_attempts; slot travel_map.upload_file_slots;
 photo travel_map.photos; reservation travel_map.quota_reservations; asset travel_map.photo_assets;
 item jsonb; total bigint; evidence_digest text; n integer;
BEGIN
 IF p_action NOT IN ('processed','writes_settled','absent','available') OR p_action IS NULL
  OR p_evidence IS NULL OR jsonb_typeof(p_evidence)<>'object' OR octet_length(p_evidence::text)>32768 THEN
  RETURN jsonb_build_object('error','VALIDATION_ERROR'); END IF;
 task:=travel_map.media_lock_task(p_task);
 IF task.id IS NULL OR task.claim_id IS DISTINCT FROM p_claim OR task.generation IS DISTINCT FROM p_generation
  OR task.state NOT IN ('claimed','completed') OR (task.state='claimed' AND task.lease_until<=clock_timestamp()) THEN
  RETURN jsonb_build_object('error','OPERATION_CONFLICT'); END IF;
 SELECT * INTO attempt FROM travel_map.processing_attempts WHERE id=task.attempt_id;
 SELECT * INTO slot FROM travel_map.upload_file_slots WHERE id=attempt.slot_id;
 SELECT * INTO photo FROM travel_map.photos WHERE id=task.photo_id;
 SELECT * INTO reservation FROM travel_map.quota_reservations WHERE id=attempt.reservation_id FOR UPDATE;
 IF task.generation<>attempt.generation OR slot.generation<>attempt.generation THEN RETURN jsonb_build_object('error','OPERATION_CONFLICT'); END IF;
 IF p_action='processed' THEN
  IF task.kind<>'process' THEN RETURN jsonb_build_object('error','OPERATION_CONFLICT'); END IF;
  evidence_digest:=encode(sha256(convert_to(p_evidence::text,'UTF8')),'hex');
  IF task.state='completed' THEN
   IF task.result_digest IS DISTINCT FROM evidence_digest OR photo.status NOT IN ('processing','active') THEN RETURN jsonb_build_object('error','OPERATION_CONFLICT'); END IF;
   RETURN '{}'::jsonb;
  END IF;
  IF photo.status<>'processing' OR attempt.status<>'claimed' OR reservation.status<>'active' OR reservation.expires_at<=clock_timestamp()
   OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_evidence) k WHERE k NOT IN ('assets','sanitizedPolicy','writesSettled'))
   OR p_evidence->>'sanitizedPolicy' IS DISTINCT FROM 'sanitized-v1' OR p_evidence->'writesSettled' IS DISTINCT FROM 'true'::jsonb
   OR jsonb_typeof(p_evidence->'assets') IS DISTINCT FROM 'array' THEN RETURN jsonb_build_object('error','VALIDATION_ERROR'); END IF;
  IF jsonb_array_length(p_evidence->'assets')<>3 OR
   (SELECT count(DISTINCT value->>'assetId') FROM jsonb_array_elements(p_evidence->'assets'))<>3 THEN RETURN jsonb_build_object('error','VALIDATION_ERROR'); END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_evidence->'assets') LOOP
   IF jsonb_typeof(item)<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(item) k WHERE k NOT IN ('assetId','contentType','byteLength','width','height','sha256'))
    OR jsonb_typeof(item->'byteLength') IS DISTINCT FROM 'number' OR jsonb_typeof(item->'width') IS DISTINCT FROM 'number' OR jsonb_typeof(item->'height') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'Invalid evidence shape' USING ERRCODE='23514'; END IF;
   UPDATE travel_map.photo_assets SET content_type=item->>'contentType',byte_length=(item->>'byteLength')::bigint,
    width=(item->>'width')::integer,height=(item->>'height')::integer,sha256=item->>'sha256',status='verified',verified_at=clock_timestamp()
    WHERE id=(item->>'assetId')::uuid AND attempt_id=attempt.id AND photo_id=photo.id AND status='expected';
   IF NOT FOUND THEN RAISE EXCEPTION 'Invalid evidence scope' USING ERRCODE='23514'; END IF;
  END LOOP;
  SELECT count(*),sum(byte_length) INTO n,total FROM travel_map.photo_assets WHERE attempt_id=attempt.id AND status='verified';
  IF n<>3 OR total>reservation.reserved_bytes THEN RAISE EXCEPTION 'Evidence exceeds reservation' USING ERRCODE='23514'; END IF;
  UPDATE travel_map.processing_attempts SET status='ready',writes_settled=true WHERE id=attempt.id;
  UPDATE travel_map.upload_file_slots SET status='ready' WHERE id=slot.id;
  UPDATE travel_map.media_tasks SET state='completed',completed_at=clock_timestamp(),result_digest=evidence_digest WHERE id=task.id;
  RETURN '{}'::jsonb;
 ELSIF p_action='writes_settled' THEN
  IF p_evidence<>'{}'::jsonb THEN RETURN jsonb_build_object('error','VALIDATION_ERROR'); END IF;
  IF task.kind<>'cleanup' OR attempt.status NOT IN ('fenced','cleaned') THEN RETURN jsonb_build_object('error','OPERATION_CONFLICT'); END IF;
  UPDATE travel_map.processing_attempts SET writes_settled=true WHERE id=attempt.id;
  RETURN '{}'::jsonb;
 ELSIF p_action='available' THEN
  IF task.kind<>'restore' OR photo.status<>'restoring' OR photo.purge_after<=travel_map.media_retention_now()
   OR task.id IS DISTINCT FROM (SELECT j.id FROM travel_map.media_tasks j WHERE j.photo_id=photo.id AND j.kind='restore' ORDER BY j.created_at DESC,j.id DESC LIMIT 1)
   OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_evidence) k WHERE k<>'assetIds')
   OR jsonb_typeof(p_evidence->'assetIds') IS DISTINCT FROM 'array' THEN RETURN jsonb_build_object('error','OPERATION_CONFLICT'); END IF;
  SELECT count(*) INTO n FROM travel_map.photo_assets WHERE attempt_id=attempt.id AND status='verified'
   AND id::text IN (SELECT value#>>'{}' FROM jsonb_array_elements(p_evidence->'assetIds'));
  IF n<>3 OR jsonb_array_length(p_evidence->'assetIds')<>3 THEN RETURN jsonb_build_object('error','VALIDATION_ERROR'); END IF;
  UPDATE travel_map.photo_assets SET availability_verified_at=clock_timestamp() WHERE attempt_id=attempt.id;
  UPDATE travel_map.media_tasks SET state='completed',completed_at=clock_timestamp() WHERE id=task.id;
  RETURN '{}'::jsonb;
 END IF;
 -- Absence confirmation accepts a RECORDED asset ID only, never a path/key/URL.
 IF task.kind NOT IN ('cleanup','purge') OR (task.kind='cleanup' AND (photo.status NOT IN ('cleanup_pending','failed') OR NOT attempt.writes_settled))
  OR (task.kind='purge' AND (photo.status NOT IN ('purge_pending','purged') OR photo.purge_after>travel_map.media_retention_now()))
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_evidence) k WHERE k<>'assetId') THEN RETURN jsonb_build_object('error','OPERATION_CONFLICT'); END IF;
 SELECT * INTO asset FROM travel_map.photo_assets WHERE id=(p_evidence->>'assetId')::uuid AND photo_id=photo.id AND attempt_id=attempt.id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('error','OPERATION_CONFLICT'); END IF;
 IF asset.status<>'deleted' THEN
  UPDATE travel_map.photo_assets SET status='deleted',deleted_at=clock_timestamp() WHERE id=asset.id;
  IF task.kind='purge' THEN
   UPDATE travel_map.user_media_quotas SET used_bytes=used_bytes-asset.byte_length,updated_at=clock_timestamp() WHERE user_id=photo.quota_user_id;
  END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM travel_map.photo_assets WHERE attempt_id=attempt.id AND status<>'deleted') THEN RETURN '{}'::jsonb; END IF;
 IF task.state='completed' THEN RETURN '{}'::jsonb; END IF;
 IF task.kind='cleanup' THEN
  IF reservation.status<>'cleanup_pending' THEN RETURN jsonb_build_object('error','OPERATION_CONFLICT'); END IF;
  UPDATE travel_map.user_media_quotas SET reserved_bytes=reserved_bytes-reservation.reserved_bytes,updated_at=clock_timestamp() WHERE user_id=photo.quota_user_id;
  UPDATE travel_map.quota_reservations SET status='released',settlement_id=gen_random_uuid(),settled_at=clock_timestamp() WHERE id=reservation.id;
  UPDATE travel_map.processing_attempts SET status='cleaned' WHERE id=attempt.id;
  UPDATE travel_map.upload_file_slots SET status='failed' WHERE id=slot.id;
  UPDATE travel_map.photos SET status='failed' WHERE id=photo.id;
 ELSE UPDATE travel_map.photos SET status='purged',purged_at=clock_timestamp() WHERE id=photo.id; END IF;
 UPDATE travel_map.media_tasks SET state='completed',completed_at=clock_timestamp() WHERE id=task.id;
 INSERT INTO travel_map.domain_audit_events(actor_id,technical_principal,resource_id,resource_type,action,metadata)
  VALUES(NULL,'media_maintenance',photo.id,'photo',CASE task.kind WHEN 'cleanup' THEN 'photo_cleanup_completed' ELSE 'photo_purged' END,'{}');
 RETURN '{}'::jsonb;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR check_violation OR not_null_violation THEN
 RETURN jsonb_build_object('error','VALIDATION_ERROR');
 WHEN unique_violation OR serialization_failure OR deadlock_detected OR lock_not_available THEN RETURN jsonb_build_object('error','OPERATION_CONFLICT');
END;
$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA travel_map_jobs FROM PUBLIC;
GRANT EXECUTE ON FUNCTION travel_map_jobs.claim(text),travel_map_jobs.record(uuid,uuid,bigint,text,jsonb) TO travel_map_media_maintenance;
REVOKE ALL ON FUNCTION travel_map.media_photo_guard(),travel_map.media_manifest_guard(),travel_map.media_context(uuid,uuid),
 travel_map.media_photo_dto(travel_map.photos),travel_map.media_action(uuid,text,jsonb,uuid),travel_map.media_link_guard(),
 travel_map.media_slot_bound(),travel_map.media_lock_task(uuid) FROM PUBLIC;

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
      'storage',COALESCE((SELECT jsonb_build_object('usedBytes',q.used_bytes,'reservedBytes',q.reserved_bytes,'quotaBytes',q.limit_bytes) FROM travel_map.user_media_quotas q WHERE q.user_id=account.id),jsonb_build_object('usedBytes',0,'reservedBytes',0,'quotaBytes',500000000)));
  ELSIF p_action LIKE 'media.%' THEN
    RETURN travel_map.media_action(account.id,p_action,p_data,session.id);
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
REVOKE ALL ON FUNCTION travel_map.media_retention_now(),travel_map.media_resource_guard(),travel_map.media_operation_sync() FROM PUBLIC;
DO $postflight$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace,
  LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a
  WHERE n.nspname='travel_map' AND c.relname IN ('photos','photo_assets','user_media_quotas','upload_operations','upload_file_slots','quota_reservations','processing_attempts','media_tasks') AND a.grantee<>c.relowner)
 OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace,
  LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
  WHERE n.nspname='travel_map' AND p.proname LIKE 'media_%' AND a.grantee<>p.proowner)
 THEN RAISE EXCEPTION 'Private media ACL required' USING ERRCODE='42501'; END IF;
END;
$postflight$;
