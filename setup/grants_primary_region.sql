-- ============================================================
-- VARIABLES — Set these values before running
-- ============================================================

DECLARE OR REPLACE VARIABLE v_app_sp_uuid    STRING DEFAULT '<app-service-principal-uuid>';
-- App SP UUID: Workspace → Compute → Apps → uc-tag-studio → Service Principal

DECLARE OR REPLACE VARIABLE v_config_catalog STRING DEFAULT '<config_catalog>';
-- Catalog that holds govern_tag_dictionary and govern_scope_config (= CONFIG_CATALOG in app.yaml)

DECLARE OR REPLACE VARIABLE v_config_schema  STRING DEFAULT 'uc_tag_studio';
-- Schema that holds those tables (= CONFIG_SCHEMA in app.yaml)

-- ============================================================
-- MANAGED CATALOGS — List every catalog the app should be
-- able to tag. The app SP gets USE CATALOG + USE SCHEMA +
-- APPLY TAG on each one. All three grants are at the catalog
-- level so they cascade to ALL current and future schemas
-- automatically — no per-schema grants ever needed.
-- ============================================================

DECLARE OR REPLACE VARIABLE v_managed_catalogs ARRAY<STRING> DEFAULT ARRAY(
  '<catalog_1>',
  '<catalog_2>'
  -- add more catalogs here, comma-separated
);

-- ============================================================
-- Primary Region Workspace — UC Permission Grants for App SP
--
-- Run this script in the Primary Region workspace as a
-- metastore admin or catalog owner, AFTER deploying the app
-- and noting its Service Principal UUID.
--
-- All primary workspace operations run as the APP SERVICE
-- PRINCIPAL. Run this script once per deployment (not per user).
-- Re-run it whenever you add new catalogs to v_managed_catalogs.
-- ============================================================


-- ============================================================
-- SECTION 1 — Config table access (run once)
-- Grants the app SP the right to read/write the two config
-- tables (tag dictionary and scope config).
-- ============================================================

EXECUTE IMMEDIATE 'GRANT USE CATALOG ON CATALOG `' || v_config_catalog || '` TO `' || v_app_sp_uuid || '`';
EXECUTE IMMEDIATE 'GRANT USE SCHEMA  ON SCHEMA  `' || v_config_catalog || '`.`' || v_config_schema || '` TO `' || v_app_sp_uuid || '`';
EXECUTE IMMEDIATE 'GRANT SELECT, MODIFY ON TABLE `' || v_config_catalog || '`.`' || v_config_schema || '`.`govern_tag_dictionary` TO `' || v_app_sp_uuid || '`';
EXECUTE IMMEDIATE 'GRANT SELECT, MODIFY ON TABLE `' || v_config_catalog || '`.`' || v_config_schema || '`.`govern_scope_config`   TO `' || v_app_sp_uuid || '`';


-- ============================================================
-- SECTION 2 — Managed catalog access (tag operations)
--
-- Loops over v_managed_catalogs and grants the app SP:
--   USE CATALOG  — navigate the catalog
--   USE SCHEMA   — catalog-level, cascades to all schemas
--   BROWSE       — catalog-level, allows information_schema listing
--                  without granting access to actual table data
--   APPLY TAG    — catalog-level, cascades to all schemas/tables
--
-- To add a catalog later: add it to v_managed_catalogs above
-- and re-run this script (grants are idempotent).
-- ============================================================

DECLARE i INT DEFAULT 0;
WHILE i < CARDINALITY(v_managed_catalogs) DO
  DECLARE v_cat STRING DEFAULT v_managed_catalogs[i];

  EXECUTE IMMEDIATE 'GRANT USE CATALOG ON CATALOG `' || v_cat || '` TO `' || v_app_sp_uuid || '`';
  EXECUTE IMMEDIATE 'GRANT USE SCHEMA  ON CATALOG `' || v_cat || '` TO `' || v_app_sp_uuid || '`';
  EXECUTE IMMEDIATE 'GRANT BROWSE      ON CATALOG `' || v_cat || '` TO `' || v_app_sp_uuid || '`';
  EXECUTE IMMEDIATE 'GRANT APPLY TAG   ON CATALOG `' || v_cat || '` TO `' || v_app_sp_uuid || '`';

  SET i = i + 1;
END WHILE;
