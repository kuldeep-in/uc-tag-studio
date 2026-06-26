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

## Step 2 — Grant the App SP Access (Primary Region)

All primary workspace operations run as the **app service principal** (auto-injected by the Databricks Apps platform). Grant the app SP the following permissions in the Primary Region:

```sql
-- Find the app SP's application UUID in:
-- Databricks workspace → Compute → Apps → uc-tag-studio → Service Principal
GRANT USE CATALOG ON CATALOG <config_catalog> TO `<app-sp-uuid>`;
GRANT USE SCHEMA  ON SCHEMA  <config_catalog>.<config_schema> TO `<app-sp-uuid>`;
GRANT SELECT, MODIFY ON TABLE <config_catalog>.<config_schema>.govern_tag_dictionary TO `<app-sp-uuid>`;
GRANT SELECT, MODIFY ON TABLE <config_catalog>.<config_schema>.govern_scope_config   TO `<app-sp-uuid>`;
```

The app SP also needs `USE CATALOG`, `USE SCHEMA`, and `APPLY TAG` on any catalogs/schemas it will manage from the primary workspace.

A ready-made script is provided in `setup/grants_primary_region.sql` — edit the variables at the top and run it.

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
   > Workspace → Compute → Apps → `uc-tag-studio` → Service Principal.

   Reference it in `app.yaml` as `{{secrets/tag-governance/sec-1-sp-secret}}`.

---

## Step 4 — Grant the SP Access in the Secondary Region

Open `setup/grants_secondary_region.sql`, set the variables at the top (`v_sp_id`, `v_catalog`), then run it in the **Secondary Region** workspace:

```bash
databricks sql execute \
  --warehouse-id <secondary-warehouse-id> \
  --file setup/grants_secondary_region.sql \
  --profile <secondary-profile>
```

The script grants three catalog-level permissions that cascade to all current and future schemas — no per-schema re-grants are needed when new schemas are added to scope:

| Grant | Purpose |
|---|---|
| `USE CATALOG` on target catalog | Navigate the catalog |
| `USE SCHEMA ON CATALOG` | Navigate all schemas |
| `APPLY TAG ON CATALOG` | Write/remove tags on all schemas |

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
databricks bundle run uc-tag-studio --target dev --profile fevm01
```

Both commands together (typical deploy workflow):
```bash
npm run build --prefix frontend && \
databricks bundle deploy --target dev --profile fevm01 && \
databricks bundle run uc-tag-studio --target dev --profile fevm01
```

The app URL is printed at the end of `bundle run`.

---

## Step 8 — First Launch Verification

1. Open the app URL. You should see the **app SP's initials in the top-right corner** — this confirms the SP identity is resolving correctly.
2. The navbar shows a workspace label with a **green dot** (primary workspace).
3. Go to the **Settings** tab → **Workspace**. The **Identity** banner shows the app SP name.
4. Add a schema to scope: select a catalog and schema, click **Add to scope**.
5. Switch to the **Tag Dictionary** sub-tab and define at least one tag key.
6. Navigate to **Tag Management** — tables from the added schema should appear.
7. Edit a table's tags and save — verify the change persists.
8. If a secondary workspace is configured, click its card in **Settings → Workspace** to switch to it (purple dot in navbar) and verify scope entries and tables load for that workspace.

---

## Local Development

You can run the backend locally using a CLI profile — all operations run as the profile's SP or user identity (the `fevm01` profile is the default).

### Start the server locally

```bash
# Install Python dependencies (requires Python 3.9+)
pip install -r requirements.txt

# Set environment variables
export CONFIG_CATALOG=<your-config-catalog>
export CONFIG_SCHEMA=uc_tag_studio
export SQL_WAREHOUSE_ID=<warehouse-id>

# Start the server (uses fevm01 CLI profile automatically)
uvicorn app:app --host 0.0.0.0 --port 8000 --reload
```

For the frontend dev server (with hot reload):
```bash
cd frontend
npm install
npm run dev
# Open http://localhost:5173 — proxies /api/* to http://localhost:8000
```

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
databricks apps stop  uc-tag-studio --profile fevm01
databricks apps start uc-tag-studio --profile fevm01
```

No code change, no `bundle deploy`, no git commit. The `{{secrets/...}}` placeholder in `app.yaml` is resolved fresh every time the app container starts.

---

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---|---|---|
| Identity endpoint 502 | App SP credentials not injected or workspace unreachable | Check app logs; verify app is in RUNNING state |
| Catalogs not loading — permission error | App SP lacks `USE CATALOG` or `USE SCHEMA` | Run `grants_primary_region.sql` for the app SP |
| Config tables 502 — table not found | Config tables don't exist yet | Run `setup/create_config_tables.sql` |
| Secondary workspace not appearing | `SEC_1_WORKSPACE_URL` not set in `app.yaml` | Add the `SEC_1_*` env var block, redeploy, and restart the app |
| Secondary workspace `invalid_client` / 502 | SP secret expired or wrong | Regenerate SP secret → run `setup/setup_secrets.sh` → restart app |
| Secondary workspace `secret not found` | Scope or key doesn't exist, or app SP lacks READ | Run `setup/setup_secrets.sh`; verify ACLs with `databricks secrets list-acls` |
| Tags not saving on secondary workspace | SP missing `APPLY TAG` on catalog | Re-run `grants_secondary_region.sql` |
| Tables not visible for selected workspace | Wrong workspace selected in dropdown, or scope entries not added | Switch workspace in navbar; add scope entries in Configuration tab for that workspace |
| App fails to start (startup error) | Import error, missing env var, or unresolvable `{{secrets/...}}` | Check `databricks apps logs uc-tag-studio --profile fevm01` |
| Tables not loading in Tag Management | SP lacks `USE SCHEMA` on that catalog/schema | Verify `grants_primary_region.sql` was run for the app SP |

### View app logs

```bash
databricks apps logs uc-tag-studio --profile fevm01
```

Errors logged as `ERROR app: API 502 on /api/...: <message>` show the actual exception. `502 Bad Gateway` responses also include the error message in the response body (visible in browser DevTools → Network tab).
