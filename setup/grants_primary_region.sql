-- ============================================================
-- VARIABLES — Set these values before running
-- ============================================================
DECLARE OR REPLACE VARIABLE v_principal       STRING DEFAULT '<user_email_or_group_name>';
DECLARE OR REPLACE VARIABLE v_primary_catalog STRING DEFAULT '<primary_catalog>';
DECLARE OR REPLACE VARIABLE v_schema          STRING DEFAULT 'uc_governance';

-- ============================================================
-- Primary Region Workspace — UC Permission Grants for App Users
-- Run this script in the Primary Region workspace as a
-- metastore admin or catalog owner, AFTER the config tables
-- have been created (see INSTRUCTIONS.md Step 2).
--
-- The app uses the LOGGED-IN USER's OAuth token for all
-- primary workspace operations. Run this script for each user
-- (or group) who will access the app. Set v_principal to the
-- user's email address or a group name.
-- ============================================================

-- Step 1: Catalog-level navigation
EXECUTE IMMEDIATE 'GRANT USE CATALOG ON CATALOG `' || v_primary_catalog || '` TO `' || v_principal || '`';

-- Step 2: Schema-level navigation
EXECUTE IMMEDIATE 'GRANT USE SCHEMA ON SCHEMA `' || v_primary_catalog || '`.`' || v_schema || '` TO `' || v_principal || '`';

-- Step 3: Read and write access to config tables
-- SELECT: read tag dictionary and scope config on app load
-- MODIFY: save changes made in the Configuration tab
EXECUTE IMMEDIATE 'GRANT SELECT, MODIFY ON TABLE `' || v_primary_catalog || '`.`' || v_schema || '`.`govern_tag_dictionary` TO `' || v_principal || '`';
EXECUTE IMMEDIATE 'GRANT SELECT, MODIFY ON TABLE `' || v_primary_catalog || '`.`' || v_schema || '`.`govern_scope_config` TO `' || v_principal || '`';

-- ============================================================
-- OPTIONAL — Apply Tag on catalog
--
-- If users will also manage tags on schemas in this same
-- catalog (i.e. the primary catalog doubles as a managed
-- catalog), grant APPLY TAG at the catalog level so it
-- cascades to all current and future schemas.
--
-- Skip this if users already own the schemas they manage, or
-- if APPLY TAG has been granted to them through another path.
-- ============================================================
-- EXECUTE IMMEDIATE 'GRANT APPLY TAG ON CATALOG `' || v_primary_catalog || '` TO `' || v_principal || '`';
