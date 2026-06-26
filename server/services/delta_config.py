"""Config table operations against the Primary Region workspace.

Reads and writes the config tables (``tag_dictionary``, ``scope_config``)
via the SQL warehouse using the app service principal.
"""

from __future__ import annotations

import json
import time
from typing import Any

from server.config import (
    CONFIG_CATALOG,
    CONFIG_SCHEMA,
    SQL_WAREHOUSE_ID,
    get_primary_client,
)

TAG_DICT_TABLE = f"{CONFIG_CATALOG}.{CONFIG_SCHEMA}.govern_tag_dictionary"
SCOPE_TABLE = f"{CONFIG_CATALOG}.{CONFIG_SCHEMA}.govern_scope_config"
HEALTH_CHECK_TABLE = f"{CONFIG_CATALOG}.{CONFIG_SCHEMA}.govern_health_check_results"


def _execute(statement: str) -> dict:
    """Run a SQL statement on the Primary Region warehouse, returning parsed rows."""
    client = get_primary_client()
    resp = client.statement_execution.execute_statement(
        warehouse_id=SQL_WAREHOUSE_ID,
        statement=statement,
        wait_timeout="50s",
    )
    statement_id = resp.statement_id
    state = resp.status.state.value if resp.status and resp.status.state else None

    deadline = time.time() + 240  # allow up to ~5 min total for cold warehouse start
    while state in (None, "PENDING", "RUNNING") and time.time() < deadline:
        time.sleep(2)
        resp = client.statement_execution.get_statement(statement_id)
        state = resp.status.state.value if resp.status and resp.status.state else None

    if state != "SUCCEEDED":
        err = ""
        if resp.status and resp.status.error:
            err = resp.status.error.message or ""
        raise RuntimeError(f"Config statement failed ({state}): {err}")

    return _rows_from_result(resp)


def _rows_from_result(resp: Any) -> dict:
    cols: list[str] = []
    if resp.manifest and resp.manifest.schema and resp.manifest.schema.columns:
        cols = [c.name for c in resp.manifest.schema.columns]

    data_rows: list[dict] = []
    if resp.result and resp.result.data_array:
        for raw in resp.result.data_array:
            data_rows.append({cols[i]: raw[i] for i in range(len(cols))})
    return {"columns": cols, "rows": data_rows}


def _sql_str(value: str) -> str:
    escaped = (value or "").replace("'", "''")
    return f"'{escaped}'"


# --------------------------------------------------------------------------- #
# Tag dictionary
# --------------------------------------------------------------------------- #
def get_tag_dictionary() -> list[dict]:
    result = _execute(
        f"SELECT tag_key, allowed_values, free_text, sort_order FROM {TAG_DICT_TABLE} "
        f"ORDER BY sort_order ASC NULLS LAST, tag_key",
    )
    out: list[dict] = []
    for row in result["rows"]:
        allowed = row.get("allowed_values")
        if isinstance(allowed, str):
            try:
                allowed = json.loads(allowed)
            except (ValueError, TypeError):
                allowed = None
        free_text = row.get("free_text")
        if isinstance(free_text, str):
            free_text = free_text.lower() == "true"
        sort_order = row.get("sort_order")
        if sort_order is not None:
            try:
                sort_order = int(sort_order)
            except (ValueError, TypeError):
                sort_order = None
        out.append({
            "tag_key": row.get("tag_key"),
            "allowed_values": allowed,
            "free_text": bool(free_text),
            "sort_order": sort_order,
        })
    return out


def upsert_tag_key(tag_key: str, allowed_values: list[str] | None,
                   free_text: bool) -> dict:
    if allowed_values:
        elems = ", ".join(_sql_str(v) for v in allowed_values)
        allowed_expr = f"array({elems})"
    else:
        allowed_expr = "CAST(NULL AS ARRAY<STRING>)"
    free_expr = "true" if free_text else "false"

    statement = f"""
MERGE INTO {TAG_DICT_TABLE} AS t
USING (SELECT {_sql_str(tag_key)} AS tag_key) AS s
ON t.tag_key = s.tag_key
WHEN MATCHED THEN UPDATE SET
  t.allowed_values = {allowed_expr},
  t.free_text = {free_expr},
  t.updated_at = current_timestamp()
WHEN NOT MATCHED THEN INSERT
  (tag_key, allowed_values, free_text, created_at, updated_at)
  VALUES ({_sql_str(tag_key)}, {allowed_expr}, {free_expr}, current_timestamp(), current_timestamp())
""".strip()
    _execute(statement)
    return {"tag_key": tag_key}


