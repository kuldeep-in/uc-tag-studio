# Setup Instructions

## Prerequisites

- Databricks CLI v1.0+ installed and configured (`databricks configure`)
- Access to both workspaces:
  - **Primary Region** — where the Databricks App is deployed
  - **Secondary Region** — where the target catalogs and schemas reside
- Workspace admin rights on both workspaces (for granting permissions)
- A Databricks CLI profile pointing to the Primary Region workspace (default profile name used here: `fevm01`)

---

## Step 1 — Create Config Tables (Primary Region)

Run the DDL script once in the Primary Region workspace SQL editor or CLI:

```bash
databricks sql execute \
  --warehouse-id <primary-warehouse-id> \
  --file setup/create_config_tables.sql \
  --profile fevm01
```

This creates two Delta tables in the catalog/schema configured via `app.yaml` env vars (`CONFIG_CATALOG` / `CONFIG_SCHEMA`):

| Table | Purpose |
|---|---|
| `govern_tag_dictionary` | Tag keys, allowed values, free-text flag, display order |
| `govern_scope_config` | Which catalog+schema pairs are in scope (per workspace) |

---

## Step 2 — Grant App Users Access (Primary Region)

The app runs all primary workspace operations as the **logged-in user** — there is no app service principal involved. Each workspace user who accesses the app needs the following grants in the Primary Region:

```sql
-- Run once per user (or grant to a group)
GRANT USE CATALOG ON CATALOG <config_catalog> TO `user@company.com`;
GRANT USE SCHEMA  ON SCHEMA  <config_catalog>.<config_schema> TO `user@company.com`;
GRANT SELECT, MODIFY ON TABLE <config_catalog>.<config_schema>.govern_tag_dictionary TO `user@company.com`;
GRANT SELECT, MODIFY ON TABLE <config_catalog>.<config_schema>.govern_scope_config   TO `user@company.com`;
```

Users also need `USE CATALOG`, `USE SCHEMA`, and `APPLY TAG` on any catalogs/schemas they will manage from the primary workspace.

A ready-made script is provided in `setup/grants_primary_region.sql` — edit the variables at the top and run it.

> **Tip:** Grant to a group (e.g. `data-stewards`) instead of individual users so you don't need to update grants every time someone joins the team.

> **Note:** The app service principal (injected by Databricks Apps as `DATABRICKS_CLIENT_ID/SECRET`) is **not used** for primary workspace operations. It is bypassed via `auth_type="pat"` in the SDK client constructor.

---

## Step 3 — Create a Service Principal for Secondary Region Access

The app uses a dedicated Service Principal (SP) for all secondary workspace operations. The SP is created at the **Databricks account level**, added to the secondary workspace as a member, and then granted Unity Catalog permissions there. The app authenticates as that SP using OAuth M2M (client credentials flow) when making calls to the secondary workspace.

1. Go to **accounts.cloud.databricks.com** → User Management → Service Principals → **Add service principal**. Give it a name, e.g. `tag-governance-sp`. Copy the **Application (client) ID**.
2. On the SP detail page → **Secrets** tab → **Add secret**. Copy the value immediately — it is shown only once.
3. Add the SP to the **secondary workspace** so it can be granted UC permissions there:
   - Secondary workspace → **Settings → Identity & Access → Service Principals → Add service principal**. Search by the application ID or name from Step 1.
4. Store the client secret securely using the provided setup script (the client ID is not sensitive and goes directly in `app.yaml`):
   ```bash
   chmod +x setup/setup_secrets.sh
   ./setup/setup_secrets.sh --profile fevm01
   ```
   The script will:
   - Create the `tag-governance` secret scope (idempotent)
   - Prompt you to enter each SP secret (input is hidden — never echoed)
   - Grant the app service principal READ access on the scope
   - Print the `{{secrets/...}}` reference to paste into `app.yaml`

   Or run the steps manually:
   ```bash
   databricks secrets create-scope --scope tag-governance --profile fevm01
   databricks secrets put-secret --scope tag-governance --key sec-1-sp-secret --profile fevm01
   # Prompts for the secret value — never echoed, never logged
   databricks secrets put-acl --scope tag-governance --principal <app-sp-uuid> --permission READ --profile fevm01
   ```

   > **App SP UUID:** printed by `databricks bundle run` on first deploy, or visible at
   > Workspace → Compute → Apps → `tag-governance-xregion` → Service Principal.

   Reference it in `app.yaml` as `{{secrets/tag-governance/sec-1-sp-secret}}`.

---

## Step 4 — Grant the SP Access in the Secondary Region

Open `setup/grants_secondary_region.sql`, set the variables at the top (`v_sp_id`, `v_catalog`, `v_schema_1`, etc.), then run it in the **Secondary Region** workspace:

```bash
databricks sql execute \
  --warehouse-id <secondary-warehouse-id> \
  --file setup/grants_secondary_region.sql \
  --profile <secondary-profile>
```

The script has two sections:

