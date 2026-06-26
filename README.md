# UC Tag Studio

A Databricks App for managing Unity Catalog table tags across a primary workspace and one or more secondary workspaces. The app runs in the **Primary Region** and lets you switch context to any configured secondary workspace at any time.

---

## Overview

This app provides a centralised UI for data stewards and catalog admins to:

- Apply and manage **tags** on tables across configured catalogs and schemas
- Track **tag coverage** across the catalog
- Configure **which catalogs and schemas** are in scope (per workspace)
- Define a **tag dictionary** — the allowed tag keys and their permitted values
- **Switch between workspaces** — view and manage metadata for one workspace at a time

All operations are **metadata-only**. The app never grants `SELECT` and cannot read table data.

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    Databricks App                        │
│                  Primary Region workspace                │
│                                                          │
│   React Frontend  ←→  FastAPI Backend (uvicorn)         │
│                           │                              │
│                   Databricks Python SDK                  │
│                           │                              │
│        ┌──────────────────┴────────────────┐            │
│        │ App SP (auto-injected)            │ SP creds    │
│        │ (DATABRICKS_CLIENT_ID/SECRET)     │ (M2M OAuth) │
└────────┼──────────────────────────────────┼─────────────┘
         │ Primary workspace ops             │ Secondary workspace ops
         ▼                                   ▼
┌────────────────────┐         ┌──────────────────────────┐
│  Primary Region UC │         │  Secondary Region        │
│                    │         │  Workspace               │
│  Config tables:    │         │                          │
│  · tag_dictionary  │         │  Target catalogs,        │
│  · scope_config    │         │  schemas, tables,        │
│                    │         │  tags                    │
└────────────────────┘         └──────────────────────────┘
```

**Authentication model — SP only:**

| Workspace | Auth method | Why |
|---|---|---|
| Primary | App SP auto-injected by the Databricks Apps platform (`DATABRICKS_CLIENT_ID/SECRET`) | No user token required; `sql` scope is enough for `information_schema` SQL |
| Secondary | Dedicated SP credentials stored in Databricks Secrets, fetched at startup | User has no OAuth token for a foreign workspace; SP is created at Databricks account level, added to the secondary workspace, and granted UC permissions there |

---

## Workspace Switcher

The navbar shows a **read-only workspace label** with a coloured dot indicating the active workspace:

- **Green dot** — Primary workspace (where the app is deployed)
- **Purple dot** — Secondary workspace

To switch workspaces, open the **Settings** tab → **Workspace** section and click the target workspace card. All tabs re-filter their data instantly — no page reload.

Secondary workspaces are discovered from `SEC_1_WORKSPACE_URL`, `SEC_2_WORKSPACE_URL`, … env vars set in `app.yaml`. The full list (primary + secondaries) is fetched once at app load via `GET /api/config/workspaces`.

---

## App Tabs

### Overview
High-level coverage dashboard for the **selected workspace**:
- Total tables in scope
- % tables with at least one tag applied
- Per-schema breakdown with progress bars

Metrics are recomputed client-side by filtering `per_schema` rows to the selected workspace — switching workspaces updates the dashboard instantly without a new API call.

### Tag Management
Tabular view of all tables in active scope for the **selected workspace**. Tag columns are dynamically generated from the tag dictionary.

| Catalog | Schema | Table | sensitivity | domain | pii | |
|---|---|---|---|---|---|---|
| main | analytics | events | — | — | — | Edit |
| sec_cat | sales | orders | high | sales | yes | Edit |

Filter bar (client-side): Catalog, Schema, Table name, and "Untagged only" checkbox.

**Edit** opens a modal pre-populated with the table's current tags. Each tag key from the dictionary is shown as a dropdown (constrained values) or text input (free text). Saving runs `ALTER TABLE … SET/UNSET TAGS` SQL via the warehouse.

### Settings
Two inner sub-tabs: **Workspace** and **Tag Dictionary**.

**Workspace sub-tab:**
- Workspace selector cards — click to switch the active workspace (green = primary, purple = secondary)
- Identity banner — shows the app SP name and SQL warehouse ID
- Scope section — manage which catalogs and schemas are in scope for the selected workspace. Catalog and schema dropdowns use `SHOW CATALOGS` / `information_schema.schemata` SQL (primary) or SP credentials (secondary). Each entry can be toggled active/inactive or removed.
- "Add Secondary Workspace" — collapsible step-by-step guide (collapsed by default) for creating a SP, granting it UC permissions, and wiring it into `app.yaml`.

**Tag Dictionary sub-tab** — define allowed tag keys and their values. Saved to `govern_tag_dictionary`.

| Tag Key | Allowed Values | Free Text |
|---|---|---|
| sensitivity | high, medium, low | No |
| domain | sales, finance, hr | Yes |
| pii | yes, no | No |

---

## Permission Model

### App Service Principal — Primary Region

| Grant | Purpose |
|---|---|
| `USE CATALOG` on config catalog | Navigate to the config schema |
| `USE SCHEMA` on config schema | Access config tables |
| `SELECT` + `MODIFY` on `govern_tag_dictionary`, `govern_scope_config` | Read and write config |
| `CAN USE` on SQL warehouse | Execute SQL statements |
| `USE CATALOG` + `USE SCHEMA` on any catalog in scope | List tables, read tags via `information_schema` |
| `APPLY TAG` on catalogs/schemas in scope | Apply/remove tags |

### Dedicated Service Principal — Secondary Region

| Grant | Purpose |
|---|---|
| `USE CATALOG` on target catalog | Navigate the catalog |
| `USE SCHEMA ON CATALOG` (catalog-level) | Navigate all schemas — cascades to future schemas |
| `APPLY TAG ON CATALOG` (catalog-level) | Write/remove tags on all schemas — cascades to future schemas |
| `CAN USE` on SQL warehouse | Execute DDL statements |

Catalog-level grants are set once and cover all current and future schemas — no re-grant is needed when adding a new schema to scope.

`SELECT` is **never granted** — the SP cannot read table data.

---

## Repository Structure

```
uc-tag-studio/
│
├── README.md                        # This file
├── INSTRUCTIONS.md                  # Step-by-step setup guide
├── APP_FLOW.md                      # End-to-end action flows
├── databricks.yml                   # Databricks Asset Bundle config
│
├── setup/
│   ├── create_config_tables.sql     # One-time DDL: create config tables
│   ├── grants_primary_region.sql    # UC grants for app SP (primary workspace)
│   ├── grants_secondary_region.sql  # UC grants for secondary SP (catalog-level, tags only)
│   └── setup_secrets.sh             # Create secret scope and store SP credentials
│
├── app.yaml                         # Databricks App manifest (env vars, resources)
├── app.py                           # FastAPI entry point + SPA serving
├── requirements.txt                 # Pinned Python deps
│
├── server/
│   ├── config.py                    # Auth: get_primary_client() / get_secondary_client()
│   ├── dependencies.py              # Shared FastAPI dependencies
│   ├── routers/
│   │   ├── catalogs.py              # GET /api/catalogs, /api/schemas
│   │   ├── tables.py                # GET /api/tables
│   │   ├── tags.py                  # GET/PATCH /api/tags
│   │   ├── config.py                # GET/POST/DELETE /api/config/* + identity + workspaces
│   │   └── overview.py              # GET /api/overview/metrics
│   └── services/
│       ├── unity_catalog.py         # UC ops via SQL (primary) and SDK/SQL (secondary)
│       └── delta_config.py          # Config table CRUD via SQL warehouse
│
└── frontend/
    ├── src/
    │   ├── App.tsx                  # Shell: WorkspaceSelector, UserAvatar, tab routing
    │   ├── api/client.ts            # Typed API client (TanStack Query)
    │   └── tabs/
    │       ├── Overview.tsx         # Metrics dashboard, workspace-filtered
    │       ├── TagManagement.tsx    # Tag table, workspace-filtered
    │       ├── Configuration.tsx    # Settings: workspace selector, scope, tag dictionary
    │       └── Instructions.tsx     # Collapsible SP setup guide (embedded in Settings)
    └── package.json
