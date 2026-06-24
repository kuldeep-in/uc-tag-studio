# App Flow — Unity Catalog Metadata Manager

This document describes what happens end-to-end for every user action in the app.

---

## Authentication Model

Every HTTP request from the browser passes through the Databricks Apps proxy, which injects
`X-Forwarded-Access-Token` — a short-lived OAuth2 token that represents the **logged-in user**.
The FastAPI `current_user_token` dependency (`server/dependencies.py`) reads this header on every
request. All primary workspace operations then use `get_user_client(token)` which constructs a
`WorkspaceClient(host, token=token, auth_type="pat")`. `auth_type="pat"` prevents the SDK from
conflicting with the auto-injected app service-principal env vars (`DATABRICKS_CLIENT_ID/SECRET`).

The forwarded token has the `sql` OAuth scope (configured via `user_api_scopes` in `databricks.yml`).
This allows the Statement Execution API but **not** the Unity Catalog REST API. Accordingly, all
primary workspace reads use `information_schema` SQL. The UC REST API is only called for secondary
workspaces, where the dedicated service principal has full scope.

Local development uses `DATABRICKS_TOKEN` (PAT) as fallback when the header is absent.

---

## App Load

**Trigger:** Browser opens the app URL.

1. React app boots, renders the navbar with a pulsing avatar placeholder and the workspace label.
2. Two requests fire in parallel:
   - `GET /api/config/identity` — fetches the logged-in user's name and warehouse ID.
   - `GET /api/config/workspaces` — fetches all workspaces (primary + `SEC_N_*` secondaries from env).
3. Avatar renders the user's initials (up to 2 words from `display_name`) in the top-right corner.
   Hovering shows full name and email.
4. Navbar workspace label updates: green dot for primary, purple dot for secondary.
5. Default tab is **Overview**; it begins loading immediately.

---

## Workspace Switcher

**Trigger:** User clicks a workspace card in **Settings → Workspace**.

1. `selectedWorkspace` state in `App.tsx` is updated to the chosen workspace URL; persisted to `localStorage`.
2. No API call is made. Each tab receives the new `workspace` prop and re-renders, filtering its
   in-memory data to entries whose `workspace_url` matches the selection.
3. If React Query already has cached data for the new workspace's scope entries and tables, those
   render immediately. Otherwise they are fetched on demand.
4. The navbar label updates: green dot for primary, purple dot for any secondary.

---

## Overview Tab

**Trigger:** Tab is selected (or app load, since it is the default).

1. Frontend fires `GET /api/overview/metrics` (cached by React Query under `['overview-metrics']`).
2. Server reads all **active** scope entries from `govern_scope_config` via SQL.
3. For each scope entry the server calls `list_tables(catalog, schema, workspace_url, token)`:
   - **Primary workspace:** Runs two SQL queries via the user's token:
     1. `information_schema.tables` — table name, type, comment.
     2. `information_schema.table_tags` — tag names and values (filtered to configured tag keys).
   - **Secondary workspace:** Same SQL queries but via the service-principal client.
4. Server aggregates counts per schema and returns:
   ```json
   {
     "tables_total": N,
     "tables_tagged_pct": X,
     "tables_commented_pct": Y,
     "columns_commented_pct": Z,
     "per_schema": [{ "workspace_url": "...", "catalog": "...", "schema": "...", ... }]
   }
   ```
5. Frontend filters `per_schema` by `s.workspace_url === workspace` and recomputes all four
   metric totals from the filtered rows using the `aggregate()` helper. If no rows match the
   selected workspace, an empty-state message is shown instead.
6. Four metric cards and a per-schema breakdown table with progress bars are rendered.

---

## Tag Management Tab

### Load

**Trigger:** User clicks the **Tag Management** tab.

1. Two parallel requests fire:
   - `GET /api/config/scope` → reads `govern_scope_config` (all entries).
   - `GET /api/config/tagdictionary` → reads `govern_tag_dictionary`.
2. Active scope entries are filtered client-side to those whose `workspace_url` matches the selected
   workspace.
3. For each matching active scope entry a parallel `GET /api/tables?catalog=…&schema=…&workspace_url=…`
   fires. Server flow per request:
   1. Reads tag keys from `govern_tag_dictionary`.
   2. Queries `information_schema.tables` for table name, type, comment.
   3. Queries `information_schema.table_tags` with a tag key filter.
   4. Merges tags onto each table row and returns the list.
4. Frontend flattens all tables into one list. Tag columns in the header are driven by the tag
   dictionary keys. Each cell shows the tag value or `—` if not set.

### Filter bar

Client-side only. Dropdowns and text input filter the in-memory `allTables` array by catalog,
schema, and table name substring. The "Untagged only" checkbox hides tables where `tag_count > 0`.
No API calls are made.

