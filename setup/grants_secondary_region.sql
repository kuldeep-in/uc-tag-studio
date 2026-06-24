-- ============================================================
-- VARIABLES — Set these values before running
-- ============================================================
DECLARE OR REPLACE VARIABLE v_sp_id    STRING DEFAULT '<service_principal_app_id>';
DECLARE OR REPLACE VARIABLE v_catalog  STRING DEFAULT '<target_catalog>';
-- Declare one v_schema_N variable per schema for Section 2
DECLARE OR REPLACE VARIABLE v_schema_1 STRING DEFAULT '<schema_name_1>';
DECLARE OR REPLACE VARIABLE v_schema_2 STRING DEFAULT '<schema_name_2>';

-- ============================================================
-- Secondary Region Workspace — UC Permission Grants
-- Run this script in the Secondary Region workspace as a
-- metastore admin or catalog owner.
--
-- The app uses a service principal (SP) for all secondary
-- workspace operations. This script is a ONE-TIME catalog-level
-- setup. Because grants are made at the catalog level, they
-- cascade to all current and future schemas — no per-schema
-- re-grants are needed when new schemas are added to scope.
--
-- For tags only:       run Section 1 only.
-- For tags + comments: run Section 1, then Section 2 for each
--                      schema the SP will manage comments on.
-- ============================================================

-- ============================================================
-- SECTION 1 — Catalog-level grants (one-time, covers all schemas)
-- ============================================================

-- Navigation: allows the SP to see the catalog and all schemas inside it
GRANT USE CATALOG ON CATALOG IDENTIFIER(v_catalog) TO IDENTIFIER(v_sp_id);
GRANT USE SCHEMA ON SCHEMA IDENTIFIER(v_catalog) TO IDENTIFIER(v_sp_id);

-- Tagging: grants APPLY TAG on the catalog, which cascades to all
-- current and future schemas — no per-schema tag grants needed
GRANT APPLY TAG ON CATALOG IDENTIFIER(v_catalog) TO IDENTIFIER(v_sp_id);

-- ============================================================
-- SECTION 2 — Per-schema ownership (required for comment management)
--
-- ALTER SCHEMA OWNER TO is required for the SP to run
-- COMMENT ON TABLE and ALTER COLUMN COMMENT. Without it, tags
-- will work but comment writes will fail with a permissions error.
--
-- Run this block for every schema the SP will manage comments on.
-- You can pre-grant all schemas at once here so no follow-up
-- grants are needed as schemas are added to scope later.
-- ============================================================

-- Schema: v_schema_1
ALTER SCHEMA IDENTIFIER(v_catalog || '.' || v_schema_1) OWNER TO IDENTIFIER(v_sp_id);

-- Schema: v_schema_2
ALTER SCHEMA IDENTIFIER(v_catalog || '.' || v_schema_2) OWNER TO IDENTIFIER(v_sp_id);

-- Add more schemas by declaring additional v_schema_N variables above
-- and repeating the ALTER SCHEMA line for each one. Example:
--
-- DECLARE OR REPLACE VARIABLE v_schema_3 STRING DEFAULT '<schema_name_3>';
-- ALTER SCHEMA IDENTIFIER(v_catalog || '.' || v_schema_3) OWNER TO IDENTIFIER(v_sp_id);
