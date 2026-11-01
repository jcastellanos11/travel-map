DROP FUNCTION travel_map.api_call(text,text,jsonb);
DROP FUNCTION travel_map.login_complete(text,jsonb,text,text);
DROP FUNCTION travel_map.oauth_consume(text);
DROP FUNCTION travel_map.oauth_begin(text,text);
DROP POLICY identity_owner ON travel_map.app_sessions;
DROP POLICY identity_owner ON travel_map.project_memberships;
DROP POLICY identity_owner ON travel_map.projects;
DROP POLICY identity_owner ON travel_map.users;
DROP TABLE travel_map.oauth_transactions;