```

---

## Key Design Decisions

| Decision | Choice | Reason |
|---|---|---|
| Primary workspace auth | App SP auto-injected by Databricks Apps platform | Consistent SP-only model; no user token handling needed |
| Secondary workspace auth | Dedicated SP credentials (OAuth M2M) | User has no OAuth token for a foreign workspace |
| Secondary grants | Catalog-level `USE SCHEMA` + `APPLY TAG` | Cascades to all current and future schemas — no re-grant on scope changes |
| OAuth scope | `sql` only (not `unity-catalog`) | All UC reads use `information_schema` SQL; `SHOW CATALOGS` instead of UC REST |
| Workspace switcher | Client-side state in `App.tsx`; selector in Settings tab; navbar shows read-only label | Each tab filters its data without extra API calls |
| Config storage | Delta tables in Primary Region | Persistent, queryable, low-latency |
| Multi-secondary support | `workspace_url` column in `scope_config`; secondaries from `SEC_N_*` env vars | Each scope entry knows which workspace it belongs to; no separate Delta table needed |
| Data access | None | App is metadata-only; no risk of data exposure |
| Tag writes | SQL `ALTER TABLE … SET/UNSET TAGS` | Metadata-only DDL, no data access implied |

---

## Setup

See [INSTRUCTIONS.md](INSTRUCTIONS.md) for the full step-by-step guide.

**Quick summary:**
1. Create config tables in Primary Region (`setup/create_config_tables.sql`)
2. Grant app SP access to config tables and managed catalogs (`setup/grants_primary_region.sql`)
3. Create a Service Principal for Secondary Region access
4. Grant the SP catalog-level permissions in Secondary Region (`setup/grants_secondary_region.sql`)
5. Store the SP credentials in Databricks Secrets: `./setup/setup_secrets.sh --profile fevm01`
6. Configure env vars in `app.yaml` (use `{{secrets/tag-governance/sec-1-sp-secret}}` for the secret)
7. Build frontend: `npm run build --prefix frontend`
8. Deploy: `databricks bundle deploy --target dev --profile fevm01`
