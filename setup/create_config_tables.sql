-- ============================================================
-- Config table creation
-- Replace <catalog_name> and <schema_name> with the values
-- from CONFIG_CATALOG and CONFIG_SCHEMA in app.yaml.
--
-- Required privilege: CREATE TABLE on the target catalog.
-- Run once in the Primary workspace SQL editor.
-- Re-run with CREATE OR REPLACE to update the schema.
-- WARNING: CREATE OR REPLACE drops existing data. If the tables
-- already exist and contain data, use ALTER TABLE instead.
-- ============================================================

CREATE SCHEMA IF NOT EXISTS `<catalog_name>`.`<schema_name>`;

-- ── govern_tag_dictionary ─────────────────────────────────────────────────────
-- Stores all tag keys and their permitted values.
-- Managed via the Tag Dictionary tab in the app.

CREATE OR REPLACE TABLE `<catalog_name>`.`<schema_name>`.`govern_tag_dictionary` (
  tag_key        STRING  NOT NULL  COMMENT 'Unique tag key name, e.g. sensitivity, domain, pii',
  allowed_values ARRAY<STRING>     COMMENT 'List of permitted values. NULL means any value is allowed.',
  free_text      BOOLEAN NOT NULL  DEFAULT false COMMENT 'If true, users may enter free-text values in addition to allowed_values',
  sort_order     INT               COMMENT 'Display order in the UI. NULL = sorted after explicit entries, then alphabetically.',
  created_at     TIMESTAMP         DEFAULT current_timestamp(),
  updated_at     TIMESTAMP         DEFAULT current_timestamp()
)
COMMENT 'Global tag dictionary defining allowed tag keys and values for the app'
TBLPROPERTIES ('delta.feature.allowColumnDefaults' = 'supported');

-- ── govern_scope_config ───────────────────────────────────────────────────────
-- Stores which catalogs and schemas the app should manage, and which workspace
-- they live in. workspace_url is 'primary' for the primary workspace, or the
-- full URL for secondary workspaces (https://adb-xxx.azuredatabricks.net).
-- Managed via the Settings tab in the app.

CREATE OR REPLACE TABLE `<catalog_name>`.`<schema_name>`.`govern_scope_config` (
  workspace_url  STRING  NOT NULL  COMMENT 'primary or the full secondary workspace URL (https://adb-xxx.azuredatabricks.net)',
  catalog_name   STRING  NOT NULL  COMMENT 'Unity Catalog catalog name',
  schema_name    STRING  NOT NULL  COMMENT 'Schema name within the catalog',
  is_active      BOOLEAN NOT NULL  DEFAULT true COMMENT 'If false, excluded from Tag management tab',
  added_at       TIMESTAMP         DEFAULT current_timestamp()
)
COMMENT 'Scope configuration defining which catalogs and schemas the app manages per workspace'
TBLPROPERTIES ('delta.feature.allowColumnDefaults' = 'supported');

-- ── govern_health_check_results ───────────────────────────────────────────────
-- Caches the result of the last health check run per group.
-- Managed via the Health Check tab in the app.

CREATE OR REPLACE TABLE `<catalog_name>`.`<schema_name>`.`govern_health_check_results` (
  check_group_id    STRING    NOT NULL  COMMENT 'Internal group ID: app, primary, secondary_1, ...',
  check_group_label STRING    NOT NULL  COMMENT 'Display label: App Checks, Primary Workspace, ...',
  workspace_url     STRING              COMMENT 'NULL for app group, full URL for workspace groups',
  check_id          STRING    NOT NULL  COMMENT 'Unique check identifier within the group',
  check_type        STRING    NOT NULL  COMMENT 'check or permission',
  step              INT                 COMMENT 'Step number within the group (check type only)',
  label             STRING              COMMENT 'Display label (check type only)',
  perm_group        STRING              COMMENT 'Permission category label (permission type only)',
  resource          STRING              COMMENT 'Permission resource (permission type only)',
  privilege         STRING              COMMENT 'Permission privilege (permission type only)',
  status            STRING    NOT NULL  COMMENT 'ok, warning, or error',
  message           STRING,
  fix_sql           STRING,
  fix_where         STRING,
  checked_at        TIMESTAMP NOT NULL  COMMENT 'When this check last ran',
  sp_client_id      STRING              COMMENT 'App SP that ran the check'
)
COMMENT 'Cached results of the last health check run per group'
TBLPROPERTIES ('delta.feature.allowColumnDefaults' = 'supported');