def delete_tag_key(tag_key: str) -> dict:
    _execute(f"DELETE FROM {TAG_DICT_TABLE} WHERE tag_key = {_sql_str(tag_key)}")
    return {"deleted": tag_key}


def set_tag_order(ordered_keys: list[str]) -> None:
    """Persist display order by setting sort_order = index for every key in the list."""
    if not ordered_keys:
        return
    cases = " ".join(
        f"WHEN tag_key = {_sql_str(k)} THEN {i}"
        for i, k in enumerate(ordered_keys)
    )
    in_list = ", ".join(_sql_str(k) for k in ordered_keys)
    _execute(
        f"UPDATE {TAG_DICT_TABLE} "
        f"SET sort_order = CASE {cases} ELSE sort_order END, "
        f"    updated_at = current_timestamp() "
        f"WHERE tag_key IN ({in_list})",
    )


def _resolve_workspace_url(workspace_url: str) -> str:
    """Replace the 'primary' sentinel with the actual DATABRICKS_HOST URL."""
    from server.config import primary_host
    if not workspace_url or workspace_url == "primary":
        return primary_host() or "primary"
    return workspace_url.rstrip("/")


# --------------------------------------------------------------------------- #
# Scope config
# --------------------------------------------------------------------------- #
def get_scope_config(active_only: bool = False) -> list[dict]:
    where = "WHERE is_active = true" if active_only else ""
    result = _execute(
        f"SELECT workspace_url, catalog_name, schema_name, is_active FROM {SCOPE_TABLE} "
        f"{where} ORDER BY workspace_url, catalog_name, schema_name",
    )
    out: list[dict] = []
    for row in result["rows"]:
        is_active = row.get("is_active")
        if isinstance(is_active, str):
            is_active = is_active.lower() == "true"
        out.append({
            "workspace_url": _resolve_workspace_url(row.get("workspace_url", "")),
            "catalog_name": row.get("catalog_name"),
            "schema_name": row.get("schema_name"),
            "is_active": bool(is_active),
        })
    return out


def upsert_scope(workspace_url: str, catalog: str, schema: str,
                 is_active: bool) -> dict:
    workspace_url = _resolve_workspace_url(workspace_url)
    active_expr = "true" if is_active else "false"
    statement = f"""
MERGE INTO {SCOPE_TABLE} AS t
USING (
  SELECT {_sql_str(workspace_url)} AS workspace_url,
         {_sql_str(catalog)} AS catalog_name,
         {_sql_str(schema)} AS schema_name
) AS s
ON t.workspace_url = s.workspace_url
   AND t.catalog_name = s.catalog_name
   AND t.schema_name = s.schema_name
WHEN MATCHED THEN UPDATE SET t.is_active = {active_expr}
WHEN NOT MATCHED THEN INSERT
  (workspace_url, catalog_name, schema_name, is_active, added_at)
  VALUES ({_sql_str(workspace_url)}, {_sql_str(catalog)}, {_sql_str(schema)}, {active_expr}, current_timestamp())
""".strip()
    _execute(statement)
    return {"workspace_url": workspace_url, "catalog_name": catalog,
            "schema_name": schema, "is_active": is_active}


def delete_scope(workspace_url: str, catalog: str, schema: str) -> dict:
    workspace_url = _resolve_workspace_url(workspace_url)
    _execute(
        f"DELETE FROM {SCOPE_TABLE} "
        f"WHERE workspace_url = {_sql_str(workspace_url)} "
        f"AND catalog_name = {_sql_str(catalog)} "
        f"AND schema_name = {_sql_str(schema)}",
    )
    return {"deleted": f"{workspace_url}:{catalog}.{schema}"}


# --------------------------------------------------------------------------- #
# Region config (secondary metastore regions)
# --------------------------------------------------------------------------- #

REGION_TABLE = f"{CONFIG_CATALOG}.{CONFIG_SCHEMA}.govern_region_config"
MAX_REGION_SLOTS = 5


def _ensure_region_table() -> None:
    _execute(f"""
CREATE TABLE IF NOT EXISTS {REGION_TABLE} (
  slot             INT       NOT NULL,
  workspace_url    STRING    NOT NULL,
  display_name     STRING    NOT NULL,
  sp_client_id     STRING    NOT NULL,
  sql_warehouse_id STRING    NOT NULL,
  is_active        BOOLEAN   NOT NULL DEFAULT true,
  added_at         TIMESTAMP DEFAULT current_timestamp()
)
TBLPROPERTIES ('delta.feature.allowColumnDefaults' = 'supported')
""".strip())


def get_regions() -> list[dict]:
    """Return all active region rows. Raises on error so callers can surface it."""
    result = _execute(
        f"SELECT slot, workspace_url, display_name, sp_client_id, sql_warehouse_id, "
        f"is_active, added_at FROM {REGION_TABLE} "
        f"WHERE is_active = true ORDER BY slot"
    )
    return result["rows"]


