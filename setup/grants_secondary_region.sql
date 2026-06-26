-- ============================================================
-- VARIABLES — Set these values before running
-- ============================================================

DECLARE OR REPLACE VARIABLE v_sp_id STRING DEFAULT '<service_principal_app_id>';
-- Secondary SP application (client) ID — from accounts.cloud.databricks.com

-- ============================================================
-- MANAGED CATALOGS — List every catalog in this secondary
-- workspace the app should be able to tag.
-- ============================================================

DECLARE OR REPLACE VARIABLE v_managed_catalogs ARRAY<STRING> DEFAULT ARRAY(
  '<catalog_1>',
  '<catalog_2>'
  -- add more catalogs here, comma-separated
);

-- ============================================================
-- Secondary Region Workspace — UC Permission Grants (Tags Only)
--
-- Run this script in the Secondary Region workspace as a
-- metastore admin or catalog owner.
--
-- Grants are at the catalog level so they cascade to ALL
-- current and future schemas — no per-schema re-grants needed
-- when new schemas are added to scope.
--
-- Re-run this script whenever you add new catalogs to
-- v_managed_catalogs above.
-- ============================================================

DECLARE i INT DEFAULT 0;
WHILE i < CARDINALITY(v_managed_catalogs) DO
  DECLARE v_cat STRING DEFAULT v_managed_catalogs[i];

  -- Navigate the catalog
  EXECUTE IMMEDIATE 'GRANT USE CATALOG ON CATALOG `' || v_cat || '` TO `' || v_sp_id || '`';

  -- Navigate all schemas (cascades from catalog level)
  EXECUTE IMMEDIATE 'GRANT USE SCHEMA ON CATALOG `' || v_cat || '` TO `' || v_sp_id || '`';

  -- Write/remove tags on all schemas and tables (cascades from catalog level)
  EXECUTE IMMEDIATE 'GRANT APPLY TAG ON CATALOG `' || v_cat || '` TO `' || v_sp_id || '`';

  SET i = i + 1;
END WHILE;
