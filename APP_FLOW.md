# App Flow — Unity Catalog Metadata Manager

This document describes what happens end-to-end for every user action in the app.

---

## Authentication Model

All workspace operations run under **service principal** credentials — never the logged-in user's identity.

- **Primary workspace** — the app's own SP, auto-injected by the Databricks Apps platform as
  `DATABRICKS_CLIENT_ID` / `DATABRICKS_CLIENT_SECRET`. `get_primary_client()` in `server/config.py`
  constructs a `WorkspaceClient()` which picks these up automatically.
- **Secondary workspaces** — dedicated SP credentials stored in Databricks Secrets and supplied via
  `SEC_N_SP_CLIENT_ID` / `SEC_N_SP_CLIENT_SECRET` env vars in `app.yaml`. Token exchange is done
  manually via `httpx` to avoid SDK env-var conflicts with the primary SP credentials.

Local development uses the `fevm01` CLI profile as fallback (no token header required).

---

## App Load

**Trigger:** Browser opens the app URL.

1. React app boots, renders the navbar with a pulsing avatar placeholder and the workspace label.
2. Two requests fire in parallel:
   - `GET /api/config/identity` — fetches the app SP's identity and warehouse ID.
   - `GET /api/config/workspaces` — fetches all workspaces (primary + `SEC_N_*` secondaries from env).
3. Avatar renders the SP's initials (up to 2 words from `display_name`) in the top-right corner.
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
3. For each scope entry the server calls `list_tables(catalog, schema, workspace_url)`:
   - Runs two SQL queries via the app SP client:
     1. `information_schema.tables` — table name and type.
     2. `information_schema.table_tags` — tag names and values (filtered to configured tag keys).
4. Server aggregates counts per schema and returns:
   ```json
   {
     "tables_total": N,
     "tables_tagged_pct": X,
     "tables_tagged": Y,
     "per_schema": [{ "workspace_url": "...", "catalog": "...", "schema": "...", ... }]
   }
   ```
5. Frontend filters `per_schema` by `s.workspace_url === workspace` and recomputes metric
   totals from the filtered rows using the `aggregate()` helper. If no rows match the
   selected workspace, an empty-state message is shown instead.
6. Two metric cards (tables in scope, tables tagged %) and a per-schema breakdown table are rendered.

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
| List catalogs | Primary | App SP (`WorkspaceClient()`) | `SHOW CATALOGS` (SQL) |
| List schemas | Primary | App SP | `information_schema.schemata` (SQL) |
| List tables | Primary | App SP | `information_schema.tables` + `table_tags` (SQL) |
| Get / set tags | Primary | App SP | `information_schema.table_tags` / `ALTER TABLE … TAGS` (SQL) |
| Config table reads/writes | Primary | App SP | Statement Execution API (SQL) |
| Identify app SP | Primary | App SP | SCIM `current_user.me()` |
| List all workspaces | Primary | — (env vars only) | Reads `SEC_N_*` env vars; no DB call |
| All UC operations | Secondary | Dedicated SP (OAuth M2M) | UC REST API or SQL warehouse |

All operations run as service principals. No user OAuth tokens are used.