### Edit tags (modal)

**Trigger:** User clicks **Edit** on a table row.

1. `TagEditModal` opens pre-populated with the table's current `tags` map.
2. Each tag key from the dictionary is rendered as:
   - A `<select>` if `allowed_values` is set and `free_text` is false.
   - A text `<input>` with a `<datalist>` if `free_text` is true and `allowed_values` is set.
   - A plain text `<input>` if no `allowed_values`.
3. User edits values and clicks **Save**. Empty strings are stripped (treated as "remove this tag").
4. Frontend calls `PATCH /api/tags/table/{full_name}` with `{ tags: { key: value, … }, workspace_url }`.
5. Server runs `update_table_tags(full_name, tags, workspace_url, token)`:
   1. Reads current tags via `information_schema.table_tags` SQL (primary) or UC REST (secondary).
   2. Computes which keys are removed (present in current, absent in new).
   3. If any tags to set: `ALTER TABLE {full_name} SET TAGS ('k1' = 'v1', …)` via SQL warehouse.
   4. If any tags to remove: `ALTER TABLE {full_name} UNSET TAGS ('k1', …)` via SQL warehouse.
6. On success the frontend patches the React Query cache for the table list (no refetch needed) and
   invalidates `overview-metrics` so the Overview tab refreshes on next visit.

---

## Comment Management Tab

### Load

**Trigger:** User clicks the **Comment Management** tab.

1. `GET /api/config/scope` fires to load all scope entries (served from cache if already fetched).
2. Active scope entries are filtered client-side to those matching the selected workspace.
3. For each matching active scope entry `GET /api/tables?catalog=…&schema=…` fires in parallel
   (same flow as Tag Management). Results are cached — switching tabs does not re-fetch.
4. The UI renders a collapsible tree: one `SchemaNode` per active scope entry, expanded by default.
   Each schema row shows a coverage badge (`N/M · X%` commented tables).
5. A legend at the top shows:
   - **Amber swatch** = missing description
   - **White swatch** = described

### Tree row colours

- **Table row amber background** — `table.has_comment` is false.
- **Column row amber background** — `column.has_comment` is false.
- **White background** — the item has a description.

No checkboxes, no bulk selection. Every row has an individual **Edit** button.

### Expand a table (load columns)

**Trigger:** User clicks the `▸` expand arrow on a table row.

1. Frontend fires `GET /api/comments/columns/{catalog.schema.table}`.
2. Server runs `list_columns(full_name, workspace_url, token)`:
   - **Primary workspace:** Queries `information_schema.columns`:
     ```sql
     SELECT column_name, full_data_type, comment
     FROM {catalog}.information_schema.columns
     WHERE table_schema = '{schema}' AND table_name = '{table}'
     ORDER BY ordinal_position
     ```
   - **Secondary workspace:** Calls UC REST API `GET /api/2.1/unity-catalog/tables/{full_name}`
     and extracts the `columns` array.
3. Returns `[{ name, type_text, comment, has_comment }, …]`.
4. Column rows render under the table row, each with its data type and comment (or "no description"
   in amber) and an inline **Edit** button.

### Edit a table comment

**Trigger:** User clicks **Edit** on a table row.

1. `CommentSidePanel` slides in from the right, pre-populated with the table's current `comment`
   string (already present in the table list response — no extra fetch needed).
