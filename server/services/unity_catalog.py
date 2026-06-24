"""Unity Catalog metadata operations against secondary (and primary) workspaces.

All calls are metadata-only. There is NO SELECT against any table — table data is
never read. Primary workspace operations use the calling user's OAuth token so
they run under the user's own UC permissions. Secondary workspace operations
always use the stored service-principal credentials (the user has no OAuth token
for a different workspace).

Authentication:
  Primary workspace  — get_user_client(token) when token is present; falls back
                       to get_primary_client() (app SP or local profile).
  Secondary workspace — get_secondary_client(workspace_url) always (SP creds).
"""

from __future__ import annotations

import os
import time
from typing import Any

from server.config import get_primary_client, get_secondary_client, get_secondary_warehouse_id, get_user_client


def _is_primary(workspace_url: str) -> bool:
    from server.config import primary_host
    if not workspace_url or workspace_url == "primary":
        return True
    ph = primary_host()
    return bool(ph and workspace_url.rstrip("/") == ph.rstrip("/"))


def _get_client(workspace_url: str = "primary", token: str = ""):
    if _is_primary(workspace_url):
        return get_user_client(token) if token else get_primary_client()
    return get_secondary_client(workspace_url)


def _do(
    method: str,
    path: str,
    *,
    workspace_url: str = "primary",
    token: str = "",
    query: dict | None = None,
    body: dict | None = None,
) -> dict:
    client = _get_client(workspace_url, token=token)
    result = client.api_client.do(method, path, query=query, body=body)
    return result if isinstance(result, dict) else {}


# --------------------------------------------------------------------------- #
# Reads
# --------------------------------------------------------------------------- #
def list_catalogs(workspace_url: str = "primary", token: str = "") -> list[dict]:
    """List catalogs.

    Primary workspace: uses SHOW CATALOGS SQL — requires only the 'sql' OAuth
    scope, not 'unity-catalog'. No REST API fallback here because the user token
    only has 'sql' scope; falling back to the UC REST API would give a misleading
    'unity-catalog' scope error.

    Secondary workspace: uses the UC REST API with the stored SP credentials,
    which have full scope.
    """
    if _is_primary(workspace_url):
        rows = _query_sql("SHOW CATALOGS", workspace_url=workspace_url, token=token)
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
                   workspace_url=workspace_url, token=token, query=query)
        out.extend(resp.get("catalogs", []) or [])
        page_token = resp.get("next_page_token")
        if not page_token:
            break
    return out


def list_schemas(catalog: str, workspace_url: str = "primary", token: str = "") -> list[dict]:
    """List schemas via information_schema.schemata SQL.

    Primary workspace: SQL only — no REST fallback (user token has only sql scope).
    Secondary workspace: SQL first, falls back to UC REST API (SP has full scope).
    """
    try:
        rows = _query_sql(
            f"SELECT schema_name FROM {catalog}.information_schema.schemata "
            f"ORDER BY schema_name",
            workspace_url=workspace_url,
            token=token,
        )
        return [{"name": r["schema_name"], "catalog_name": catalog}
                for r in rows if r.get("schema_name")]
    except Exception:
        if _is_primary(workspace_url):
            raise  # Don't fall back to UC REST API — user token only has sql scope

    # Secondary workspace only: fall back to UC REST API (SP has all scopes).
    out: list[dict] = []
    page_token: str | None = None
    while True:
        query: dict[str, Any] = {"catalog_name": catalog, "max_results": 200}
        if page_token:
            query["page_token"] = page_token
        resp = _do("GET", "/api/2.1/unity-catalog/schemas",
                   workspace_url=workspace_url, token=token, query=query)
        out.extend(resp.get("schemas", []) or [])
        page_token = resp.get("next_page_token")
        if not page_token:
            break
    return out


