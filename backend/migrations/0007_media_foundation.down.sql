-- Disposable marked databases only; never destructive rollback of media history.
DO $guard$
BEGIN
 IF current_database() !~ '^travel_map_test_e41_[a-f0-9]+$'
  OR inet_server_addr() IS NULL OR inet_server_addr() NOT IN ('127.0.0.1'::inet,'::1'::inet)
  OR NOT EXISTS(SELECT 1 FROM pg_database WHERE datname=current_database() AND shobj_description(oid,'pg_database') LIKE 'travel-map:e41:disposable:%')
  OR current_user<>(SELECT rolname FROM pg_roles WHERE oid=(SELECT proowner FROM pg_proc WHERE oid='travel_map.api_call(text,text,jsonb)'::regprocedure)) THEN
  RAISE EXCEPTION 'Verified disposable owner database required' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM travel_map.photos) OR EXISTS(SELECT 1 FROM travel_map.upload_operations)
  OR EXISTS(SELECT 1 FROM travel_map.user_media_quotas WHERE used_bytes<>0 OR reserved_bytes<>0)
  OR EXISTS(SELECT 1 FROM travel_map.domain_audit_events WHERE resource_type='photo') THEN
  RAISE EXCEPTION 'Media history requires retention-aware recovery, not rollback' USING ERRCODE='55000'; END IF;
END;
$guard$;
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
DROP SCHEMA travel_map_jobs CASCADE;
DROP FUNCTION travel_map.media_action(uuid,text,jsonb,uuid),travel_map.media_photo_dto(travel_map.photos),travel_map.media_context(uuid,uuid),travel_map.media_lock_task(uuid);
DROP TABLE travel_map.media_tasks,travel_map.photo_assets,travel_map.processing_attempts,travel_map.quota_reservations,travel_map.upload_file_slots,travel_map.upload_operations,travel_map.photos,travel_map.user_media_quotas;
DROP FUNCTION travel_map.media_photo_guard(),travel_map.media_manifest_guard(),travel_map.media_link_guard(),travel_map.media_slot_bound(),travel_map.media_retention_now(),travel_map.media_resource_guard(),travel_map.media_operation_sync();
ALTER TABLE travel_map.domain_audit_events DROP CONSTRAINT domain_audit_actor_kind;
ALTER TABLE travel_map.domain_audit_events DROP COLUMN technical_principal;
ALTER TABLE travel_map.domain_audit_events ALTER COLUMN actor_id SET NOT NULL;
ALTER TABLE travel_map.domain_audit_events DROP CONSTRAINT domain_audit_events_resource_type_check,DROP CONSTRAINT domain_audit_events_action_check,DROP CONSTRAINT domain_audit_events_check;
ALTER TABLE travel_map.domain_audit_events ADD CONSTRAINT domain_audit_events_resource_type_check CHECK(resource_type IN ('project','trip'));
ALTER TABLE travel_map.domain_audit_events ADD CONSTRAINT domain_audit_events_action_check CHECK(action IN ('member_promoted','admin_demoted','member_removed','project_left','guest_removed','trip_left','project_settings_changed','project_archived','invitation_issued','invitation_revoked','invitation_redeemed'));
ALTER TABLE travel_map.domain_audit_events ADD CONSTRAINT domain_audit_events_check CHECK(action LIKE 'invitation_%' OR (resource_type='trip')=(action IN ('guest_removed','trip_left')));
