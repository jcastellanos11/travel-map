-- Destructive: local disposable databases only. No CASCADE/third-party schemas.
DROP TABLE travel_map.app_sessions;
DROP TABLE travel_map.project_memberships;
DROP TABLE travel_map.projects;
DROP TABLE travel_map.users;
DROP FUNCTION travel_map.protect_project_owner();
DROP FUNCTION travel_map.check_project_owner();
DROP FUNCTION travel_map.check_membership_owner();
DROP FUNCTION travel_map.touch_updated_at();
DROP SCHEMA travel_map;