2. User edits the textarea and clicks **Save**.
3. Frontend calls `PATCH /api/comments/table/{full_name}` with `{ comment, workspace_url }`.
4. Server runs `update_table_comment(full_name, comment, workspace_url, token)`:
   ```sql
   COMMENT ON TABLE {full_name} IS '{escaped_comment}'
   ```
   Executes via SQL warehouse (user's token for primary; SP for secondary).
5. On success the side panel closes and the `tables` and `overview-metrics` caches are invalidated,
   causing a background refetch.

### Edit a column comment

**Trigger:** User clicks **Edit** on a column row.

1. `CommentSidePanel` slides in, pre-populated with the column's existing comment.
2. User edits and clicks **Save**.
3. Frontend calls `PATCH /api/comments/column/{full_name}/{column_name}` with `{ comment, workspace_url }`.
4. Server runs `update_column_comment(full_name, col_name, comment, workspace_url, token)`:
   ```sql
   ALTER TABLE {full_name} ALTER COLUMN {col_name} COMMENT '{escaped_comment}'
   ```
5. Same cache invalidation as table comment.

---

## Settings Tab

### Workspace sub-tab

**Trigger:** Settings tab renders (defaults to Workspace sub-tab).

- **Workspace selector cards** — displays all workspaces (primary + SEC_N_* secondaries). Clicking a card updates global `selectedWorkspace` state in `App.tsx` and persists to `localStorage`. Navbar label updates instantly.
- **Identity banner** — fires `GET /api/config/identity` (served from React Query cache). Displays logged-in identity type, username/email, and SQL warehouse ID.
- **Scope section** — unified for all workspaces. Catalog and schema dropdowns fire `GET /api/catalogs` and `GET /api/schemas` with the current workspace URL. Primary workspace uses user's OAuth token; secondary uses SP credentials. All add/toggle/remove operations go to `govern_scope_config` via the user's token.
- **Add Secondary Workspace** — collapsible panel (collapsed by default). Contains the full SP setup guide (`Instructions` component). Expanding it fires no API calls.

### Scope section — browse catalogs

**Trigger:** User opens the **Catalog** dropdown.

1. Frontend fires `GET /api/catalogs?workspace_url=…` (keyed by workspace, cached separately per workspace).
2. Server runs `SHOW CATALOGS` SQL via the appropriate client (user token for primary, SP for secondary).
3. Returns a list of catalog names.

### Scope section — browse schemas

**Trigger:** User selects a catalog from the dropdown.

1. Frontend fires `GET /api/schemas?catalog={catalog}&workspace_url=…`.
2. Server runs:
   ```sql
   SELECT schema_name FROM {catalog}.information_schema.schemata ORDER BY schema_name
   ```
3. Returns schema names for the selected catalog.

### Scope section — add to scope

**Trigger:** User selects a catalog + schema and clicks **Add to scope**.

1. Frontend calls `POST /api/config/scope` with `{ catalog, schema, is_active: true, workspace_url }`.
2. Server runs a `MERGE INTO govern_scope_config` statement:
   - If the row exists: updates `is_active`.
   - If new: inserts with `added_at = current_timestamp()`.
3. The `scope` cache is invalidated; the table re-renders with the new entry.

### Scope section — toggle active/inactive

**Trigger:** User checks/unchecks the **Active** checkbox on a scope row.

Same `POST /api/config/scope` flow with the updated `is_active` value. The `MERGE` updates only
the `is_active` column for the existing row.

### Scope section — remove from scope

**Trigger:** User clicks **Remove** on a scope row.

1. Frontend calls `DELETE /api/config/scope/{workspace_url}/{catalog}/{schema}`.
2. Server runs:
   ```sql
   DELETE FROM govern_scope_config
   WHERE workspace_url = '…' AND catalog_name = '…' AND schema_name = '…'
   ```
3. Scope cache is invalidated.

### Tag dictionary — add / edit a tag key

**Trigger:** User fills in the tag key form and clicks **Save key**.

1. Frontend calls `POST /api/config/tagdictionary` with `{ tag_key, allowed_values, free_text }`.
2. Server runs a `MERGE INTO govern_tag_dictionary` statement:
   - If the key exists: updates `allowed_values`, `free_text`, `updated_at`.
   - If new: inserts with `created_at = updated_at = current_timestamp()`.
   - `allowed_values` is stored as an `ARRAY<STRING>`.
3. Tag dictionary cache is invalidated. The Tag Management tab picks up new columns on its
   next table query.

### Tag dictionary — delete a tag key

**Trigger:** User clicks **Delete** on a dictionary row.

1. Frontend calls `DELETE /api/config/tagdictionary/{tag_key}`.
2. Server runs `DELETE FROM govern_tag_dictionary WHERE tag_key = '…'`.
3. Tag dictionary cache is invalidated.

---

## Authentication Flow Summary

| Operation | Workspace | Auth used | Databricks API |
|---|---|---|---|
| List catalogs | Primary | User OAuth token (`sql` scope) | `SHOW CATALOGS` (SQL) |
| List schemas | Primary | User OAuth token | `information_schema.schemata` (SQL) |
| List tables | Primary | User OAuth token | `information_schema.tables` + `table_tags` (SQL) |
| List columns | Primary | User OAuth token | `information_schema.columns` (SQL) |
| Get table comment | Primary | User OAuth token | `information_schema.tables` (SQL) |
| Get / set tags | Primary | User OAuth token | `information_schema.table_tags` / `ALTER TABLE … TAGS` (SQL) |
| Set table comment | Primary | User OAuth token | `COMMENT ON TABLE` (SQL) |
| Set column comment | Primary | User OAuth token | `ALTER TABLE … ALTER COLUMN COMMENT` (SQL) |
| Config table reads/writes | Primary | User OAuth token | Statement Execution API (SQL) |
| Identify logged-in user | Primary | User OAuth token | SCIM `current_user.me()` |
| List all workspaces | Primary | — (env vars only) | `GET /api/config/workspaces` reads `SEC_N_*` env vars; no DB call |
| All UC operations | Secondary | SP OAuth M2M | UC REST API or SQL warehouse |

All primary operations use the `sql` OAuth scope only. The `unity-catalog` REST scope is **never**
required for the primary workspace.