def list_tables(
    catalog: str,
    schema: str,
    workspace_url: str = "primary",
    token: str = "",
    tag_keys: list[str] | None = None,
) -> list[dict]:
    """List tables using information_schema for maximum visibility.

    Requires only USE CATALOG + USE SCHEMA — no SELECT/BROWSE per table.
    Tags are loaded from information_schema.table_tags and filtered to only the
    keys supplied in tag_keys (the tag dictionary). Falls back to the UC REST
    API if SQL fails (secondary workspace where the SP has all scopes).
    """
    safe_schema = schema.replace("'", "''")
    out: list[dict] = []

    try:
        table_rows = _query_sql(
            f"SELECT table_name, table_type, comment "
            f"FROM {catalog}.information_schema.tables "
            f"WHERE table_schema = '{safe_schema}' "
            f"AND table_type NOT IN ('SYSTEM_DEFINED', 'TEMPORARY') "
            f"AND LEFT(table_name, 2) != '__' "
            f"ORDER BY table_name",
            workspace_url=workspace_url,
            token=token,
        )
        for row in table_rows:
            name = row.get("table_name") or ""
            out.append({
                "full_name": f"{catalog}.{schema}.{name}",
                "name": name,
                "catalog_name": catalog,
                "schema_name": schema,
                "table_type": row.get("table_type"),
                "comment": row.get("comment") or "",
                "tags": {},
                "columns": [],
            })
    except Exception:
        if _is_primary(workspace_url):
            raise  # Don't fall back to UC REST API — user token only has sql scope
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
                       workspace_url=workspace_url, token=token, query=query)
            out.extend(resp.get("tables", []) or [])
            page_token = resp.get("next_page_token")
            if not page_token:
                break

    # Build the tag filter clause — only load tags that are in the config dictionary.
    # information_schema.table_tags uses schema_name (not table_schema).
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
            token=token,
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


def get_table(full_name: str, workspace_url: str = "primary", token: str = "") -> dict:
    """UC REST API table fetch — only use for secondary workspace (SP has unity-catalog scope)."""
    return _do("GET", f"/api/2.1/unity-catalog/tables/{full_name}",
               workspace_url=workspace_url, token=token)


def get_table_comment(full_name: str, workspace_url: str = "primary", token: str = "") -> str:
    """Get a table's comment string.

    Primary workspace: uses information_schema.tables SQL (sql scope only).
    Secondary workspace: uses UC REST API (SP has unity-catalog scope).
    """
    if _is_primary(workspace_url):
        parts = full_name.split(".")
        if len(parts) != 3:
            return ""
        cat, sch, tbl = [p.replace("'", "''") for p in parts]
        rows = _query_sql(
            f"SELECT comment FROM {cat}.information_schema.tables "
            f"WHERE table_schema = '{sch}' AND table_name = '{tbl}'",
            workspace_url=workspace_url,
            token=token,
        )
        return (rows[0].get("comment") or "") if rows else ""
    table = get_table(full_name, workspace_url=workspace_url, token=token)
    return table.get("comment") or ""


def list_columns(full_name: str, workspace_url: str = "primary", token: str = "") -> list[dict]:
    """List columns for a table.

    Primary workspace: uses information_schema.columns SQL (sql scope only).
    Secondary workspace: uses UC REST API (SP has unity-catalog scope).
    """
    if _is_primary(workspace_url):
        parts = full_name.split(".")
        if len(parts) != 3:
            return []
        cat, sch, tbl = [p.replace("'", "''") for p in parts]
        rows = _query_sql(
            f"SELECT column_name, full_data_type, comment "
            f"FROM {cat}.information_schema.columns "
            f"WHERE table_schema = '{sch}' AND table_name = '{tbl}' "
            f"ORDER BY ordinal_position",
            workspace_url=workspace_url,
            token=token,
        )
        return [
            {
                "name": r.get("column_name") or "",
                "type_text": r.get("full_data_type") or "",
                "comment": r.get("comment") or "",
            }
            for r in rows
        ]
    table = get_table(full_name, workspace_url=workspace_url, token=token)
    return table.get("columns", []) or []


