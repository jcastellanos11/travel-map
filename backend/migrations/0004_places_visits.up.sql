-- E2.2 only; no auth or E2.1 permission changes.
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
CREATE TABLE travel_map.country_codes (
  code text PRIMARY KEY CHECK (code ~ '^[A-Z]{3}$'),
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 200),
  source text NOT NULL
);
CREATE TABLE travel_map.places (
  id uuid PRIMARY KEY,
  country_code text NOT NULL REFERENCES travel_map.country_codes(code) ON DELETE RESTRICT,
  locality text NOT NULL CHECK (char_length(btrim(locality)) BETWEEN 1 AND 200),
  region text CHECK (char_length(region)<=200),
  approximate_latitude double precision,
  approximate_longitude double precision,
  source_provider text,
  source_id text,
  source_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((approximate_latitude IS NULL)=(approximate_longitude IS NULL)),
  CHECK (approximate_latitude BETWEEN -90 AND 90 AND approximate_longitude BETWEEN -180 AND 180),
  CHECK ((source_provider IS NULL)=(source_id IS NULL)),
  UNIQUE(source_provider,source_id)
);
CREATE INDEX places_country_page_idx ON travel_map.places(country_code,created_at,id);
CREATE TABLE travel_map.visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES travel_map.trips(id) ON DELETE RESTRICT,
  place_id uuid NOT NULL REFERENCES travel_map.places(id) ON DELETE RESTRICT,
  created_by_user_id uuid NOT NULL REFERENCES travel_map.users(id) ON DELETE RESTRICT,
  name text CHECK (char_length(btrim(name)) BETWEEN 1 AND 200 AND name !~ '[[:cntrl:]]'),
  date_mode text NOT NULL DEFAULT 'none' CHECK (date_mode IN ('none','single','range')),
  date_start date,
  date_end date,
  exact_latitude double precision,
  exact_longitude double precision,
  exact_confirmed_at timestamptz,
  exact_confirmed_by uuid REFERENCES travel_map.users(id) ON DELETE RESTRICT,
  exact_visibility text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived','deletion_requested','deleted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  deleted_at timestamptz,
  CHECK ((date_mode='none' AND date_start IS NULL AND date_end IS NULL)
    OR (date_mode='single' AND date_start IS NOT NULL AND date_end IS NOT NULL AND date_start=date_end)
    OR (date_mode='range' AND date_start IS NOT NULL AND date_end IS NOT NULL AND date_start<=date_end)),
  CHECK (date_start BETWEEN DATE '0001-01-01' AND DATE '9999-12-31' AND date_end BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'),
  CHECK ((exact_latitude IS NULL)=(exact_longitude IS NULL)),
  CHECK (exact_latitude BETWEEN -90 AND 90 AND exact_longitude BETWEEN -180 AND 180),
  -- Privacy gate: no consent visibility/reconfirmation policy is approved yet.
  -- This fails closed even for direct SQL; future enablement requires migration.
  CONSTRAINT visits_exact_disabled CHECK (exact_latitude IS NULL AND exact_longitude IS NULL
    AND exact_confirmed_at IS NULL AND exact_confirmed_by IS NULL AND exact_visibility IS NULL),
  CHECK ((status='deleted')=(deleted_at IS NOT NULL)),
  CHECK (status<>'archived' OR archived_at IS NOT NULL),
  CHECK (archived_at IS NULL OR archived_at>=created_at),
  CHECK (deleted_at IS NULL OR deleted_at>=created_at)
);
CREATE INDEX visits_trip_page_idx ON travel_map.visits(trip_id,created_at,id) WHERE status='active';
CREATE INDEX visits_trip_dates_idx ON travel_map.visits(trip_id,date_start,date_end) WHERE status='active';
CREATE INDEX visits_place_idx ON travel_map.visits(place_id);
CREATE INDEX visits_creator_idx ON travel_map.visits(created_by_user_id);
CREATE INDEX visits_exact_confirmer_idx ON travel_map.visits(exact_confirmed_by) WHERE exact_confirmed_by IS NOT NULL;
CREATE TRIGGER visits_touch BEFORE UPDATE ON travel_map.visits FOR EACH ROW EXECUTE FUNCTION travel_map.touch_updated_at();
ALTER TABLE travel_map.country_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE travel_map.country_codes FORCE ROW LEVEL SECURITY;
ALTER TABLE travel_map.places ENABLE ROW LEVEL SECURITY;
ALTER TABLE travel_map.places FORCE ROW LEVEL SECURITY;
ALTER TABLE travel_map.visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE travel_map.visits FORCE ROW LEVEL SECURITY;
CREATE POLICY country_codes_owner ON travel_map.country_codes TO CURRENT_USER USING(true) WITH CHECK(true);
CREATE POLICY places_owner ON travel_map.places TO CURRENT_USER USING(true) WITH CHECK(true);
CREATE POLICY visits_owner ON travel_map.visits TO CURRENT_USER USING(true) WITH CHECK(true);
REVOKE ALL ON travel_map.country_codes,travel_map.places,travel_map.visits FROM PUBLIC;

