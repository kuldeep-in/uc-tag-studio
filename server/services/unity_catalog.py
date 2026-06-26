"""Unity Catalog metadata operations against secondary (and primary) workspaces.

All calls are metadata-only. No table data is read.
All operations run under service principal credentials — the app SP for the
primary workspace and dedicated SP credentials for secondary workspaces.
"""

from __future__ import annotations

import os
import time
from typing import Any

from server.config import get_primary_client, get_secondary_client, get_secondary_warehouse_id


def _is_primary(workspace_url: str) -> bool:
    from server.config import primary_host
    if not workspace_url or workspace_url == "primary":
        return True
    ph = primary_host()
    return bool(ph and workspace_url.rstrip("/") == ph.rstrip("/"))


def _get_client(workspace_url: str = "primary"):
    if _is_primary(workspace_url):
        return get_primary_client()
    return get_secondary_client(workspace_url)


def _do(
    method: str,
    path: str,
    *,
    workspace_url: str = "primary",
    query: dict | None = None,
    body: dict | None = None,
) -> dict:
    client = _get_client(workspace_url)
    result = client.api_client.do(method, path, query=query, body=body)
    return result if isinstance(result, dict) else {}


# --------------------------------------------------------------------------- #
# Reads
# --------------------------------------------------------------------------- #
def list_catalogs(workspace_url: str = "primary") -> list[dict]:
    """List catalogs via SHOW CATALOGS SQL."""
    if _is_primary(workspace_url):
        rows = _query_sql("SHOW CATALOGS", workspace_url=workspace_url)
        out: list[dict] = []
        for row in rows:
            name = row.get("catalog") or row.get("name") or ""
            if name:
                out.append({"name": name, "catalog_name": name})
        return out

    out = []
    page_token: str | None = None
    while True:
        query: dict[str, Any] = {"max_results": 200}
        if page_token:
            query["page_token"] = page_token
        resp = _do("GET", "/api/2.1/unity-catalog/catalogs",
                   workspace_url=workspace_url, query=query)
        out.extend(resp.get("catalogs", []) or [])
        page_token = resp.get("next_page_token")
        if not page_token:
            break
    return out


def list_schemas(catalog: str, workspace_url: str = "primary") -> list[dict]:
    """List schemas via information_schema.schemata SQL, with UC REST API fallback."""
    try:
        rows = _query_sql(
            f"SELECT schema_name FROM {catalog}.information_schema.schemata "
            f"ORDER BY schema_name",
            workspace_url=workspace_url,
        )
        return [{"name": r["schema_name"], "catalog_name": catalog}
                for r in rows if r.get("schema_name")]
    except Exception:
        pass

    out: list[dict] = []
    page_token: str | None = None
    while True:
        query: dict[str, Any] = {"catalog_name": catalog, "max_results": 200}
        if page_token:
            query["page_token"] = page_token
        resp = _do("GET", "/api/2.1/unity-catalog/schemas",
                   workspace_url=workspace_url, query=query)
        out.extend(resp.get("schemas", []) or [])
        page_token = resp.get("next_page_token")
        if not page_token:
            break
    return out