def upsert_region(slot: int, workspace_url: str, display_name: str,
                  sp_client_id: str, sql_warehouse_id: str,
                  is_active: bool = True) -> None:
    active_expr = "true" if is_active else "false"
    _execute(f"""
MERGE INTO {REGION_TABLE} AS t
USING (SELECT {slot} AS slot) AS s
ON t.slot = s.slot
WHEN MATCHED THEN UPDATE SET
  t.workspace_url    = {_sql_str(workspace_url)},
  t.display_name     = {_sql_str(display_name)},
  t.sp_client_id     = {_sql_str(sp_client_id)},
  t.sql_warehouse_id = {_sql_str(sql_warehouse_id)},
  t.is_active        = {active_expr}
WHEN NOT MATCHED THEN INSERT
  (slot, workspace_url, display_name, sp_client_id, sql_warehouse_id, is_active, added_at)
  VALUES ({slot}, {_sql_str(workspace_url)}, {_sql_str(display_name)},
          {_sql_str(sp_client_id)}, {_sql_str(sql_warehouse_id)}, {active_expr}, current_timestamp())
""".strip())


def delete_region(slot: int) -> None:
    """Soft-delete a region by setting is_active = false."""
    try:
        _execute(f"UPDATE {REGION_TABLE} SET is_active = false WHERE slot = {slot}")
    except Exception:
        pass


def next_free_slot(max_slots: int = MAX_REGION_SLOTS) -> int | None:
    """Return the lowest slot number 1..max_slots not currently active."""
    try:
        result = _execute(
            f"SELECT slot FROM {REGION_TABLE} WHERE is_active = true ORDER BY slot"
        )
        used = {int(r["slot"]) for r in result["rows"]}
    except Exception:
        used = set()
    for n in range(1, max_slots + 1):
        if n not in used:
            return n
    return None


# --------------------------------------------------------------------------- #
# Health check results
# --------------------------------------------------------------------------- #
def get_cached_health_checks() -> list[dict]:
    """Read cached health check results from Delta table. Returns [] if table missing."""
    try:
        result = _execute(
            f"SELECT * FROM {HEALTH_CHECK_TABLE} "
            f"ORDER BY check_group_id, step ASC NULLS LAST, check_id"
        )
        rows = result["rows"]
        # Coerce step to int where present
        for r in rows:
            s = r.get("step")
            if s is not None:
                try:
                    r["step"] = int(s)
                except (ValueError, TypeError):
                    r["step"] = None
        return rows
    except Exception:
        return []


def save_health_check_results(rows: list[dict], sp_client_id: str = "") -> None:
    """Replace cached results for every check_group_id present in rows."""
    if not rows:
        return

    def _sv(v) -> str:
        if v is None:
            return "NULL"
        if isinstance(v, int):
            return str(v)
        return _sql_str(str(v))

    by_group: dict[str, list[dict]] = {}
    for row in rows:
        g = row.get("check_group_id", "app")
        by_group.setdefault(g, []).append(row)

    for group_id, group_rows in by_group.items():
        _execute(
            f"DELETE FROM {HEALTH_CHECK_TABLE} WHERE check_group_id = {_sql_str(group_id)}"
        )
        if not group_rows:
            continue

        cols = [
            "check_group_id", "check_group_label", "workspace_url", "check_id",
            "check_type", "step", "label", "perm_group", "resource", "privilege",
            "status", "message", "fix_sql", "fix_where", "checked_at", "sp_client_id",
        ]
        cols_str = ", ".join(f"`{c}`" for c in cols)
        value_rows = []
        for r in group_rows:
            vals = [
                _sv(r.get("check_group_id")),
                _sv(r.get("check_group_label")),
                _sv(r.get("workspace_url")),
                _sv(r.get("check_id")),
                _sv(r.get("check_type", "check")),
                _sv(r.get("step")),
                _sv(r.get("label")),
                _sv(r.get("perm_group") or r.get("group")),
                _sv(r.get("resource")),
                _sv(r.get("privilege")),
                _sv(r.get("status", "ok")),
                _sv(r.get("message")),
                _sv(r.get("fix_sql")),
                _sv(r.get("fix_where")),
                "current_timestamp()",
                _sv(sp_client_id or r.get("sp_client_id")),
            ]
            value_rows.append(f"({', '.join(vals)})")
        _execute(
            f"INSERT INTO {HEALTH_CHECK_TABLE} ({cols_str}) VALUES "
            + ",\n".join(value_rows)
        )
