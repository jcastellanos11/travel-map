CREATE TABLE travel_map.oauth_transactions (
  state_digest text PRIMARY KEY CHECK (state_digest ~ '^[0-9a-f]{64}$'),
  rate_key text NOT NULL CHECK (rate_key ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL DEFAULT clock_timestamp() + interval '10 minutes',
  consumed_at timestamptz,
  completed_at timestamptz
);
CREATE INDEX oauth_rate_idx ON travel_map.oauth_transactions(rate_key, created_at);
ALTER TABLE travel_map.oauth_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE travel_map.oauth_transactions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON travel_map.oauth_transactions FROM PUBLIC;

-- Only the trusted migration/function owner receives these policies. Runtime
-- connections get EXECUTE on the narrow functions, NEVER this owner's role.
CREATE POLICY identity_owner ON travel_map.users TO CURRENT_USER USING (true) WITH CHECK (true);
CREATE POLICY identity_owner ON travel_map.projects TO CURRENT_USER USING (true) WITH CHECK (true);
CREATE POLICY identity_owner ON travel_map.project_memberships TO CURRENT_USER USING (true) WITH CHECK (true);
CREATE POLICY identity_owner ON travel_map.app_sessions TO CURRENT_USER USING (true) WITH CHECK (true);
CREATE POLICY identity_owner ON travel_map.oauth_transactions TO CURRENT_USER USING (true) WITH CHECK (true);

CREATE FUNCTION travel_map.oauth_begin(p_state text, p_rate text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog SET timezone = 'UTC' AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_rate, 41));
  DELETE FROM travel_map.oauth_transactions WHERE state_digest IN
    (SELECT state_digest FROM travel_map.oauth_transactions WHERE expires_at < clock_timestamp() LIMIT 1000);
  IF (SELECT count(*) FROM travel_map.oauth_transactions WHERE rate_key = p_rate
    AND created_at > clock_timestamp() - interval '1 minute') >= 10
    OR (SELECT count(*) FROM travel_map.oauth_transactions) >= 10000 THEN RETURN false; END IF;
  INSERT INTO travel_map.oauth_transactions(state_digest,rate_key) VALUES(p_state,p_rate);
  RETURN true;
END;
$$;

CREATE FUNCTION travel_map.oauth_consume(p_state text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog SET timezone = 'UTC' AS $$
BEGIN
  UPDATE travel_map.oauth_transactions SET consumed_at = clock_timestamp()
    WHERE state_digest = p_state AND consumed_at IS NULL AND expires_at > clock_timestamp();
  RETURN FOUND;
END;
$$;

CREATE FUNCTION travel_map.login_complete(p_state text, p_identity jsonb, p_token text, p_old text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog SET timezone = 'UTC' AS $$
DECLARE account travel_map.users; stamp timestamptz := clock_timestamp();
BEGIN
  -- Caller is the trusted Worker after PKCE + live getUser verification.
  UPDATE travel_map.oauth_transactions SET completed_at = stamp
    WHERE state_digest = p_state AND consumed_at IS NOT NULL AND completed_at IS NULL AND expires_at > stamp;
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO travel_map.users(supabase_auth_user_id, display_name, email)
    VALUES ((p_identity->>'id')::uuid, p_identity->>'displayName', p_identity->>'email')
    ON CONFLICT (supabase_auth_user_id) DO UPDATE SET
      display_name = EXCLUDED.display_name, email = EXCLUDED.email
      WHERE travel_map.users.status = 'active'
    RETURNING * INTO account;
  IF account.id IS NULL OR account.status <> 'active' THEN RETURN false; END IF;
  UPDATE travel_map.app_sessions SET revoked_at = stamp WHERE token_digest = p_old AND revoked_at IS NULL;
  INSERT INTO travel_map.app_sessions(user_id,token_digest,created_at,last_seen_at,expires_at,idle_expires_at)
    VALUES(account.id,p_token,stamp,stamp,stamp+interval '7 days',stamp+interval '30 minutes');
  RETURN true;
END;
$$;

CREATE FUNCTION travel_map.api_call(p_token text, p_action text, p_data jsonb DEFAULT '{}')
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

REVOKE ALL ON FUNCTION travel_map.oauth_begin(text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION travel_map.oauth_consume(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION travel_map.login_complete(text,jsonb,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION travel_map.api_call(text,text,jsonb) FROM PUBLIC;