**Section 1 — Catalog-level grants (run once, covers all current and future schemas):**

| Grant | Purpose |
|---|---|
| `USE CATALOG` on target catalog | Navigate the catalog |
| `USE SCHEMA ON CATALOG` | Navigate all schemas — cascades to all future schemas |
| `APPLY TAG ON CATALOG` | Write/remove tags on all schemas — cascades to all future schemas |

**Section 2 — Per-schema ownership (required for comment management):**

`ALTER SCHEMA … OWNER TO <sp>` is required to run `COMMENT ON TABLE` and `ALTER COLUMN COMMENT`. Declare one `v_schema_N` variable per schema and add the corresponding `ALTER SCHEMA` line.

> **Adding a new schema later:** Add a new `v_schema_N` variable in the script, add the corresponding `ALTER SCHEMA OWNER TO` line, and run only that statement in the Secondary workspace. Section 1 (catalog-level tags + USE SCHEMA) does not need re-running.

`SELECT` is **never granted** — the SP cannot read table data.

---

## Step 5 — Configure Environment Variables

Edit `app.yaml` to set the environment variables for your deployment:

```yaml
env:
  - name: CONFIG_CATALOG       # Primary Region catalog holding the config tables
    value: "my_catalog"
  - name: CONFIG_SCHEMA        # Config schema name
    value: "default"
  - name: SQL_WAREHOUSE_ID     # Primary Region SQL warehouse ID
    value: "<warehouse-id>"
```

**Secondary Region variables** — add a numbered block for each secondary workspace (`SEC_1_*`, `SEC_2_*`, …):

| Variable | Description |
|---|---|
| `SEC_1_WORKSPACE_URL` | Full HTTPS URL of the secondary workspace |
| `SEC_1_DISPLAY_NAME` | Human-readable label shown in the workspace selector |
| `SEC_1_SP_CLIENT_ID` | SP application (client) ID — not sensitive, put directly in `app.yaml` |
| `SEC_1_SP_CLIENT_SECRET` | **Use `{{secrets/tag-governance/sec-1-sp-secret}}`** — never put the raw value here |
| `SEC_1_SQL_WAREHOUSE_ID` | Secondary Region warehouse ID |

Example `app.yaml` fragment after running the secrets setup:

```yaml
  - name: SEC_1_WORKSPACE_URL
    value: "https://dbc-xxxxxx.cloud.databricks.com/"
  - name: SEC_1_DISPLAY_NAME
    value: "AWS Ireland"
  - name: SEC_1_SP_CLIENT_ID
    value: "{{secrets/tag-governance/sec-1-sp-client-id}}"
  - name: SEC_1_SP_CLIENT_SECRET
    value: "{{secrets/tag-governance/sec-1-sp-secret}}"
  - name: SEC_1_SQL_WAREHOUSE_ID
    value: "<warehouse-id>"
```

The `{{secrets/...}}` placeholder is **never resolved at deploy time** — it is injected as a live env var when the app container boots. The raw secret never appears in git, bundle output, or logs.

The app scans `SEC_1_`, `SEC_2_`, … in order until it finds a gap. Add a `SEC_2_*` block for a second secondary workspace the same way. Secondary workspaces appear in **Settings → Workspace** on the next app start.

---

## Step 6 — Build the Frontend

```bash
npm install --prefix frontend
npm run build --prefix frontend
```

This compiles the React app into `frontend/dist/`, which FastAPI serves as a SPA.

---

## Step 7 — Deploy with Databricks Asset Bundles