def list_tables(
    catalog: str,
    schema: str,
    workspace_url: str = "primary",
    tag_keys: list[str] | None = None,
) -> list[dict]:
    """List tables using information_schema, with UC REST API fallback."""
    safe_schema = schema.replace("'", "''")
    out: list[dict] = []

    try:
        table_rows = _query_sql(
            f"SELECT table_name, table_type "
            f"FROM {catalog}.information_schema.tables "
            f"WHERE table_schema = '{safe_schema}' "
            f"AND table_type NOT IN ('SYSTEM_DEFINED', 'TEMPORARY') "
            f"AND LEFT(table_name, 2) != '__' "
            f"ORDER BY table_name",
            workspace_url=workspace_url,
        )
        for row in table_rows:
            name = row.get("table_name") or ""
            out.append({
                "full_name": f"{catalog}.{schema}.{name}",
                "name": name,
                "catalog_name": catalog,
                "schema_name": schema,
                "table_type": row.get("table_type"),
                "tags": {},
            })
    except Exception:
        page_token: str | None = None
        while True:
            query: dict[str, Any] = {
                "catalog_name": catalog,
                "schema_name": schema,
                "max_results": 200,
                "include_browse": True,
            }
            if page_token:
                query["page_token"] = page_token
            resp = _do("GET", "/api/2.1/unity-catalog/tables",
                       workspace_url=workspace_url, query=query)
            out.extend(resp.get("tables", []) or [])
            page_token = resp.get("next_page_token")
            if not page_token:
                break

    tag_filter = ""
    if tag_keys:
        escaped = ", ".join(f"'{k.replace(chr(39), chr(39) * 2)}'" for k in tag_keys)
        tag_filter = f"AND tag_name IN ({escaped})"

    try:
        tag_rows = _query_sql(
            f"SELECT table_name, tag_name, tag_value "
            f"FROM {catalog}.information_schema.table_tags "
            f"WHERE schema_name = '{safe_schema}' {tag_filter}",
            workspace_url=workspace_url,
        )
        tags_by_table: dict[str, dict] = {}
        for row in tag_rows:
            tn = row.get("table_name") or ""
            if tn not in tags_by_table:
                tags_by_table[tn] = {}
            tags_by_table[tn][row.get("tag_name") or ""] = row.get("tag_value") or ""
        for t in out:
            name = t.get("name") or ""
            if name in tags_by_table:
                t["tags"] = tags_by_table[name]
    except Exception:
        pass

    return out


def get_table(full_name: str, workspace_url: str = "primary") -> dict:
    return _do("GET", f"/api/2.1/unity-catalog/tables/{full_name}",
               workspace_url=workspace_url)


def get_table_tags(full_name: str, workspace_url: str = "primary") -> dict:
    """Get current tags for a table."""
    if _is_primary(workspace_url):
        return _get_current_tags_sql(full_name, workspace_url=workspace_url)
    table = get_table(full_name, workspace_url=workspace_url)
    return _extract_tags(table)


def _extract_tags(table: dict) -> dict:
    tags = table.get("tags")
    if isinstance(tags, dict):
        return tags
    if isinstance(tags, list):
        flat: dict[str, str] = {}
        for entry in tags:
            if isinstance(entry, dict) and "key" in entry:
                flat[entry["key"]] = entry.get("value", "")
        return flat
    return {}


# --------------------------------------------------------------------------- #
# Writes
# --------------------------------------------------------------------------- #
def _get_current_tags_sql(full_name: str, workspace_url: str = "primary") -> dict:
    parts = full_name.split(".")
    if len(parts) != 3:
        return {}
    cat, sch, tbl = [p.replace("'", "''") for p in parts]
    try:
        rows = _query_sql(
            f"SELECT tag_name, tag_value "
            f"FROM {cat}.information_schema.table_tags "
            f"WHERE schema_name = '{sch}' AND table_name = '{tbl}'",
            workspace_url=workspace_url,
        )
        return {r.get("tag_name", ""): r.get("tag_value", "") for r in rows if r.get("tag_name")}
    except Exception:
        return {}


def update_table_tags(full_name: str, tags: dict,
                      workspace_url: str = "primary") -> dict:
    """Set tags via ALTER TABLE SET/UNSET TAGS SQL."""
    def _esc(s: str) -> str:
        return s.replace("'", "''")

    current = _get_current_tags_sql(full_name, workspace_url=workspace_url)
    removed = [k for k in current if k not in tags]

    if tags:
        pairs = ", ".join(f"'{_esc(k)}' = '{_esc(v)}'" for k, v in tags.items())
        set_sql = f"ALTER TABLE {full_name} SET TAGS ({pairs})"
        if _is_primary(workspace_url):
            _run_primary_sql(set_sql)
        else:
            _run_secondary_sql(set_sql, workspace_url=workspace_url)

    if removed:
        keys = ", ".join(f"'{_esc(k)}'" for k in removed)
        unset_sql = f"ALTER TABLE {full_name} UNSET TAGS ({keys})"
        if _is_primary(workspace_url):
            _run_primary_sql(unset_sql)
        else:
            _run_secondary_sql(unset_sql, workspace_url=workspace_url)

    return {"full_name": full_name, "tags": tags}


