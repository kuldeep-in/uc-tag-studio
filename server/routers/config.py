"""Config endpoints — scope, tag dictionary, and secondary workspaces."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from server.services import delta_config as cfg

router = APIRouter(prefix="/api/config", tags=["config"])


@router.get("/identity")
def get_identity():
    """Return the identity of the app service principal and config location."""
    try:
        import os
        from server.config import get_primary_client, SQL_WAREHOUSE_ID, CONFIG_CATALOG, CONFIG_SCHEMA
        client = get_primary_client()
        me = client.current_user.me()
        # DATABRICKS_CLIENT_ID is the app SP's application UUID, auto-injected by the platform.
        # user_name for a service principal is the same UUID — exposed separately for clarity.
        sp_client_id = os.environ.get("DATABRICKS_CLIENT_ID", me.user_name or "")
        return {
            "user_name": me.user_name,
            "display_name": me.display_name or me.user_name or "",
            "is_service_principal": not me.user_name or "@" not in (me.user_name or ""),
            "sp_client_id": sp_client_id,
            "sql_warehouse_id": SQL_WAREHOUSE_ID,
            "config_catalog": CONFIG_CATALOG,
            "config_schema": CONFIG_SCHEMA,
        }
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=str(exc))


class ScopeBody(BaseModel):
    workspace_url: str = "primary"
    catalog: str
    schema: str
    is_active: bool = True


class TagDictBody(BaseModel):
    tag_key: str
    allowed_values: list[str] | None = None
    free_text: bool = False




# --------------------------------------------------------------------------- #
# Scope
# --------------------------------------------------------------------------- #
@router.get("/scope")
def get_scope():
    try:
        return cfg.get_scope_config()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=str(exc))


@router.post("/scope")
def post_scope(body: ScopeBody):
    try:
        return cfg.upsert_scope(body.workspace_url, body.catalog,
                                body.schema, body.is_active)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=str(exc))


@router.delete("/scope")
def delete_scope(body: ScopeBody):
    try:
        return cfg.delete_scope(body.workspace_url, body.catalog, body.schema)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=str(exc))


# --------------------------------------------------------------------------- #
# Tag dictionary
# --------------------------------------------------------------------------- #
@router.get("/tagdictionary")
def get_tag_dictionary():
    try:
        return cfg.get_tag_dictionary()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=str(exc))


@router.post("/tagdictionary")
def post_tag_dictionary(body: TagDictBody):
    try:
        return cfg.upsert_tag_key(body.tag_key, body.allowed_values, body.free_text)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=str(exc))


@router.delete("/tagdictionary/{tag_key}")
def delete_tag_dictionary(tag_key: str):
    try:
        return cfg.delete_tag_key(tag_key)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=str(exc))


class TagOrderBody(BaseModel):
    ordered_keys: list[str]


@router.put("/tagdictionary/order")
def put_tag_order(body: TagOrderBody):
    try:
        cfg.set_tag_order(body.ordered_keys)
        return {"ordered_keys": body.ordered_keys}
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=str(exc))


# --------------------------------------------------------------------------- #
# Setup / Health Check validation
# --------------------------------------------------------------------------- #

def _perm_ok(pid, group, resource, privilege, check_group_id="app", check_group_label="App Checks",
             fix_sql=None, fix_where=None):
    return {"id": pid, "group": group, "resource": resource,
            "privilege": privilege, "status": "ok", "message": "Granted",
            "fix_sql": fix_sql, "fix_where": fix_where,
            "check_group_id": check_group_id, "check_group_label": check_group_label}


def _perm_err(pid, group, resource, privilege, exc, fix_sql=None, fix_where=None,
              check_group_id="app", check_group_label="App Checks"):
    import re as _re
    msg = str(exc)
    m = _re.search(r'message="([^"]+)"', msg)
    short = (m.group(1).split("\n")[0] if m else msg.split("\n")[0])[:300]
    return {"id": pid, "group": group, "resource": resource,
            "privilege": privilege, "status": "error", "message": short,
            "fix_sql": fix_sql, "fix_where": fix_where,
            "check_group_id": check_group_id, "check_group_label": check_group_label}


def _perm_warn(pid, group, resource, privilege, message, fix_sql=None, fix_where=None,
               check_group_id="app", check_group_label="App Checks"):
    return {"id": pid, "group": group, "resource": resource,
            "privilege": privilege, "status": "warning", "message": message,
            "fix_sql": fix_sql, "fix_where": fix_where,
            "check_group_id": check_group_id, "check_group_label": check_group_label}


def _generate_setup_events(groups: set | None = None):
    """Yield meta / check / permission / done events grouped by check_group_id.

    groups: set of group IDs to run ('app', 'primary', 'secondary_1', ...).
            None means run all groups.
    Steps are numbered 1..N within each group.
    """
    import os
    from server.config import (
        CONFIG_CATALOG, CONFIG_SCHEMA, SQL_WAREHOUSE_ID,
        get_primary_client, _parse_secondary_workspaces_from_env, _build_secondary_client,
    )
    from server.services.unity_catalog import _query_sql

    run_all = groups is None
    run_app = run_all or "app" in groups
    run_primary = run_all or "primary" in groups

    sp_client_id = os.environ.get("DATABRICKS_CLIENT_ID", "")
    cat = CONFIG_CATALOG or "<CONFIG_CATALOG>"
    sch = CONFIG_SCHEMA or "<CONFIG_SCHEMA>"
    sp  = sp_client_id  or "<app-sp-uuid>"

    yield {"type": "meta", "data": {
        "sp_client_id": sp_client_id,
        "config_catalog": CONFIG_CATALOG,
        "config_schema": CONFIG_SCHEMA,
        "sql_warehouse_id": SQL_WAREHOUSE_ID,
    }}

    # ── Helpers ──────────────────────────────────────────────────────────────

    def _chk(id_, step_, label, status, message, fix_sql=None, fix_where=None,
             group_id="app", group_label="App Checks"):
        return {"type": "check", "data": {
            "id": id_, "step": step_, "label": label, "status": status,
            "message": message, "fix_sql": fix_sql, "fix_where": fix_where,
            "check_group_id": group_id, "check_group_label": group_label,
        }}

    def _try_perm(pid, perm_grp, resource, privilege, sql,
                  fix_sql=None, fix_where=None,
                  check_group_id="app", check_group_label="App Checks"):
        try:
            _query_sql(sql)
            return _perm_ok(pid, perm_grp, resource, privilege, check_group_id, check_group_label)
        except Exception as exc:  # noqa: BLE001
            return _perm_err(pid, perm_grp, resource, privilege, exc,
                             fix_sql=fix_sql, fix_where=fix_where,
                             check_group_id=check_group_id, check_group_label=check_group_label)

    def _is_permission_error(exc: Exception) -> bool:
        msg = str(exc).upper()
        return "INSUFFICIENT_PERMISSIONS" in msg or "PERMISSION_DENIED" in msg

    def _is_not_found_error(exc: Exception) -> bool:
        msg = str(exc).upper()
        return (
            "TABLE_OR_VIEW_NOT_FOUND" in msg
            or "SCHEMA_NOT_FOUND" in msg
            or "DOES NOT EXIST" in msg
        )

    # ── APP GROUP ────────────────────────────────────────────────────────────
    # Steps: 1=env vars, 2=warehouse, 3=config schema & tables
    # Permissions: SQL Warehouse, Config Tables

    if run_app:
        GID, GLABEL = "app", "App Checks"

        _fix_env = (
            f"# Add the following to app.yaml under env:, then redeploy.\n\n"
            f"env:\n"
            f"  - name: CONFIG_CATALOG\n"
            f"    value: your_catalog_name\n"
            f"  - name: CONFIG_SCHEMA\n"
            f"    value: your_schema_name\n"
            f"  - name: SQL_WAREHOUSE_ID\n"
            f"    value: your_warehouse_id"
        )

        _fix_tables = (
            f"-- Required: CREATE TABLE privilege on catalog `{cat}`\n"
            f"-- WARNING: CREATE OR REPLACE TABLE will drop and recreate the table.\n"
            f"-- If the tables already exist with data, use ALTER TABLE instead.\n\n"
            f"CREATE SCHEMA IF NOT EXISTS `{cat}`.`{sch}`;\n\n"
            f"CREATE OR REPLACE TABLE `{cat}`.`{sch}`.`govern_tag_dictionary` (\n"
            f"  tag_key        STRING  NOT NULL,\n"
            f"  allowed_values ARRAY<STRING>,\n"
            f"  free_text      BOOLEAN NOT NULL  DEFAULT false,\n"
            f"  sort_order     INT,\n"
            f"  created_at     TIMESTAMP         DEFAULT current_timestamp(),\n"
            f"  updated_at     TIMESTAMP         DEFAULT current_timestamp()\n"
            f") TBLPROPERTIES ('delta.feature.allowColumnDefaults' = 'supported');\n\n"
            f"CREATE OR REPLACE TABLE `{cat}`.`{sch}`.`govern_scope_config` (\n"
            f"  workspace_url  STRING  NOT NULL,\n"
            f"  catalog_name   STRING  NOT NULL,\n"
            f"  schema_name    STRING  NOT NULL,\n"
            f"  is_active      BOOLEAN NOT NULL  DEFAULT true,\n"
            f"  added_at       TIMESTAMP         DEFAULT current_timestamp()\n"
            f") TBLPROPERTIES ('delta.feature.allowColumnDefaults' = 'supported');\n\n"
            f"CREATE OR REPLACE TABLE `{cat}`.`{sch}`.`govern_health_check_results` (\n"
            f"  check_group_id    STRING    NOT NULL,\n"
            f"  check_group_label STRING    NOT NULL,\n"
            f"  workspace_url     STRING,\n"
            f"  check_id          STRING    NOT NULL,\n"
            f"  check_type        STRING    NOT NULL,\n"
            f"  step              INT,\n"
            f"  label             STRING,\n"
            f"  perm_group        STRING,\n"
            f"  resource          STRING,\n"
            f"  privilege         STRING,\n"
            f"  status            STRING    NOT NULL,\n"
            f"  message           STRING,\n"
            f"  fix_sql           STRING,\n"
            f"  fix_where         STRING,\n"
            f"  checked_at        TIMESTAMP NOT NULL,\n"
            f"  sp_client_id      STRING\n"
            f") TBLPROPERTIES ('delta.feature.allowColumnDefaults' = 'supported');"
        )

        _fix_grants = (
            f"-- Required: Metastore admin or catalog owner — App SP: {sp}\n\n"
            f"GRANT USE CATALOG ON CATALOG `{cat}` TO `{sp}`;\n"
            f"GRANT USE SCHEMA  ON SCHEMA  `{cat}`.`{sch}` TO `{sp}`;\n"
            f"GRANT SELECT, MODIFY ON TABLE `{cat}`.`{sch}`.`govern_tag_dictionary` TO `{sp}`;\n"
            f"GRANT SELECT, MODIFY ON TABLE `{cat}`.`{sch}`.`govern_scope_config`   TO `{sp}`;\n"
            f"GRANT SELECT, MODIFY ON TABLE `{cat}`.`{sch}`.`govern_health_check_results` TO `{sp}`;"
        )

        _wh_fix = (
            f"-- App SP does not have CAN_USE on this SQL warehouse.\n\n"
            f"-- Option 1: Databricks UI\n"
            f"-- SQL Warehouses → open warehouse {SQL_WAREHOUSE_ID or '<warehouse>'}"
            f" → Permissions → Add → '{sp}' → Can Use\n\n"
            f"-- Option 2: Databricks CLI\n"
            f"databricks warehouses set-permissions {SQL_WAREHOUSE_ID or '<warehouse_id>'} \\\n"
            f"  --json '{{\"access_control_list\": "
            f"[{{\"service_principal_name\": \"{sp}\", \"permission_level\": \"CAN_USE\"}}]}}'"
        )

        step = 0

        # Step 1: env vars
        step += 1
        env_ok = bool(CONFIG_CATALOG and CONFIG_SCHEMA and SQL_WAREHOUSE_ID)
        if env_ok:
            yield _chk("config_env", step, "App configuration", "ok",
                       "CONFIG_CATALOG, CONFIG_SCHEMA and SQL_WAREHOUSE_ID are set",
                       group_id=GID, group_label=GLABEL)
        else:
            missing = [v for v, val in [
                ("CONFIG_CATALOG", CONFIG_CATALOG),
                ("CONFIG_SCHEMA", CONFIG_SCHEMA),
                ("SQL_WAREHOUSE_ID", SQL_WAREHOUSE_ID),
            ] if not val]
            yield _chk("config_env", step, "App configuration", "error",
                       f"Missing in app.yaml: {', '.join(missing)}",
                       fix_sql=_fix_env, fix_where="app.yaml — add values and redeploy",
                       group_id=GID, group_label=GLABEL)

        # Step 2: SQL warehouse connectivity
        step += 1
        if SQL_WAREHOUSE_ID:
            try:
                _query_sql("SELECT 1 AS alive")
                yield _chk("warehouse_access", step, "SQL Warehouse accessible", "ok",
                           f"App SP can submit queries to warehouse {SQL_WAREHOUSE_ID}",
                           fix_sql=_wh_fix, fix_where="Databricks workspace admin (UI or CLI)",
                           group_id=GID, group_label=GLABEL)
            except Exception as exc:  # noqa: BLE001
                yield _chk("warehouse_access", step, "SQL Warehouse accessible", "error",
                           str(exc), fix_sql=_wh_fix,
                           fix_where="Databricks workspace admin (UI or CLI)",
                           group_id=GID, group_label=GLABEL)
        else:
            yield _chk("warehouse_access", step, "SQL Warehouse accessible", "error",
                       "Skipped — fix Step 1 first (SQL_WAREHOUSE_ID not set)",
                       group_id=GID, group_label=GLABEL)

        # Step 3: config schema & tables accessible
        step += 1
        if CONFIG_CATALOG and CONFIG_SCHEMA:
            try:
                _query_sql(f"SHOW TABLES IN `{CONFIG_CATALOG}`.`{CONFIG_SCHEMA}`")
                _query_sql(f"SELECT 1 FROM `{cat}`.`{sch}`.`govern_tag_dictionary` LIMIT 1")
                _query_sql(f"SELECT 1 FROM `{cat}`.`{sch}`.`govern_scope_config` LIMIT 1")
                _query_sql(f"SELECT 1 FROM `{cat}`.`{sch}`.`govern_health_check_results` LIMIT 1")
                yield _chk("config_access", step, f"Config schema & tables ({cat}.{sch})", "ok",
                           "App SP has USE SCHEMA and can read all 3 config tables",
                           fix_sql=_fix_grants, fix_where="Primary workspace SQL editor",
                           group_id=GID, group_label=GLABEL)
            except Exception as exc:  # noqa: BLE001
                if _is_not_found_error(exc):
                    fix_sql, fix_label = _fix_tables, "Primary workspace SQL editor"
                else:
                    fix_sql, fix_label = _fix_grants, "Primary workspace SQL editor"
                yield _chk("config_access", step, f"Config schema & tables ({cat}.{sch})", "error",
                           str(exc), fix_sql=fix_sql, fix_where=fix_label,
                           group_id=GID, group_label=GLABEL)
        else:
            yield _chk("config_access", step, "Config schema & tables", "error",
                       "Skipped — fix Step 1 first",
                       group_id=GID, group_label=GLABEL)

        # App permissions
        if SQL_WAREHOUSE_ID:
            yield {"type": "permission", "data": _try_perm(
                "wh_use", "SQL Warehouse", f"Warehouse `{SQL_WAREHOUSE_ID}`", "CAN_USE",
                "SELECT 1 AS alive", fix_sql=_wh_fix,
                fix_where="Databricks workspace admin (UI or CLI)",
                check_group_id=GID, check_group_label=GLABEL,
            )}

        if CONFIG_CATALOG and CONFIG_SCHEMA:
            pgrp = "Config Tables"
            for pid, resource, privilege, sql in [
                ("use_cat_cfg", f"`{cat}`", "USE CATALOG", f"SHOW SCHEMAS IN `{cat}`"),
                ("use_sch_cfg", f"`{cat}`.`{sch}`", "USE SCHEMA", f"SHOW TABLES IN `{cat}`.`{sch}`"),
                ("sel_tag_dict", f"`{cat}`.`{sch}`.`govern_tag_dictionary`", "SELECT",
                 f"SELECT 1 FROM `{cat}`.`{sch}`.`govern_tag_dictionary` LIMIT 1"),
                ("mod_tag_dict", f"`{cat}`.`{sch}`.`govern_tag_dictionary`", "MODIFY",
                 f"UPDATE `{cat}`.`{sch}`.`govern_tag_dictionary` SET updated_at = current_timestamp() WHERE 1=0"),
                ("sel_scope_cfg", f"`{cat}`.`{sch}`.`govern_scope_config`", "SELECT",
                 f"SELECT 1 FROM `{cat}`.`{sch}`.`govern_scope_config` LIMIT 1"),
                ("mod_scope_cfg", f"`{cat}`.`{sch}`.`govern_scope_config`", "MODIFY",
                 f"UPDATE `{cat}`.`{sch}`.`govern_scope_config` SET is_active = is_active WHERE 1=0"),
                ("sel_hc", f"`{cat}`.`{sch}`.`govern_health_check_results`", "SELECT",
                 f"SELECT 1 FROM `{cat}`.`{sch}`.`govern_health_check_results` LIMIT 1"),
                ("mod_hc", f"`{cat}`.`{sch}`.`govern_health_check_results`", "MODIFY",
                 f"UPDATE `{cat}`.`{sch}`.`govern_health_check_results` SET status = status WHERE 1=0"),
            ]:
                yield {"type": "permission", "data": _try_perm(
                    pid, pgrp, resource, privilege, sql,
                    check_group_id=GID, check_group_label=GLABEL,
                )}

    # ── PRIMARY WORKSPACE GROUP ───────────────────────────────────────────────
    # Steps: 1=USE CATALOG, 2=USE SCHEMA, 3=BROWSE, 4=APPLY TAG (per managed catalog)
    # Permissions: per managed catalog detail rows

    if run_primary:
        GID, GLABEL = "primary", "Primary Workspace"
        step = 0

        # ── Summary steps — one per privilege, across all managed catalogs ────
        try:
            from server.services.delta_config import get_scope_config
            from server.config import primary_host as _primary_host
            _ph = _primary_host()
            managed_cats = sorted({
                e["catalog_name"] for e in get_scope_config()
                if e.get("catalog_name") and (
                    e.get("workspace_url") in ("primary", "", None)
                    or (_ph and e.get("workspace_url", "").rstrip("/") == _ph.rstrip("/"))
                )
            })
            _uc_client = get_primary_client()

            cat_privs: dict[str, set] = {}
            for mc in managed_cats:
                try:
                    _raw = _uc_client.api_client.do(
                        "GET", f"/api/2.1/unity-catalog/effective-permissions/catalog/{mc}"
                    )
                    cat_privs[mc] = {
                        p.get("privilege", "").upper()
                        for pa in (_raw.get("privilege_assignments") or [])
                        for p in (pa.get("privileges") or [])
                        if p.get("privilege")
                    }
                except Exception:  # noqa: BLE001
                    cat_privs[mc] = set()

            if not managed_cats:
                step += 1
                yield _chk("perm_all", step, "Managed catalog permissions", "ok",
                           "No managed catalogs in scope yet — add catalogs via Settings first",
                           group_id=GID, group_label=GLABEL)
            else:
                # Step 1 — USE CATALOG
                step += 1
                missing_uc = [mc for mc in managed_cats if "USE_CATALOG" not in cat_privs[mc]]
                _sql_uc = (
                    f"-- Required: Metastore admin or catalog owner\n\n"
                    + "\n".join(f"GRANT USE CATALOG ON CATALOG `{mc}` TO `{sp}`;" for mc in managed_cats)
                )
                if not missing_uc:
                    yield _chk("perm_use_catalog", step, "USE CATALOG on managed catalogs", "ok",
                               f"App SP has USE CATALOG on all {len(managed_cats)} managed catalog(s)",
                               fix_sql=_sql_uc, fix_where="Primary workspace SQL editor",
                               group_id=GID, group_label=GLABEL)
                else:
                    yield _chk("perm_use_catalog", step, "USE CATALOG on managed catalogs", "warning",
                               f"USE CATALOG not granted for: {', '.join(missing_uc)}",
                               fix_sql=(
                                   f"-- Required: Metastore admin or catalog owner\n\n"
                                   + "\n".join(f"GRANT USE CATALOG ON CATALOG `{mc}` TO `{sp}`;" for mc in missing_uc)
                               ),
                               fix_where="Primary workspace SQL editor",
                               group_id=GID, group_label=GLABEL)

                # Step 2 — USE SCHEMA
                step += 1
                missing_us = [mc for mc in managed_cats if "USE_SCHEMA" not in cat_privs[mc]]
                _sql_us = (
                    f"-- Grant at catalog level — cascades to all current and future schemas\n"
                    f"-- Required: Metastore admin or catalog owner\n\n"
                    + "\n".join(f"GRANT USE SCHEMA ON CATALOG `{mc}` TO `{sp}`;" for mc in managed_cats)
                )
                if not missing_us:
                    yield _chk("perm_use_schema", step, "USE SCHEMA on managed catalogs", "ok",
                               f"App SP has USE SCHEMA on all {len(managed_cats)} managed catalog(s)",
                               fix_sql=_sql_us, fix_where="Primary workspace SQL editor",
                               group_id=GID, group_label=GLABEL)
                else:
                    yield _chk("perm_use_schema", step, "USE SCHEMA on managed catalogs", "warning",
                               f"USE SCHEMA not granted for: {', '.join(missing_us)}",
                               fix_sql=(
                                   f"-- Grant at catalog level — cascades to all current and future schemas\n"
                                   f"-- Required: Metastore admin or catalog owner\n\n"
                                   + "\n".join(f"GRANT USE SCHEMA ON CATALOG `{mc}` TO `{sp}`;" for mc in missing_us)
                               ),
                               fix_where="Primary workspace SQL editor",
                               group_id=GID, group_label=GLABEL)

                # Step 3 — BROWSE (SELECT also accepted as superset)
                step += 1
                missing_br = [mc for mc in managed_cats
                              if "BROWSE" not in cat_privs[mc] and "SELECT" not in cat_privs[mc]]
                _sql_br = (
                    f"-- Enables schema and table listing without granting access to table data\n"
                    f"-- Required: Metastore admin or catalog owner\n\n"
                    + "\n".join(f"GRANT BROWSE ON CATALOG `{mc}` TO `{sp}`;" for mc in managed_cats)
                )
                if not missing_br:
                    yield _chk("perm_browse", step, "BROWSE on managed catalogs", "ok",
                               f"App SP has BROWSE on all {len(managed_cats)} managed catalog(s)",
                               fix_sql=_sql_br, fix_where="Primary workspace SQL editor",
                               group_id=GID, group_label=GLABEL)
                else:
                    yield _chk("perm_browse", step, "BROWSE on managed catalogs", "warning",
                               f"BROWSE not granted for: {', '.join(missing_br)} — tables will not load in Tag Management",
                               fix_sql=(
                                   f"-- Enables schema and table listing without granting access to table data\n"
                                   f"-- Required: Metastore admin or catalog owner\n\n"
                                   + "\n".join(f"GRANT BROWSE ON CATALOG `{mc}` TO `{sp}`;" for mc in missing_br)
                               ),
                               fix_where="Primary workspace SQL editor",
                               group_id=GID, group_label=GLABEL)

                # Step 4 — APPLY TAG
                step += 1
                missing_at = [mc for mc in managed_cats if "APPLY_TAG" not in cat_privs[mc]]
                _sql_at = (
                    f"-- Enables ALTER TABLE SET/UNSET TAGS on all tables in the catalog\n"
                    f"-- Required: Metastore admin or catalog owner\n\n"
                    + "\n".join(f"GRANT APPLY TAG ON CATALOG `{mc}` TO `{sp}`;" for mc in managed_cats)
                )
                if not missing_at:
                    yield _chk("perm_apply_tag", step, "APPLY TAG on managed catalogs", "ok",
                               f"App SP has APPLY TAG on all {len(managed_cats)} managed catalog(s)",
                               fix_sql=_sql_at, fix_where="Primary workspace SQL editor",
                               group_id=GID, group_label=GLABEL)
                else:
                    yield _chk("perm_apply_tag", step, "APPLY TAG on managed catalogs", "warning",
                               f"APPLY TAG not granted for: {', '.join(missing_at)}",
                               fix_sql=(
                                   f"-- Enables ALTER TABLE SET/UNSET TAGS on all tables in the catalog\n"
                                   f"-- Required: Metastore admin or catalog owner\n\n"
                                   + "\n".join(f"GRANT APPLY TAG ON CATALOG `{mc}` TO `{sp}`;" for mc in missing_at)
                               ),
                               fix_where="Primary workspace SQL editor",
                               group_id=GID, group_label=GLABEL)

        except Exception as exc:  # noqa: BLE001
            for sid, label in [
                ("perm_use_catalog", "USE CATALOG"),
                ("perm_use_schema",  "USE SCHEMA"),
                ("perm_browse",      "BROWSE"),
                ("perm_apply_tag",   "APPLY TAG"),
            ]:
                step += 1
                yield _chk(sid, step, f"{label} on managed catalogs", "warning",
                           f"Could not check permissions: {exc}",
                           group_id=GID, group_label=GLABEL)

        # ── Permission rows — per managed catalog detail ───────────────────────
        try:
            from server.services.delta_config import get_scope_config
            from server.config import primary_host as _primary_host2
            _ph2 = _primary_host2()
            managed_cats2 = sorted({
                e["catalog_name"] for e in get_scope_config()
                if e.get("catalog_name") and (
                    e.get("workspace_url") in ("primary", "", None)
                    or (_ph2 and e.get("workspace_url", "").rstrip("/") == _ph2.rstrip("/"))
                )
            })
            _uc_client2 = get_primary_client()
            for mc in managed_cats2:
                pgrp = f"Managed Catalog: {mc}"

                yield {"type": "permission", "data": _try_perm(
                    f"use_cat_{mc}", pgrp, f"`{mc}`", "USE CATALOG",
                    f"SHOW SCHEMAS IN `{mc}`",
                    check_group_id=GID, check_group_label=GLABEL,
                )}

                _fix_use_schema = (
                    f"-- Required: Metastore admin or catalog owner\n\n"
                    f"GRANT USE SCHEMA ON CATALOG `{mc}` TO `{sp}`;"
                )
                _fix_browse = (
                    f"-- Required: Metastore admin or catalog owner\n\n"
                    f"GRANT BROWSE ON CATALOG `{mc}` TO `{sp}`;"
                )
                _fix_at = (
                    f"-- Required: Metastore admin or catalog owner\n\n"
                    f"GRANT APPLY TAG ON CATALOG `{mc}` TO `{sp}`;"
                )
                try:
                    _raw2 = _uc_client2.api_client.do(
                        "GET", f"/api/2.1/unity-catalog/effective-permissions/catalog/{mc}"
                    )
                    _all_privs: set[str] = {
                        p.get("privilege", "").upper()
                        for pa2 in (_raw2.get("privilege_assignments") or [])
                        for p in (pa2.get("privileges") or [])
                        if p.get("privilege")
                    }

                    has_us = "USE_SCHEMA" in _all_privs
                    if has_us:
                        yield {"type": "permission", "data":
                               _perm_ok(f"use_sch_{mc}", pgrp, f"`{mc}` (all schemas)",
                                        "USE SCHEMA ON CATALOG", GID, GLABEL,
                                        fix_sql=_fix_use_schema,
                                        fix_where="Primary workspace SQL editor")}
                    else:
                        yield {"type": "permission", "data":
                               _perm_warn(f"use_sch_{mc}", pgrp, f"`{mc}` (all schemas)",
                                          "USE SCHEMA ON CATALOG",
                                          "Not granted at catalog level — SP may not see all schemas.",
                                          fix_sql=_fix_use_schema,
                                          fix_where="Primary workspace SQL editor",
                                          check_group_id=GID, check_group_label=GLABEL)}

                    has_br = "BROWSE" in _all_privs or "SELECT" in _all_privs
                    if has_br:
                        yield {"type": "permission", "data":
                               _perm_ok(f"browse_{mc}", pgrp, f"`{mc}` (all tables)",
                                        "BROWSE ON CATALOG", GID, GLABEL,
                                        fix_sql=_fix_browse,
                                        fix_where="Primary workspace SQL editor")}
                    else:
                        yield {"type": "permission", "data":
                               _perm_warn(f"browse_{mc}", pgrp, f"`{mc}` (all tables)",
                                          "BROWSE ON CATALOG",
                                          "BROWSE not granted — information_schema.tables returns empty; tables will not load in Tag Management.",
                                          fix_sql=_fix_browse,
                                          fix_where="Primary workspace SQL editor",
                                          check_group_id=GID, check_group_label=GLABEL)}

                    has_at = "APPLY_TAG" in _all_privs
                    if has_at:
                        yield {"type": "permission", "data":
                               _perm_ok(f"apply_tag_{mc}", pgrp, f"`{mc}`",
                                        "APPLY TAG ON CATALOG", GID, GLABEL,
                                        fix_sql=_fix_at,
                                        fix_where="Primary workspace SQL editor")}
                    else:
                        yield {"type": "permission", "data":
                               _perm_warn(f"apply_tag_{mc}", pgrp, f"`{mc}`",
                                          "APPLY TAG ON CATALOG",
                                          "APPLY TAG not found in effective privileges.",
                                          fix_sql=_fix_at,
                                          fix_where="Primary workspace SQL editor",
                                          check_group_id=GID, check_group_label=GLABEL)}
                except Exception as exc:  # noqa: BLE001
                    yield {"type": "permission", "data":
                           _perm_err(f"use_sch_{mc}", pgrp, f"`{mc}` (all schemas)",
                                     "USE SCHEMA ON CATALOG", exc,
                                     fix_sql=_fix_use_schema,
                                     fix_where="Primary workspace SQL editor",
                                     check_group_id=GID, check_group_label=GLABEL)}
                    yield {"type": "permission", "data":
                           _perm_err(f"browse_{mc}", pgrp, f"`{mc}` (all tables)",
                                     "BROWSE ON CATALOG", exc,
                                     fix_sql=_fix_browse,
                                     fix_where="Primary workspace SQL editor",
                                     check_group_id=GID, check_group_label=GLABEL)}
                    yield {"type": "permission", "data":
                           _perm_err(f"apply_tag_{mc}", pgrp, f"`{mc}`",
                                     "APPLY TAG ON CATALOG", exc,
                                     fix_sql=_fix_at,
                                     fix_where="Primary workspace SQL editor",
                                     check_group_id=GID, check_group_label=GLABEL)}
        except Exception:  # noqa: BLE001
            pass

    # ── SECONDARY WORKSPACE GROUPS ────────────────────────────────────────────
    # One group per secondary workspace: secondary_1, secondary_2, ...
    # Step 1: token connectivity

    for ws in _parse_secondary_workspaces_from_env():
        idx = ws.get("index", 1)
        GID = f"secondary_{idx}"
        GLABEL = ws.get("display_name") or f"Secondary {idx}"
        if not (run_all or GID in groups):
            continue

        sec_sp = ws.get("client_id") or "<secondary-sp-client-id>"
        _fix_secondary = (
            f"-- Run in: {GLABEL} SQL editor (NOT the primary workspace)\n"
            f"-- Required: Metastore admin or catalog owner in {GLABEL}\n"
            f"-- Secondary SP: {sec_sp}\n\n"
            f"-- Repeat for every catalog to tag in this workspace:\n"
            f"-- GRANT USE CATALOG ON CATALOG `<your_catalog>` TO `{sec_sp}`;\n"
            f"-- GRANT USE SCHEMA  ON CATALOG `<your_catalog>` TO `{sec_sp}`;\n"
            f"-- GRANT APPLY TAG   ON CATALOG `<your_catalog>` TO `{sec_sp}`;"
        )
        try:
            _build_secondary_client(ws["workspace_url"], ws["client_id"], ws["client_secret"])
            yield _chk(f"secondary_{ws['workspace_url']}", 1,
                       f"Workspace connectivity — {GLABEL}", "ok",
                       "Token exchange successful — SP connected",
                       group_id=GID, group_label=GLABEL)
        except Exception as exc:  # noqa: BLE001
            yield _chk(f"secondary_{ws['workspace_url']}", 1,
                       f"Workspace connectivity — {GLABEL}", "error",
                       str(exc), fix_sql=_fix_secondary,
                       fix_where=f"{GLABEL} SQL editor",
                       group_id=GID, group_label=GLABEL)

    yield {"type": "done"}


@router.get("/setup-status")
def get_setup_status():
    """Run ordered setup checks; return collected JSON."""
    checks, permissions, meta = [], [], {}
    for event in _generate_setup_events():
        if event["type"] == "meta":
            meta = event["data"]
        elif event["type"] == "check":
            checks.append(event["data"])
        elif event["type"] == "permission":
            permissions.append(event["data"])
    return {**meta, "checks": checks, "permissions": permissions}


@router.get("/setup-status/stream")
def stream_setup_status(groups: str = ""):
    """Stream setup events as SSE. groups: comma-separated group IDs to run (default: all)."""
    import json
    import os
    from fastapi.responses import StreamingResponse

    requested: set | None = (
        {g.strip() for g in groups.split(",") if g.strip()} if groups else None
    )
    sp_client_id = os.environ.get("DATABRICKS_CLIENT_ID", "")

    def _sse():
        accumulated: list[dict] = []
        for event in _generate_setup_events(groups=requested):
            yield f"data: {json.dumps(event)}\n\n"
            if event["type"] in ("check", "permission"):
                row = dict(event["data"])
                # event data uses "id"; table column is "check_id"
                row["check_id"] = row.get("id") or row.get("check_id", "")
                # event type ("check"/"permission") maps directly to check_type column
                row["check_type"] = event["type"]
                accumulated.append(row)
        # Persist to Delta after stream completes (non-fatal if table missing)
        try:
            from server.services.delta_config import save_health_check_results
            save_health_check_results(accumulated, sp_client_id)
        except Exception:  # noqa: BLE001
            pass

    return StreamingResponse(
        _sse(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/permissions-tree")
def get_permissions_tree():
    """Return effective permissions for the app SP as a tree: warehouse → catalog → schema → table."""
    import os
    from server.config import CONFIG_CATALOG, CONFIG_SCHEMA, SQL_WAREHOUSE_ID, get_primary_client
    from server.config import primary_host
    from server.services.delta_config import get_scope_config

    sp = os.environ.get("DATABRICKS_CLIENT_ID", "")
    try:
        client = get_primary_client()
    except Exception:
        return {"warehouse": None, "catalogs": []}

    def _eff_privs(securable: str, full_name: str) -> list[str]:
        try:
            raw = client.api_client.do(
                "GET", f"/api/2.1/unity-catalog/effective-permissions/{securable}/{full_name}"
            )
            out: set[str] = set()
            for pa in (raw.get("privilege_assignments") or []):
                if not sp or pa.get("principal") == sp:
                    for p in (pa.get("privileges") or []):
                        priv = p.get("privilege", "")
                        if priv:
                            out.add(priv)
            if not out:
                for pa in (raw.get("privilege_assignments") or []):
                    for p in (pa.get("privileges") or []):
                        priv = p.get("privilege", "")
                        if priv:
                            out.add(priv)
            return sorted(out)
        except Exception:
            return []

    # Warehouse
    warehouse = None
    if SQL_WAREHOUSE_ID:
        accessible = False
        try:
            from server.services.unity_catalog import _query_sql
            _query_sql("SELECT 1")
            accessible = True
        except Exception:
            pass
        warehouse = {"id": SQL_WAREHOUSE_ID, "accessible": accessible,
                     "privileges": ["CAN_USE"] if accessible else []}

    # Managed catalogs
    ph = primary_host()
    try:
        scope = get_scope_config()
    except Exception:
        scope = []
    managed_cats = sorted({
        e["catalog_name"] for e in scope
        if e.get("catalog_name") and (
            e.get("workspace_url") in ("primary", "", None)
            or (ph and e.get("workspace_url", "").rstrip("/") == ph.rstrip("/"))
        )
    })

    all_cat_names = sorted(set(managed_cats) | ({CONFIG_CATALOG} if CONFIG_CATALOG else set()))

    catalogs = []
    for cat_name in all_cat_names:
        roles: list[str] = []
        if cat_name in managed_cats:
            roles.append("managed")
        if cat_name == CONFIG_CATALOG:
            roles.append("config")

        cat_privs = _eff_privs("catalog", cat_name)

        schemas: list[dict] = []
        if cat_name == CONFIG_CATALOG and CONFIG_SCHEMA:
            tables: list[dict] = []
            for tbl in ["govern_tag_dictionary", "govern_scope_config", "govern_health_check_results"]:
                tbl_privs = _eff_privs("table", f"{cat_name}.{CONFIG_SCHEMA}.{tbl}")
                tables.append({"name": tbl, "privileges": tbl_privs})
            schemas.append({
                "name": CONFIG_SCHEMA,
                "role": "config",
                "privileges": _eff_privs("schema", f"{cat_name}.{CONFIG_SCHEMA}"),
                "tables": tables,
            })

        catalogs.append({
            "name": cat_name,
            "roles": roles,
            "privileges": cat_privs,
            "schemas": schemas,
        })

    return {"warehouse": warehouse, "catalogs": catalogs}


@router.get("/setup-status/cached")
def get_cached_setup_status():
    """Return last stored health check results from Delta table. Returns [] if none yet."""
    try:
        from server.services.delta_config import get_cached_health_checks
        return get_cached_health_checks()
    except Exception:  # noqa: BLE001
        return []


# --------------------------------------------------------------------------- #
# Secondary workspaces
# --------------------------------------------------------------------------- #
@router.get("/workspaces")
def get_workspaces():
    """All workspaces — primary first, then SEC_N_* secondaries."""
    try:
        from server.config import get_all_workspace_infos
        return get_all_workspace_infos()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=str(exc))
