# UC Tag Studio — Installation Guide

This guide walks you through deploying UC Tag Studio end-to-end.

The install flow is **deploy-first**: you deploy the app, open it, and the app's **Setup Validation** page generates the exact SQL scripts you need to run — with your real catalog names, SP UUID, and warehouse ID already filled in. An admin pastes those scripts into the SQL warehouse editor and the app is fully operational.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Architecture Overview](#2-architecture-overview)
3. [Clone the Repository](#3-clone-the-repository)
4. [Configure the Databricks CLI](#4-configure-the-databricks-cli)
5. [Store Secondary SP Credentials in Secrets](#5-store-secondary-sp-credentials-in-secrets)
6. [Configure app.yaml](#6-configure-appyaml)
7. [Build and Deploy with DABs](#7-build-and-deploy-with-dabs)
8. [Run Setup SQL via the App Validation Page](#8-run-setup-sql-via-the-app-validation-page)
9. [Verify the Deployment](#9-verify-the-deployment)
10. [Updating the App](#10-updating-the-app)
11. [Manual Setup Scripts (Alternative)](#11-manual-setup-scripts-alternative)
12. [Troubleshooting](#12-troubleshooting)

---

## 1. Prerequisites

### Software Requirements

| Tool | Minimum Version | How to Check |
|---|---|---|
| **Databricks CLI** | v0.220+ | `databricks --version` |
| **Python** | 3.9+ | `python3 --version` |
| **Node.js** | 18+ | `node --version` |
| **npm** | 8+ | `npm --version` |
| **Git** | any | `git --version` |

Install the Databricks CLI:

```bash
# macOS (Homebrew)
brew tap databricks/tap
brew install databricks

# Other platforms — see https://docs.databricks.com/en/dev-tools/cli/install.html
```

### Databricks Requirements

- **Primary workspace** (where the app runs) — must support Databricks Apps (Premium tier or above) with Unity Catalog enabled.
- **Secondary workspace** (optional) — any UC-enabled workspace whose catalogs you want to tag from the app.
- **Metastore admin or catalog owner** rights on both workspaces — needed to run the `GRANT` statements generated in Step 9.
- **A SQL Warehouse** in the primary workspace — the app executes all DDL (tags, config table CRUD) through it.

---

## 2. Architecture Overview

```
Your Browser
     │
     ▼
┌──────────────────────────────────────────────────────┐
│           Databricks Apps (Primary Workspace)        │
│                                                      │
│  React SPA  ←→  FastAPI backend                      │
│                      │                               │
│         ┌────────────┴──────────────┐               │
│         │ App SP (auto-injected)    │ Secondary SP   │
│         │ DATABRICKS_CLIENT_ID      │ (from Secrets) │
│         │ DATABRICKS_CLIENT_SECRET  │                │
└─────────┼───────────────────────────┼────────────────┘
          │                           │
          ▼                           ▼
   Primary workspace UC        Secondary workspace UC
   ┌───────────────────┐       ┌──────────────────────┐
   │ Config tables:    │       │ Target catalogs,     │
   │ govern_tag_dict   │       │ schemas, tables,     │
   │ govern_scope_cfg  │       │ tags                 │
   └───────────────────┘       └──────────────────────┘
```

**How authentication works:**
- All operations run as **service principals** — no user tokens.
- The **app SP** is auto-injected by the platform. It manages config tables and tags in the primary workspace.
- A **secondary SP** (credentials stored in Databricks Secrets) handles each secondary workspace.
- The app is **metadata-only** — it never reads table data.

**Why GRANT statements need an admin:**
The app SP is not a catalog owner by default, so it cannot grant permissions to itself. The `GRANT` SQL must be executed once by a metastore admin or catalog owner. The app generates this SQL with your real values so the admin can copy-paste it directly.

---

## 3. Clone the Repository

```bash
git clone https://github.com/kuldeep-in/uc-tag-studio.git
cd uc-tag-studio
```

---

## 4. Configure the Databricks CLI

```bash
databricks configure --profile fevm01
```

When prompted:
- **Databricks host** — full URL of your primary workspace, e.g. `https://adb-1234567890.1.azuredatabricks.net`
- **Token** — a personal access token with admin rights (used only for one-time CLI deploy operations)

Verify it works:

```bash
databricks catalogs list --profile fevm01
```

---

## 5. Store Secondary SP Credentials in Secrets

> **Skip this step if you only have one workspace.**

The secondary SP credentials are stored in a Databricks Secret scope so they are never in git or in plaintext in `app.yaml`.

### 5a. Create the secondary SP

1. Go to **accounts.cloud.databricks.com → User Management → Service Principals → Add service principal**.
2. Name it e.g. `uc-tag-studio-secondary-sp`. Copy the **Application (client) ID**.
3. On the SP detail page → **Secrets** tab → **Add secret**. Copy the secret value immediately (shown once only).
4. Add the SP to the **secondary workspace**: **Settings → Identity & Access → Service Principals → Add service principal**.

### 5b. Store credentials

Run the setup script (recommended — hides input, sets ACLs automatically):

```bash
chmod +x setup/setup_secrets.sh
./setup/setup_secrets.sh --profile fevm01
```

The script will:
1. Create the `tag-governance` secret scope (idempotent).
2. Prompt for the secondary SP **client ID** (hidden input).
3. Prompt for the secondary SP **client secret** (hidden input).
4. Print the `{{secrets/...}}` references to paste into `app.yaml`.

> **App SP ACL:** The script also grants the app SP READ access on the scope. Since the app SP is created by DABs during `bundle deploy` (Step 7), you can either run the ACL grant after deploy, or skip it now and grant it manually after deploy with:
> ```bash
> databricks secrets put-acl --scope tag-governance \
>   --principal <app-sp-uuid> --permission READ --profile fevm01
> ```
> The app SP UUID is shown in the app validation page (Step 8) — no need to look it up manually.

**Or manually:**

```bash
databricks secrets create-scope --scope tag-governance --profile fevm01

databricks secrets put-secret --scope tag-governance --key sec-1-sp-client-id --profile fevm01
# paste application client ID when prompted

databricks secrets put-secret --scope tag-governance --key sec-1-sp-secret --profile fevm01
# paste client secret when prompted

# Run this after Step 7 deploy, once you have the app SP UUID from the validation page:
databricks secrets put-acl \
  --scope tag-governance \
  --principal <app-sp-uuid> \
  --permission READ \
  --profile fevm01
```

---

## 7. Configure app.yaml

`app.yaml` is the single source of truth for all runtime configuration. Open it and fill in your values:

```yaml
command: ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]

env:
  # ── Config table location ─────────────────────────────────────────────────
  - name: CONFIG_CATALOG
    value: "your_catalog"           # catalog where govern_* tables will be created

  - name: CONFIG_SCHEMA
    value: "uc_tag_studio"          # schema where govern_* tables will be created

  - name: SQL_WAREHOUSE_ID
    value: "be36b9019531b864"       # primary workspace SQL warehouse ID

  # ── Secondary workspace (add SEC_2_*, SEC_3_*, ... for more) ─────────────
  - name: SEC_1_WORKSPACE_URL
    value: "https://adb-9876543210.2.azuredatabricks.net"

  - name: SEC_1_DISPLAY_NAME
    value: "Azure West Europe"

  - name: SEC_1_SP_CLIENT_ID
    value: "{{secrets/tag-governance/sec-1-sp-client-id}}"

  - name: SEC_1_SP_CLIENT_SECRET
    value: "{{secrets/tag-governance/sec-1-sp-secret}}"

  - name: SEC_1_SQL_WAREHOUSE_ID
    value: "abc123def456"
```

### Variable reference

| Variable | Required | Description |
|---|---|---|
| `CONFIG_CATALOG` | Yes | Catalog that holds the two config tables |
| `CONFIG_SCHEMA` | Yes | Schema that holds the two config tables |
| `SQL_WAREHOUSE_ID` | Yes | Primary workspace SQL warehouse for all queries |
| `SEC_N_WORKSPACE_URL` | Per secondary | Full HTTPS URL of the secondary workspace |
| `SEC_N_DISPLAY_NAME` | Per secondary | Label shown in the workspace switcher UI |
| `SEC_N_SP_CLIENT_ID` | Per secondary | Use `{{secrets/tag-governance/sec-1-sp-client-id}}` |
| `SEC_N_SP_CLIENT_SECRET` | Per secondary | Use `{{secrets/tag-governance/sec-1-sp-secret}}` — never raw value |
| `SEC_N_SQL_WAREHOUSE_ID` | Per secondary | SQL warehouse in the secondary workspace |

> The `{{secrets/scope/key}}` syntax is resolved by the Databricks Apps runtime on every container start. Raw secret values never appear in git, logs, or bundle output.

---

## 7. Build and Deploy with DABs

DABs manages the full lifecycle in a single command — it creates the app and its service principal, uploads source files, and starts the app. You do not need to create the app manually in the UI first.

The app resource is defined in `databricks.yml`:

```yaml
resources:
  apps:
    uc-tag-studio:
      name: uc-tag-studio
      description: "Unity Catalog tag management across workspaces"
      source_code_path: .
```

### Build the frontend

```bash
npm install --prefix frontend       # first time only
npm run build --prefix frontend     # compiles React into frontend/dist/
```

### Deploy everything with one command

```bash
databricks bundle deploy --target dev --profile fevm01
```

DABs will:
1. **Create the app** in Databricks (if it doesn't exist yet) — this also creates the app SP automatically.
2. **Upload all source files** (Python backend, `frontend/dist/`, `app.yaml`, etc.) to the workspace.
3. **Start the app** using the configuration in `app.yaml`.

A successful deploy ends with output like:

```
Uploading bundle files to /Workspace/Users/.../.bundle/uc-tag-studio/dev/files...
Deploying resources...
  Updating app uc-tag-studio...
Deployment complete!
```

> **App SP UUID is available at runtime.** DABs creates the app SP during `bundle deploy`. The app reads its own SP UUID from the `DATABRICKS_CLIENT_ID` environment variable (auto-injected by the platform on every container start). The validation page in Step 8 displays this UUID directly — you never need to look it up manually.

> **Subsequent deploys:** Re-running `databricks bundle deploy` updates the existing app in-place. The app SP and its UUID remain stable across deploys.

---

## 8. Run Setup SQL via the App Validation Page

This is the key step. Open the app URL (printed at the end of `bundle deploy`) and navigate to **Settings → Setup**.

The validation page checks the current state of the deployment and generates the exact SQL an admin needs to run — with your real catalog names, SP UUID, and warehouse ID already substituted in. Each section has a status badge and, if action is required, a ready-to-run SQL block.

**How the page knows the SP UUID:** The app reads `DATABRICKS_CLIENT_ID` from the environment — this is auto-injected by the Databricks Apps platform and contains the app SP's application UUID. No manual lookup required.

---

### What the validation page shows

#### Section A — Config Tables

**Status check:** Does `govern_tag_dictionary` and `govern_scope_config` exist in `CONFIG_CATALOG.CONFIG_SCHEMA`?

If missing, the page shows:

```sql
-- ══════════════════════════════════════════════════════════════
-- A. Create config tables
-- Run in: Primary workspace SQL editor
-- Required: CREATE TABLE privilege on CONFIG_CATALOG.CONFIG_SCHEMA
-- ══════════════════════════════════════════════════════════════

CREATE SCHEMA IF NOT EXISTS `classic_stable_kuldeep`.`uc_tag_studio`;

CREATE TABLE IF NOT EXISTS `classic_stable_kuldeep`.`uc_tag_studio`.`govern_tag_dictionary` (
  tag_key        STRING    NOT NULL,
  allowed_values ARRAY<STRING>,
  free_text      BOOLEAN   DEFAULT false,
  sort_order     INT,
  created_at     TIMESTAMP DEFAULT current_timestamp(),
  updated_at     TIMESTAMP DEFAULT current_timestamp()
) USING DELTA;

CREATE TABLE IF NOT EXISTS `classic_stable_kuldeep`.`uc_tag_studio`.`govern_scope_config` (
  workspace_url  STRING  NOT NULL,
  catalog_name   STRING  NOT NULL,
  schema_name    STRING  NOT NULL,
  is_active      BOOLEAN DEFAULT true,
  added_at       TIMESTAMP DEFAULT current_timestamp()
) USING DELTA;
```

> The catalog and schema are read from `CONFIG_CATALOG` / `CONFIG_SCHEMA` in `app.yaml` — they are already substituted into the SQL.

---

#### Section B — App SP Grants (Primary Workspace)

**Status check:** Can the app SP query `govern_tag_dictionary`? Can it list schemas?

If grants are missing, the page shows:

```sql
-- ══════════════════════════════════════════════════════════════
-- B. Grant app SP access — Primary workspace
-- Run in: Primary workspace SQL editor
-- Required: Metastore admin or catalog owner
-- App SP: uc-tag-studio-sp  (6394e5cb-c5ea-43b8-b239-060d2dc17b68)
-- ══════════════════════════════════════════════════════════════

-- Config table access
GRANT USE CATALOG ON CATALOG `classic_stable_kuldeep`
  TO `6394e5cb-c5ea-43b8-b239-060d2dc17b68`;

GRANT USE SCHEMA ON SCHEMA `classic_stable_kuldeep`.`uc_tag_studio`
  TO `6394e5cb-c5ea-43b8-b239-060d2dc17b68`;

GRANT SELECT, MODIFY
  ON TABLE `classic_stable_kuldeep`.`uc_tag_studio`.`govern_tag_dictionary`
  TO `6394e5cb-c5ea-43b8-b239-060d2dc17b68`;

GRANT SELECT, MODIFY
  ON TABLE `classic_stable_kuldeep`.`uc_tag_studio`.`govern_scope_config`
  TO `6394e5cb-c5ea-43b8-b239-060d2dc17b68`;

-- ── Managed catalogs — add one block per catalog you want the app to tag ──
-- These three grants cascade to ALL schemas and tables in the catalog.
-- No per-schema re-grants needed, even when new schemas are added.

-- GRANT USE CATALOG ON CATALOG `<your_catalog>` TO `6394e5cb-c5ea-43b8-b239-060d2dc17b68`;
-- GRANT USE SCHEMA  ON CATALOG `<your_catalog>` TO `6394e5cb-c5ea-43b8-b239-060d2dc17b68`;
-- GRANT APPLY TAG   ON CATALOG `<your_catalog>` TO `6394e5cb-c5ea-43b8-b239-060d2dc17b68`;
```

> The app SP UUID and config location are filled in automatically. The admin only needs to uncomment and fill in the catalog names for the managed catalog block.

---

#### Section C — Secondary Workspace Grants

**Status check:** Is the secondary workspace reachable? Does the secondary SP return a valid token?

If the secondary SP can connect but tag writes fail, the page shows:

```sql
-- ══════════════════════════════════════════════════════════════
-- C. Grant secondary SP access — Secondary workspace
-- Run in: Secondary workspace SQL editor (not primary)
-- Required: Metastore admin or catalog owner in secondary workspace
-- Secondary SP: uc-tag-studio-secondary-sp
-- ══════════════════════════════════════════════════════════════

-- Repeat this block for each catalog in the secondary workspace to manage.
-- All three grants cascade to ALL schemas and tables in the catalog.

-- GRANT USE CATALOG ON CATALOG `<your_catalog>` TO `<secondary-sp-client-id>`;
-- GRANT USE SCHEMA  ON CATALOG `<your_catalog>` TO `<secondary-sp-client-id>`;
-- GRANT APPLY TAG   ON CATALOG `<your_catalog>` TO `<secondary-sp-client-id>`;
```

---

### How to run the generated SQL

1. In the app validation page, click **Copy** on the SQL block for each failing section.
2. Open the **primary workspace SQL editor** (for Sections A and B) or the **secondary workspace SQL editor** (for Section C).
3. Select your SQL warehouse from the dropdown.
4. Paste and run.
5. Refresh the app validation page — the status badges update as each check passes.

> **Why the app cannot run GRANT statements itself:** `GRANT` requires the executor to be a metastore admin or catalog owner. The app SP is neither by default — this is an intentional Unity Catalog security boundary. The app generating the SQL and a human admin executing it is the correct separation of concerns.

---

### Setup status summary

Once all checks pass, the validation page shows a summary like:

```
✓  Config tables exist            classic_stable_kuldeep.uc_tag_studio
✓  App SP — config table access   govern_tag_dictionary, govern_scope_config
✓  App SP — catalog access        3 catalogs, USE SCHEMA + APPLY TAG confirmed
✓  Secondary workspace reachable  Azure West Europe
✓  Secondary SP — catalog access  2 catalogs, APPLY TAG confirmed
```

At this point the app is fully operational.

---

## 9. Verify the Deployment

After all setup SQL has been run, verify end-to-end:

1. **Avatar loads** — the top-right corner shows the app SP's initials. If it spins forever, check app logs.
2. **Settings → Workspace → App Identity** — confirms:
   - "Running as: Service Principal" badge
   - Correct SP display name
   - Config Catalog and Schema match `app.yaml` (not "not set")
   - SQL Warehouse ID is populated
3. **Add a scope entry** — select a catalog and schema in the Scope section and click **Add to scope**.
4. **Tag Management** — tables from the scope entry appear in the list.
5. **Edit tags** — click **Edit**, set a tag value, save. No error toast, row updates immediately.
6. **Secondary workspace** (if configured) — click the secondary workspace card. Navbar turns purple. Tables load.

---

## 10. Updating the App

### Code or frontend changes

```bash
npm run build --prefix frontend
databricks bundle deploy --target dev --profile fevm01
```

### app.yaml changes only (no frontend rebuild needed)

```bash
databricks bundle deploy --target dev --profile fevm01
```

### Rotate a secondary SP secret

```bash
# 1. Generate a new secret in accounts.cloud.databricks.com (old one invalidated immediately)

# 2. Update the stored secret:
databricks secrets put-secret --scope tag-governance --key sec-1-sp-secret --profile fevm01

# 3. Redeploy to restart the container and pick up the new value:
databricks bundle deploy --target dev --profile fevm01
```

No code change or git commit required.

### Add a managed catalog

Add it to `v_managed_catalogs` in `setup/grants_primary_region.sql` and re-run Section 2 in the primary workspace SQL editor. Grants are idempotent — safe to re-run the full script.

### Add a secondary workspace

1. Create a SP (Step 5a). Grant it catalog access in the secondary workspace (Section C SQL from the validation page).
2. Store credentials:
   ```bash
   databricks secrets put-secret --scope tag-governance --key sec-2-sp-client-id --profile fevm01
   databricks secrets put-secret --scope tag-governance --key sec-2-sp-secret --profile fevm01
   databricks secrets put-acl --scope tag-governance --principal <app-sp-uuid> --permission READ --profile fevm01
   ```
3. Add `SEC_2_*` vars to `app.yaml` and redeploy: `databricks bundle deploy --target dev --profile fevm01`

---

## 11. Manual Setup Scripts (Alternative)

If you prefer to run setup scripts directly from the CLI rather than using the app validation page, the `setup/` directory contains ready-made scripts:

| Script | Purpose | Where to run |
|---|---|---|
| `setup/create_config_tables.sql` | Creates `govern_tag_dictionary` and `govern_scope_config` | Primary workspace SQL editor |
| `setup/grants_primary_region.sql` | Grants app SP access to config tables and managed catalogs | Primary workspace SQL editor |
| `setup/grants_secondary_region.sql` | Grants secondary SP catalog-level tag access | Secondary workspace SQL editor |
| `setup/setup_secrets.sh` | Creates secret scope, stores SP credentials, sets ACLs | Local terminal via Databricks CLI |

Edit the `DECLARE VARIABLE` block at the top of each SQL file before running. Each script is idempotent and can be re-run safely.

```bash
# Example — run the primary grants script via CLI
databricks sql execute \
  --warehouse-id <warehouse-id> \
  --file setup/grants_primary_region.sql \
  --profile fevm01
```

---

## 12. Troubleshooting

### View app logs

```bash
databricks apps logs uc-tag-studio --profile fevm01
```

Errors appear as `ERROR app: API 502 on /api/...: <detail>`. The same message is in the HTTP response body (visible in browser DevTools → Network tab).

### Common issues

| Symptom | Likely cause | Fix |
|---|---|---|
| SP initials never appear (spinner) | App SP not injected or identity API fails | Check logs; confirm app is RUNNING in Databricks UI |
| Config catalog / schema shows "not set" | `CONFIG_CATALOG` or `CONFIG_SCHEMA` missing from `app.yaml` | Add the env var and redeploy |
| Config tables error — table not found | Tables not created yet | Run Section A SQL from the validation page |
| Catalogs not loading in dropdown | App SP lacks `USE CATALOG` or `USE SCHEMA` | Run Section B SQL from the validation page |
| Tags not saving — permission denied | App SP lacks `APPLY TAG` on the catalog | Run Section B (managed catalog block) from the validation page |
| Secondary workspace not in selector | `SEC_1_WORKSPACE_URL` missing or wrong index | Check `app.yaml`; variable must be exactly `SEC_1_WORKSPACE_URL` |
| Secondary workspace `invalid_client` | Wrong SP client ID or secret | Re-run `setup/setup_secrets.sh`; verify application ID in accounts console |
| Secondary workspace `secret not found` | Scope or key name wrong, or app SP missing READ ACL | Run `databricks secrets list-acls --scope tag-governance --profile fevm01` |
| Tags not saving on secondary | Secondary SP missing `APPLY TAG` | Run Section C SQL from the validation page in the secondary workspace |
| Blank page after deploy | Frontend not built | Run `npm run build --prefix frontend` then `databricks bundle deploy` |
| `tsc: command not found` on build | Node modules not installed | Run `npm install --prefix frontend` first |

### Check secret scope ACLs

```bash
databricks secrets list-acls --scope tag-governance --profile fevm01
```

The app SP UUID must appear with `READ` permission.

### Check app SP UUID

```bash
databricks apps get uc-tag-studio --profile fevm01 | grep -i service_principal
```

Or: **Databricks UI → Compute → Apps → uc-tag-studio → Service Principal**.

---

## Local Development

```bash
# Install Python dependencies
pip install -r requirements.txt

# Set env vars
export CONFIG_CATALOG=your_catalog
export CONFIG_SCHEMA=uc_tag_studio
export SQL_WAREHOUSE_ID=be36b9019531b864

# Start backend (uses fevm01 CLI profile automatically)
uvicorn app:app --host 0.0.0.0 --port 8000 --reload
```

Frontend dev server with hot reload:

```bash
cd frontend
npm install
npm run dev
# http://localhost:5173 — /api/* proxies to http://localhost:8000
```