def get_table_tags(full_name: str, workspace_url: str = "primary", token: str = "") -> dict:
    """Get current tags for a table.

    Primary workspace: uses information_schema.table_tags SQL (sql scope only).
    Secondary workspace: uses UC REST API (SP has unity-catalog scope).
    """
    if _is_primary(workspace_url):
        return _get_current_tags_sql(full_name, workspace_url=workspace_url, token=token)
    table = get_table(full_name, workspace_url=workspace_url, token=token)
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
def update_table_comment(full_name: str, comment: str,
                         workspace_url: str = "primary", token: str = "") -> dict:
    safe = (comment or "").replace("'", "''")
    sql = f"COMMENT ON TABLE {full_name} IS '{safe}'"
    if _is_primary(workspace_url):
        return _run_primary_sql(sql, token=token)
    return _run_secondary_sql(sql, workspace_url=workspace_url)


def _get_current_tags_sql(full_name: str, workspace_url: str = "primary", token: str = "") -> dict:
    """Get current tags for a table using information_schema.table_tags SQL.
    Only needs sql scope — avoids the unity-catalog REST API scope requirement.
    """
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
            token=token,
        )
        return {r.get("tag_name", ""): r.get("tag_value", "") for r in rows if r.get("tag_name")}
    except Exception:
        return {}


def update_table_tags(full_name: str, tags: dict,
                      workspace_url: str = "primary", token: str = "") -> dict:
    """Set tags via ALTER TABLE SET/UNSET TAGS SQL."""
    def _esc(s: str) -> str:
        return s.replace("'", "''")

    current = _get_current_tags_sql(full_name, workspace_url=workspace_url, token=token)
    removed = [k for k in current if k not in tags]

    if tags:
        pairs = ", ".join(f"'{_esc(k)}' = '{_esc(v)}'" for k, v in tags.items())
        set_sql = f"ALTER TABLE {full_name} SET TAGS ({pairs})"
        if _is_primary(workspace_url):
            _run_primary_sql(set_sql, token=token)
        else:
            _run_secondary_sql(set_sql, workspace_url=workspace_url)

    if removed:
        keys = ", ".join(f"'{_esc(k)}'" for k in removed)
        unset_sql = f"ALTER TABLE {full_name} UNSET TAGS ({keys})"
        if _is_primary(workspace_url):
            _run_primary_sql(unset_sql, token=token)
        else:
            _run_secondary_sql(unset_sql, workspace_url=workspace_url)

    return {"full_name": full_name, "tags": tags}


def update_column_comment(full_name: str, col_name: str, comment: str,
                           workspace_url: str = "primary", token: str = "") -> dict:
    safe_comment = (comment or "").replace("'", "''")
    sql = f"ALTER TABLE {full_name} ALTER COLUMN {col_name} COMMENT '{safe_comment}'"
    if _is_primary(workspace_url):
        return _run_primary_sql(sql, token=token)
    return _run_secondary_sql(sql, workspace_url=workspace_url)


def _query_sql(statement: str, workspace_url: str = "primary", token: str = "") -> list[dict]:
    """Execute a SELECT statement and return rows as a list of dicts."""
    from server.config import SQL_WAREHOUSE_ID
    if _is_primary(workspace_url):
        warehouse_id = SQL_WAREHOUSE_ID
        client = get_user_client(token) if token else get_primary_client()
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


def _run_primary_sql(statement: str, token: str = "") -> dict:
    """Execute a DDL statement on the primary workspace warehouse."""
    from server.config import SQL_WAREHOUSE_ID
    client = get_user_client(token) if token else get_primary_client()
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
    comment = (table.get("comment") or "").strip()
    tags = _extract_tags(table)
    columns = table.get("columns", []) or []
    cols_total = len(columns)
    cols_commented = sum(1 for c in columns if (c.get("comment") or "").strip())
    return {
        "has_comment": bool(comment),
        "comment": comment,
        "tag_count": len(tags),
        "tags": tags,
        "columns_total": cols_total,
        "columns_commented": cols_commented,
    }