def _query_sql(statement: str, workspace_url: str = "primary") -> list[dict]:
    """Execute a SELECT statement and return rows as a list of dicts."""
    from server.config import SQL_WAREHOUSE_ID
    if _is_primary(workspace_url):
        warehouse_id = SQL_WAREHOUSE_ID
        client = get_primary_client()
    else:
        warehouse_id = get_secondary_warehouse_id(workspace_url)
        if not warehouse_id:
            raise RuntimeError(
                f"No SQL warehouse configured for secondary workspace: {workspace_url}. "
                "Check SEC_N_SQL_WAREHOUSE_ID in app.yaml."
            )
        client = get_secondary_client(workspace_url)

    resp = client.statement_execution.execute_statement(
        warehouse_id=warehouse_id,
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
        err_msg = ""
        if resp.status and resp.status.error:
            err_msg = str(resp.status.error)
        raise RuntimeError(f"SQL statement failed (state={state}): {err_msg}")
    cols: list[str] = []
    if resp.manifest and resp.manifest.schema and resp.manifest.schema.columns:
        cols = [c.name for c in resp.manifest.schema.columns]
    rows: list[dict] = []
    if resp.result and resp.result.data_array:
        for raw in resp.result.data_array:
            rows.append({cols[i]: raw[i] for i in range(len(cols))})
    return rows


def _run_primary_sql(statement: str) -> dict:
    """Execute a DDL statement on the primary workspace warehouse."""
    from server.config import SQL_WAREHOUSE_ID
    client = get_primary_client()
    resp = client.statement_execution.execute_statement(
        warehouse_id=SQL_WAREHOUSE_ID,
        statement=statement,
        wait_timeout="30s",
    )
    statement_id = resp.statement_id
    state = resp.status.state.value if resp.status and resp.status.state else None
    deadline = time.time() + 60
    while state in (None, "PENDING", "RUNNING") and time.time() < deadline:
        time.sleep(1)
        resp = client.statement_execution.get_statement(statement_id)
        state = resp.status.state.value if resp.status and resp.status.state else None
    if state != "SUCCEEDED":
        err = ""
        if resp.status and resp.status.error:
            err = resp.status.error.message or ""
        raise RuntimeError(f"Statement failed ({state}): {err}")
    return {"statement_id": statement_id, "state": state}


def _run_secondary_sql(statement: str, workspace_url: str = "primary") -> dict:
    """Execute a DDL statement on the secondary workspace warehouse."""
    warehouse_id = get_secondary_warehouse_id(workspace_url)
    if not warehouse_id:
        raise RuntimeError(
            f"No SQL warehouse configured for secondary workspace: {workspace_url}. "
            "Check SEC_N_SQL_WAREHOUSE_ID in app.yaml."
        )
    client = get_secondary_client(workspace_url)
    resp = client.statement_execution.execute_statement(
        warehouse_id=warehouse_id,
        statement=statement,
        wait_timeout="30s",
    )
    statement_id = resp.statement_id
    state = resp.status.state.value if resp.status and resp.status.state else None
    deadline = time.time() + 60
    while state in (None, "PENDING", "RUNNING") and time.time() < deadline:
        time.sleep(1)
        resp = client.statement_execution.get_statement(statement_id)
        state = resp.status.state.value if resp.status and resp.status.state else None
    if state != "SUCCEEDED":
        err = ""
        if resp.status and resp.status.error:
            err = resp.status.error.message or ""
        raise RuntimeError(f"Statement failed ({state}): {err}")
    return {"statement_id": statement_id, "state": state}


# --------------------------------------------------------------------------- #
# Status helpers
# --------------------------------------------------------------------------- #
def table_status(table: dict) -> dict:
    tags = _extract_tags(table)
    return {
        "tag_count": len(tags),
        "tags": tags,
    }