CREATE FUNCTION travel_map.place_dto(value travel_map.places) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog SET timezone='UTC' AS $$
  SELECT jsonb_build_object('id',value.id,'countryCode',value.country_code,
    'countryName',(SELECT display_name FROM travel_map.country_codes WHERE code=value.country_code),
    'city',value.locality,'region',value.region,'createdAt',value.created_at,
    'approximateCoordinates',CASE WHEN value.approximate_latitude IS NULL THEN NULL ELSE
      jsonb_build_object('lat',value.approximate_latitude,'lng',value.approximate_longitude) END,
    'source',jsonb_build_object('provider',value.source_provider,'id',value.source_id,'url',value.source_url));
$$;
CREATE FUNCTION travel_map.visit_dto(value travel_map.visits) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog SET timezone='UTC' AS $$
  SELECT jsonb_build_object('id',value.id,'tripId',value.trip_id,'placeId',value.place_id,
    'createdByUserId',value.created_by_user_id,'name',value.name,'status',value.status,
    'place',(SELECT travel_map.place_dto(p) FROM travel_map.places p WHERE p.id=value.place_id),
    'confirmedCoordinates',NULL,'date',jsonb_build_object('mode',value.date_mode,
      'start',to_char(value.date_start,'YYYY-MM-DD'),'end',to_char(value.date_end,'YYYY-MM-DD')),
    'photoCount',0,'previewPhotoId',NULL,'createdAt',value.created_at,'updatedAt',value.updated_at);
