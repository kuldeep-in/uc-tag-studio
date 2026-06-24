-- Step 1: Tag dictionary
-- Stores all tag keys and their permitted values.
-- Managed via the Configuration tab in the app.
CREATE OR REPLACE TABLE <catalog_name>.<schema_name>.govern_tag_dictionary (
  tag_key        STRING  NOT NULL  COMMENT 'Unique tag key name, e.g. sensitivity, domain, pii',
  allowed_values ARRAY<STRING>     COMMENT 'List of permitted values. NULL means any value is allowed.',
  free_text      BOOLEAN NOT NULL DEFAULT false COMMENT 'If true, users may enter free-text values in addition to allowed_values',
  sort_order     INT               COMMENT 'Display order in the UI. NULL = sorted after explicit entries, then alphabetically.',
  created_at     TIMESTAMP         DEFAULT current_timestamp(),
  updated_at     TIMESTAMP         DEFAULT current_timestamp()
)
COMMENT 'Global tag dictionary defining allowed tag keys and values for the app'
TBLPROPERTIES ('delta.feature.allowColumnDefaults' = 'supported');

-- Step 2: Scope config
-- Stores which catalogs and schemas the app should manage, and which workspace they live in.
-- Managed via the Configuration tab in the app.
-- workspace_url is 'primary' for the primary workspace, or the full URL for secondary workspaces.
CREATE OR REPLACE TABLE <catalog_name>.<schema_name>.govern_scope_config (
  workspace_url  STRING  NOT NULL  COMMENT 'primary or the full secondary workspace URL (https://adb-xxx.azuredatabricks.net)',
  catalog_name   STRING  NOT NULL  COMMENT 'Unity Catalog catalog name',
  schema_name    STRING  NOT NULL  COMMENT 'Schema name within the catalog',
  is_active      BOOLEAN NOT NULL DEFAULT true COMMENT 'If false, excluded from Tag and Comment management tabs',
  added_at       TIMESTAMP         DEFAULT current_timestamp()
)
COMMENT 'Scope configuration defining which catalogs and schemas the app manages per workspace'
TBLPROPERTIES ('delta.feature.allowColumnDefaults' = 'supported');