The project uses [Databricks Asset Bundles (DABs)](https://docs.databricks.com/en/dev-tools/bundles/index.html) for deployment. Configuration is in `databricks.yml`.

### Deploy (sync code to workspace)
```bash
databricks bundle deploy --target dev --profile fevm01
```

### Start / restart the app
```bash
databricks bundle run tag-governance-xregion --target dev --profile fevm01
```

Both commands together (typical deploy workflow):
```bash
npm run build --prefix frontend && \
databricks bundle deploy --target dev --profile fevm01 && \
databricks bundle run tag-governance-xregion --target dev --profile fevm01
```

The app URL is printed at the end of `bundle run`.

---

## Step 8 — First Launch Verification

1. Open the app URL. You should see your **initials in the top-right corner** — this confirms user identity is working.
2. The navbar shows a workspace label with a **green dot** (primary workspace).
3. Go to the **Settings** tab → **Workspace**. The **Logged-in Identity** banner should show your email.
4. Add a schema to scope: select a catalog and schema, click **Add to scope**.
5. Switch to the **Tag Dictionary** sub-tab and define at least one tag key.
6. Navigate to **Tag Management** — tables from the added schema should appear.
7. Edit a table's tags and save — verify the change persists.
8. If a secondary workspace is configured, click its card in **Settings → Workspace** to switch to it (purple dot in navbar) and verify scope entries and tables load for that workspace.

---

## Local Development

You can run the backend locally against the live Databricks workspace. All operations will use the token you provide as the user identity.

### Get a personal access token (PAT)

In the Databricks workspace: User Settings → Access Tokens → Generate new token.

### Start the server locally

```bash
# Install Python dependencies (requires Python 3.9+)
pip install -r requirements.txt

# Set environment variables
export DATABRICKS_HOST=https://adb-XXXX.azuredatabricks.net
export DATABRICKS_TOKEN=<your-pat>
export CONFIG_CATALOG=<your-config-catalog>
export CONFIG_SCHEMA=default
export SQL_WAREHOUSE_ID=<warehouse-id>

# Start the server
uvicorn app:app --host 0.0.0.0 --port 8000 --reload
```

The `current_user_token` dependency falls back to `DATABRICKS_TOKEN` when `X-Forwarded-Access-Token` is absent (local dev). All operations will run as the PAT owner.

For the frontend dev server (with hot reload):
```bash
cd frontend
npm install
npm run dev
# Open http://localhost:5173 — proxies /api/* to http://localhost:8000
```

---

## OAuth Scope Configuration

The app requires the `sql` OAuth scope for the user's forwarded token. This is configured in `databricks.yml`:

```yaml
resources:
  apps:
    tag-governance-xregion:
      user_api_scopes:
        - sql
```

This scope allows the user to execute SQL via the warehouse (config table reads/writes, catalog/schema/table discovery via `information_schema`, tag and comment DDL). The `unity-catalog` REST scope is **not needed** — all primary workspace Unity Catalog operations use SQL, not the UC REST API.

If you ever see `"Provided OAuth token does not have required scopes: sql"`, re-deploy to re-apply the scope configuration:

```bash
databricks bundle deploy --target dev --profile fevm01
```

After updating scopes, users may need to **log out and back in** so a fresh token is issued with the new scope.

---

## Rotating a Service Principal Secret

When a SP secret expires or is compromised, rotate it **without redeploying the bundle**:

```bash
# 1. Generate a new secret for the SP in the Databricks account console.
#    (The old secret is immediately invalidated when you generate a new one.)

# 2. Update the secret in the scope — prompts for the new value:
databricks secrets put-secret \
  --scope tag-governance \
  --key sec-1-sp-secret \
  --profile fevm01

# 3. Restart the app so it picks up the new value on next boot:
databricks apps stop  tag-governance-xregion --profile fevm01
databricks apps start tag-governance-xregion --profile fevm01
```

No code change, no `bundle deploy`, no git commit. The `{{secrets/...}}` placeholder in `app.yaml` is resolved fresh every time the app container starts.

---

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---|---|---|
| No user initials / identity endpoint 502 | `X-Forwarded-Access-Token` missing or auth conflict | Check app logs; verify `auth_type="pat"` in `get_user_client()` in `server/config.py` |
| `"more than one authorization method configured"` | SDK sees both user PAT and SP M2M env vars | Already fixed via `auth_type="pat"` in `server/config.py` |
| Catalogs not loading — `sql` scope error | App's `user_api_scopes` missing `sql` | Re-deploy bundle; user must re-login |
| Catalogs not loading — permission error | User lacks `USE CATALOG` or `USE SCHEMA` | Run `grants_primary_region.sql` for the user |
| Config tables 502 — `sql` scope error | Same as above | Re-deploy; user re-login |
| Config tables 502 — table not found | Config tables don't exist yet | Run `setup/create_config_tables.sql` |
| Secondary workspace not appearing | `SEC_1_WORKSPACE_URL` not set in `app.yaml` | Add the `SEC_1_*` env var block, redeploy, and restart the app |
| Secondary workspace `invalid_client` / 502 | SP secret expired or wrong | Regenerate SP secret → run `setup/setup_secrets.sh` → restart app |
| Secondary workspace `secret not found` | Scope or key doesn't exist, or app SP lacks READ | Run `setup/setup_secrets.sh`; verify ACLs with `databricks secrets list-acls` |
| Tags not saving on secondary workspace | SP missing `APPLY TAG` on catalog | Re-run Section 1 of `grants_secondary_region.sql` |
| Comments not saving on secondary workspace | SP is not schema owner | Run `ALTER SCHEMA … OWNER TO <sp-id>` (Section 2 of the grants script) in secondary workspace |
| Tables not visible for selected workspace | Wrong workspace selected in dropdown, or scope entries not added | Switch workspace in navbar; add scope entries in Configuration tab for that workspace |
| App fails to start (startup error) | Import error, missing env var, or unresolvable `{{secrets/...}}` | Check `databricks apps logs tag-governance-xregion --profile fevm01` |
| Tables not visible in Tag Management | User lacks `USE SCHEMA` on that catalog/schema | Grant `USE CATALOG` + `USE SCHEMA` to the user on the primary workspace |

### View app logs

```bash
databricks apps logs tag-governance-xregion --profile fevm01
```

Errors logged as `ERROR app: API 502 on /api/...: <message>` show the actual exception. `502 Bad Gateway` responses also include the error message in the response body (visible in browser DevTools → Network tab).