$$;
CREATE FUNCTION travel_map.valid_calendar(value text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog SET timezone='UTC' AS $$
BEGIN
  IF value IS NULL OR value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR left(value,4)='0000' THEN RETURN false; END IF;
  RETURN to_char(value::date,'YYYY-MM-DD')=value;
EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN RETURN false;
END;
$$;
CREATE FUNCTION travel_map.valid_visit_date(value jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog SET timezone='UTC' AS $$
BEGIN
  IF value IS NULL OR jsonb_typeof(value)<>'object' OR NOT value ?& ARRAY['mode','start','end']
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(value) k WHERE k NOT IN ('mode','start','end')) THEN RETURN false; END IF;
  IF value->>'mode'='none' THEN RETURN value->'start'='null'::jsonb AND value->'end'='null'::jsonb; END IF;
  IF jsonb_typeof(value->'start')<>'string' OR jsonb_typeof(value->'end')<>'string'
    OR NOT travel_map.valid_calendar(value->>'start') OR NOT travel_map.valid_calendar(value->>'end') THEN RETURN false; END IF;
  RETURN CASE value->>'mode' WHEN 'single' THEN value->>'start'=value->>'end'
    WHEN 'range' THEN (value->>'start')::date<=(value->>'end')::date ELSE false END;
END;
$$;

CREATE FUNCTION travel_map.geography_action(p_actor uuid,p_action text,p_data jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE allowed_keys text[]; page_limit integer:=25; cursor_time timestamptz; cursor_id uuid;
  parent travel_map.projects; item travel_map.visits; parent_id uuid; scope_trip uuid; visit_id uuid;
  role_name text; scope_result jsonb; items jsonb; country text; search_text text:='';
  filter_from date; filter_to date; chosen_place uuid; dates jsonb; visit_name text;
BEGIN
  IF p_data IS NULL OR jsonb_typeof(p_data)<>'object' OR octet_length(p_data::text)>32768 THEN
    RETURN jsonb_build_object('error','VALIDATION_ERROR'); END IF;
  CASE p_action
    WHEN 'places.list' THEN allowed_keys:=ARRAY['countryCode','query','limit','cursorTime','cursorId'];
    WHEN 'visits.list' THEN allowed_keys:=ARRAY['tripId','limit','cursorTime','cursorId'];
    WHEN 'visits.create' THEN allowed_keys:=ARRAY['tripId','placeId','name','date','confirmedCoordinates'];
    WHEN 'visits.get' THEN allowed_keys:=ARRAY['id'];
    WHEN 'visits.update' THEN allowed_keys:=ARRAY['id','placeId','name','date','confirmedCoordinates'];
    WHEN 'maps.project' THEN allowed_keys:=ARRAY['projectId','tripId','countryCode','from','to','limit','cursorTime','cursorId'];
    WHEN 'maps.trip' THEN allowed_keys:=ARRAY['tripId','countryCode','from','to','limit','cursorTime','cursorId'];
    ELSE RETURN jsonb_build_object('error','RESOURCE_NOT_FOUND');
  END CASE;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_data) k WHERE k<>ALL(allowed_keys)) THEN
    RETURN jsonb_build_object('error','VALIDATION_ERROR'); END IF;
  -- UUID validation also applies to direct RPC callers, not just HTTP paths.
  IF EXISTS(SELECT 1 FROM jsonb_each(p_data) e WHERE e.key IN ('id','projectId','tripId','placeId')
    AND (jsonb_typeof(e.value)<>'string' OR (e.value#>>'{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')) THEN
    RETURN jsonb_build_object('error','VALIDATION_ERROR'); END IF;
  IF p_action LIKE 'visits.%' AND p_action IN ('visits.get','visits.update') THEN
    IF NOT p_data?'id' THEN RETURN jsonb_build_object('error','VALIDATION_ERROR'); END IF;
    visit_id:=(p_data->>'id')::uuid;
    SELECT trip_id INTO scope_trip FROM travel_map.visits WHERE id=visit_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('error','RESOURCE_NOT_FOUND'); END IF;
  ELSIF p_action<>'places.list' AND p_action<>'maps.project' THEN
    IF NOT p_data?'tripId' THEN RETURN jsonb_build_object('error','VALIDATION_ERROR'); END IF;
    scope_trip:=(p_data->>'tripId')::uuid;
  END IF;
  IF scope_trip IS NOT NULL THEN
    -- Reuse E2.1's exact ancestry, lifecycle, inherited and guest authorization.
    -- Its parent/trip/membership locks are held through this transaction.
    scope_result:=travel_map.trips_action(p_actor,'trips.get',jsonb_build_object('id',scope_trip));
    IF scope_result?'error' THEN RETURN scope_result; END IF;
    parent_id:=(scope_result->>'projectId')::uuid;
    SELECT * INTO parent FROM travel_map.projects WHERE id=parent_id;
    IF parent.owner_user_id=p_actor THEN role_name:='owner';
    ELSE SELECT role INTO role_name FROM travel_map.project_memberships WHERE project_id=parent_id AND user_id=p_actor AND status='active'; END IF;
  ELSIF p_action='maps.project' THEN
    IF NOT p_data?'projectId' THEN RETURN jsonb_build_object('error','VALIDATION_ERROR'); END IF;
    parent_id:=(p_data->>'projectId')::uuid;
    SELECT * INTO parent FROM travel_map.projects WHERE id=parent_id AND status='active' FOR SHARE;
    IF NOT FOUND THEN RETURN jsonb_build_object('error','RESOURCE_NOT_FOUND'); END IF;
    IF parent.owner_user_id=p_actor THEN role_name:='owner';
    ELSE SELECT role INTO role_name FROM travel_map.project_memberships WHERE project_id=parent_id AND user_id=p_actor AND status='active' FOR SHARE; END IF;
    IF role_name IS NULL THEN RETURN jsonb_build_object('error','RESOURCE_NOT_FOUND'); END IF;
    IF p_data?'tripId' THEN
      scope_trip:=(p_data->>'tripId')::uuid;
      PERFORM 1 FROM travel_map.trips WHERE id=scope_trip AND project_id=parent_id AND status='active' FOR SHARE;
      IF NOT FOUND THEN RETURN jsonb_build_object('error','RESOURCE_NOT_FOUND'); END IF;
    END IF;
  END IF;
  IF visit_id IS NOT NULL THEN
    IF p_action='visits.update' THEN
      SELECT * INTO item FROM travel_map.visits WHERE id=visit_id AND trip_id=scope_trip AND status='active' FOR UPDATE;
    ELSE SELECT * INTO item FROM travel_map.visits WHERE id=visit_id AND trip_id=scope_trip AND status='active' FOR SHARE; END IF;
    IF NOT FOUND THEN RETURN jsonb_build_object('error','RESOURCE_NOT_FOUND'); END IF;
    IF p_action='visits.get' THEN RETURN travel_map.visit_dto(item); END IF;
    IF item.created_by_user_id<>p_actor AND role_name IS DISTINCT FROM 'owner' AND role_name IS DISTINCT FROM 'admin' THEN
      RETURN jsonb_build_object('error','ACTION_FORBIDDEN'); END IF;
  END IF;
  IF p_action IN ('visits.create','visits.update') THEN
    IF p_action='visits.create' AND NOT p_data?'placeId' THEN RETURN jsonb_build_object('error','VALIDATION_ERROR'); END IF;
    IF p_action='visits.update' AND NOT (p_data?|ARRAY['placeId','name','date','confirmedCoordinates']) THEN RETURN jsonb_build_object('error','VALIDATION_ERROR'); END IF;
    IF p_data?'confirmedCoordinates' AND p_data->'confirmedCoordinates'<>'null'::jsonb THEN
      RETURN jsonb_build_object('error','VALIDATION_ERROR'); END IF;
    IF p_data?'name' AND p_data->'name'<>'null'::jsonb AND (jsonb_typeof(p_data->'name')<>'string'
      OR char_length(btrim(p_data->>'name')) NOT BETWEEN 1 AND 200 OR (p_data->>'name') ~ '[[:cntrl:]]') THEN RETURN jsonb_build_object('error','VALIDATION_ERROR'); END IF;
    chosen_place:=CASE WHEN p_data?'placeId' THEN (p_data->>'placeId')::uuid ELSE item.place_id END;
    PERFORM 1 FROM travel_map.places WHERE id=chosen_place;
    IF NOT FOUND THEN RETURN jsonb_build_object('error','VALIDATION_ERROR'); END IF;
    dates:=CASE WHEN p_data?'date' THEN p_data->'date' WHEN p_action='visits.create' THEN '{"mode":"none","start":null,"end":null}'::jsonb
      ELSE jsonb_build_object('mode',item.date_mode,'start',to_char(item.date_start,'YYYY-MM-DD'),'end',to_char(item.date_end,'YYYY-MM-DD')) END;
    IF NOT travel_map.valid_visit_date(dates) THEN RETURN jsonb_build_object('error','VALIDATION_ERROR'); END IF;
    visit_name:=CASE WHEN p_data?'name' THEN btrim(p_data->>'name') ELSE item.name END;
    IF p_action='visits.create' THEN
      INSERT INTO travel_map.visits(trip_id,place_id,created_by_user_id,name,date_mode,date_start,date_end)
        VALUES(scope_trip,chosen_place,p_actor,visit_name,dates->>'mode',(dates->>'start')::date,(dates->>'end')::date) RETURNING * INTO item;
    ELSE
      UPDATE travel_map.visits SET place_id=chosen_place,name=visit_name,date_mode=dates->>'mode',
        date_start=(dates->>'start')::date,date_end=(dates->>'end')::date WHERE id=visit_id RETURNING * INTO item;
    END IF;
    RETURN travel_map.visit_dto(item);
  END IF;
  IF p_data?'countryCode' THEN
    IF jsonb_typeof(p_data->'countryCode')<>'string' THEN RETURN jsonb_build_object('error','VALIDATION_ERROR'); END IF;
    country:=p_data->>'countryCode';
    IF country !~ '^[A-Z]{3}$' OR NOT EXISTS(SELECT 1 FROM travel_map.country_codes WHERE code=country) THEN
      RETURN jsonb_build_object('error','VALIDATION_ERROR'); END IF;
  ELSIF p_action='places.list' THEN RETURN jsonb_build_object('error','VALIDATION_ERROR'); END IF;
  IF p_data?'query' THEN
    IF jsonb_typeof(p_data->'query')<>'string' OR char_length(p_data->>'query')>100 OR (p_data->>'query') ~ '[[:cntrl:]]' THEN
      RETURN jsonb_build_object('error','VALIDATION_ERROR'); END IF;
    search_text:=btrim(p_data->>'query');
  END IF;
  IF p_data?'from' THEN
    IF jsonb_typeof(p_data->'from')<>'string' OR NOT travel_map.valid_calendar(p_data->>'from') THEN RETURN jsonb_build_object('error','VALIDATION_ERROR'); END IF;
    filter_from:=(p_data->>'from')::date;
  END IF;
  IF p_data?'to' THEN
    IF jsonb_typeof(p_data->'to')<>'string' OR NOT travel_map.valid_calendar(p_data->>'to') THEN RETURN jsonb_build_object('error','VALIDATION_ERROR'); END IF;
    filter_to:=(p_data->>'to')::date;
  END IF;
  IF filter_from>filter_to THEN RETURN jsonb_build_object('error','VALIDATION_ERROR'); END IF;
  IF p_data?'limit' THEN
    IF jsonb_typeof(p_data->'limit')<>'number' OR (p_data->>'limit') !~ '^[0-9]{1,3}$' THEN RETURN jsonb_build_object('error','VALIDATION_ERROR'); END IF;
    page_limit:=(p_data->>'limit')::integer;
    IF page_limit NOT BETWEEN 1 AND 100 THEN RETURN jsonb_build_object('error','VALIDATION_ERROR'); END IF;
  END IF;
  IF (p_data?'cursorTime')<>(p_data?'cursorId') THEN RETURN jsonb_build_object('error','VALIDATION_ERROR'); END IF;
  IF p_data?'cursorTime' THEN
    IF jsonb_typeof(p_data->'cursorTime')<>'string' OR jsonb_typeof(p_data->'cursorId')<>'string'
      OR (p_data->>'cursorTime') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?(Z|[+]00:00)$'
      OR (p_data->>'cursorId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN jsonb_build_object('error','VALIDATION_ERROR'); END IF;
    cursor_time:=(p_data->>'cursorTime')::timestamptz;cursor_id:=(p_data->>'cursorId')::uuid;
  END IF;
  IF p_action='places.list' THEN
    SELECT COALESCE(jsonb_agg(dto ORDER BY created_at,id),'[]'::jsonb) INTO items FROM (
      SELECT p.id,p.created_at,travel_map.place_dto(p) AS dto FROM travel_map.places p
      WHERE p.country_code=country AND strpos(lower(p.locality),lower(search_text))>0
      AND (cursor_time IS NULL OR (p.created_at,p.id)>(cursor_time,cursor_id)) ORDER BY p.created_at,p.id LIMIT page_limit+1
    ) page;
  ELSE
    SELECT COALESCE(jsonb_agg(dto ORDER BY created_at,id),'[]'::jsonb) INTO items FROM (
      SELECT v.id,v.created_at,CASE WHEN p_action LIKE 'maps.%' THEN
        (travel_map.visit_dto(v)-ARRAY['id','createdByUserId','name','status','updatedAt','placeId'])||jsonb_build_object('visitId',v.id)
        ELSE travel_map.visit_dto(v) END AS dto
      FROM travel_map.visits v JOIN travel_map.trips t ON t.id=v.trip_id JOIN travel_map.places p ON p.id=v.place_id
      WHERE t.project_id=parent_id AND t.status='active' AND v.status='active'
        AND (scope_trip IS NULL OR v.trip_id=scope_trip) AND (country IS NULL OR p.country_code=country)
        AND (filter_from IS NULL OR v.date_end>=filter_from) AND (filter_to IS NULL OR v.date_start<=filter_to)
        AND (cursor_time IS NULL OR (v.created_at,v.id)>(cursor_time,cursor_id))
      ORDER BY v.created_at,v.id LIMIT page_limit+1
    ) page;
  END IF;
  RETURN jsonb_build_object('items',items);
EXCEPTION
  WHEN invalid_text_representation OR datetime_field_overflow OR invalid_datetime_format OR check_violation OR not_null_violation THEN RETURN jsonb_build_object('error','VALIDATION_ERROR');
  WHEN unique_violation OR serialization_failure OR deadlock_detected OR lock_not_available THEN RETURN jsonb_build_object('error','OPERATION_CONFLICT');
END;
$$;
REVOKE ALL ON FUNCTION travel_map.place_dto(travel_map.places),travel_map.visit_dto(travel_map.visits),
  travel_map.valid_calendar(text),travel_map.valid_visit_date(jsonb),travel_map.geography_action(uuid,text,jsonb) FROM PUBLIC;

-- Independently sourced, limited GeoNames snapshot. See catalog/README.md.
INSERT INTO travel_map.country_codes(code,display_name,source) VALUES
('COL','Colombia','GeoNames countryInfo; CC-BY-4.0'),
('TUR','Turkey','GeoNames countryInfo; CC-BY-4.0'),
('USA','United States','GeoNames countryInfo; CC-BY-4.0');
INSERT INTO travel_map.places(id,country_code,locality,region,approximate_latitude,approximate_longitude,source_provider,source_id,source_url,created_at) VALUES
('e741c61b-8011-59ac-9d6d-423b6ff10a83','COL','Medellín','02',6.25,-75.57,'geonames','3674962','https://www.geonames.org/3674962','2026-11-04T00:00:00Z'),
('44576a98-98a4-55e0-b879-360717211efb','COL','Bogotá','34',4.61,-74.08,'geonames','3688689','https://www.geonames.org/3688689','2026-11-04T00:00:00Z'),
('7d8727d6-10fc-54bb-ba98-c02610174c68','TUR','Ankara','68',39.92,32.85,'geonames','323786','https://www.geonames.org/323786','2026-11-04T00:00:00Z'),
('27f6811e-193a-53eb-b5e9-98a92a752986','TUR','Istanbul','34',41.01,28.95,'geonames','745044','https://www.geonames.org/745044','2026-11-04T00:00:00Z'),
('bcda7373-0441-5676-8e24-495131dc8d8e','USA','Springfield','IL',39.8,-89.64,'geonames','4250542','https://www.geonames.org/4250542','2026-11-04T00:00:00Z'),
('5a19d105-e882-51ba-b1b7-b2555218f351','USA','Springfield','MA',42.1,-72.59,'geonames','4951788','https://www.geonames.org/4951788','2026-11-04T00:00:00Z');
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
DO $acl_check$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace,
  LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a
  WHERE n.nspname='travel_map' AND c.relname IN ('country_codes','places','visits') AND a.grantee<>c.relowner)
 OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace,
  LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
  WHERE n.nspname='travel_map' AND p.proname IN ('place_dto','visit_dto','valid_calendar','valid_visit_date','geography_action') AND a.grantee<>p.proowner) THEN
  RAISE EXCEPTION 'Default privileges expose private E2.2 objects' USING ERRCODE='42501'; END IF;
END;
$acl_check$;
