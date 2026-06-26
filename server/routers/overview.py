"""Overview metrics aggregated across the active scope."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from server.services import delta_config as cfg
from server.services import unity_catalog as uc
from server.services import check_cache as _cc

router = APIRouter(prefix="/api/overview", tags=["overview"])

_SCOPE_TTL  = 300   # 5 min — scope config changes infrequently
_COUNTS_TTL = 300   # 5 min — table counts change infrequently


def _pct(numerator: int, denominator: int) -> float:
    if denominator <= 0:
        return 0.0
    return round(100.0 * numerator / denominator, 1)


def _catalog_counts_sql(catalog: str, schemas: list[str], workspace_url: str) -> list[dict]:
    """ONE SQL query returns counts for ALL schemas in a catalog via GROUP BY."""
    from server.services.unity_catalog import _query_sql
    if not schemas:
        return []
    in_list = ", ".join(f"'{s.replace(chr(39), chr(39)*2)}'" for s in schemas)
    rows = _query_sql(
        f"SELECT t.table_schema,"
        f"  COUNT(DISTINCT t.table_name) AS total,"
        f"  COUNT(DISTINCT tg.table_name) AS tagged"
        f" FROM `{catalog}`.information_schema.tables t"
        f" LEFT JOIN `{catalog}`.information_schema.table_tags tg"
        f"   ON tg.schema_name = t.table_schema AND tg.table_name = t.table_name"
        f" WHERE t.table_schema IN ({in_list})"
        f"   AND t.table_type NOT IN ('SYSTEM_DEFINED', 'TEMPORARY')"
        f"   AND LEFT(t.table_name, 2) != '__'"
        f" GROUP BY t.table_schema",
        workspace_url=workspace_url,
    )
    return rows


@router.get("/scopes")
def get_scopes(workspace_url: str = Query(default="")):
    """Active scope entries for a specific workspace — cached 5 min per workspace."""
    from server.config import primary_host

    def _norm(u: str) -> str:
        return (u or "").rstrip("/").lower()

    cache_key = f"overview:scopes:{_norm(workspace_url)}"
    hit, cached = _cc.get(cache_key)
    if hit:
        return cached

    try:
        scope = cfg.get_scope_config(active_only=True)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"scope error: {exc}")

    ph = primary_host() or ""

    def _matches(entry_url: str) -> bool:
        eu = _norm(entry_url)
        wu = _norm(workspace_url)
        if not wu:
            return True  # no filter — return all (backwards compat)
        # primary sentinel or blank stored url → compare against primary host
        if eu in ("", "primary"):
            eu = _norm(ph)
        return eu == wu

    result = [
        {
            "workspace_url": e.get("workspace_url", "primary"),
            "catalog": e["catalog_name"],
            "schema": e["schema_name"],
        }
        for e in scope
        if _matches(e.get("workspace_url", ""))
    ]
    _cc.put(cache_key, result, ttl=_SCOPE_TTL)
    return result


@router.get("/catalog-metrics")
def get_catalog_metrics(
    catalog: str = Query(...),
    schemas: str = Query(...),            # comma-separated schema names
    workspace_url: str = Query(default="primary"),
):
    """Counts for ALL requested schemas in one SQL GROUP BY — one call per catalog.

    Returns list[{schema, tables_total, tables_tagged, tables_tagged_pct, error}].
    Results cached 5 min per (workspace, catalog, schema-set).
    """
    schema_list = [s.strip() for s in schemas.split(",") if s.strip()]
    cache_key = f"overview:catalog:{workspace_url}:{catalog}:{','.join(sorted(schema_list))}"
    hit, cached = _cc.get(cache_key)
    if hit:
        return cached

    try:
        rows = _catalog_counts_sql(catalog, schema_list, workspace_url)
        by_schema = {r["table_schema"]: r for r in rows}
        result = []
        for sch in schema_list:
            r = by_schema.get(sch)
            total  = int(r["total"]  or 0) if r else 0
            tagged = int(r["tagged"] or 0) if r else 0
            result.append({
                "workspace_url": workspace_url,
                "catalog": catalog,
                "schema": sch,
                "tables_total": total,
                "tables_tagged": tagged,
                "tables_tagged_pct": _pct(tagged, total),
                "error": False,
            })
    except Exception as exc:  # noqa: BLE001
        result = [
            {
                "workspace_url": workspace_url,
                "catalog": catalog,
                "schema": sch,
                "tables_total": 0,
                "tables_tagged": 0,
                "tables_tagged_pct": 0.0,
                "error": True,
                "error_detail": str(exc),
            }
            for sch in schema_list
        ]

    _cc.put(cache_key, result, ttl=_COUNTS_TTL)
    return result


@router.get("/schema-metrics")
def get_schema_metrics(
    catalog: str = Query(...),
    schema: str = Query(...),
    workspace_url: str = Query(default="primary"),
):
    """Single-schema fallback — delegates to catalog-metrics."""
    results = get_catalog_metrics(catalog=catalog, schemas=schema, workspace_url=workspace_url)
    return results[0] if results else {
        "workspace_url": workspace_url, "catalog": catalog, "schema": schema,
        "tables_total": 0, "tables_tagged": 0, "tables_tagged_pct": 0.0, "error": True,
    }


@router.get("/tag-coverage")
def get_tag_coverage(
    workspace_url: str = Query(default="primary"),
    tag_keys: str = Query(default=""),
):
    """Per-tag fill-rate across the active scope for a workspace.

    One SQL per catalog (UNION ALL) gives total-table count + per-tag counts.
    tag_keys: optional comma-separated list — only those tags are computed.
    Returns list sorted by pct desc: [{tag_key, tables_tagged, tables_total, pct}]
    Cached 5 min per (workspace, tag_keys).
    """
    from server.services.unity_catalog import _query_sql
    from server.config import primary_host

    keys = [k.strip() for k in tag_keys.split(",") if k.strip()]

    def _norm(u: str) -> str:
        return (u or "").rstrip("/").lower()

    cache_key = f"overview:tag-coverage:{_norm(workspace_url)}:{','.join(sorted(keys))}"
    hit, cached = _cc.get(cache_key)
    if hit:
        return cached

    try:
        scope = cfg.get_scope_config(active_only=True)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"scope error: {exc}")

    ph = primary_host() or ""

    def _matches(entry_url: str) -> bool:
        eu = _norm(entry_url)
        wu = _norm(workspace_url)
        if not wu:
            return True
        if eu in ("", "primary"):
            eu = _norm(ph)
        return eu == wu

    catalog_schemas: dict[str, list[str]] = {}
    for e in scope:
        if not _matches(e.get("workspace_url", "")):
            continue
        catalog_schemas.setdefault(e["catalog_name"], []).append(e["schema_name"])

    total_tables = 0
    tag_counts: dict[str, int] = {}

    for catalog, schemas in catalog_schemas.items():
        if not schemas:
            continue
        in_list = ", ".join(f"'{s.replace(chr(39), chr(39)*2)}'" for s in schemas)
        tag_filter = (
            " AND tg.tag_name IN (" + ", ".join(f"'{k.replace(chr(39), chr(39)*2)}'" for k in keys) + ")"
            if keys else ""
        )
        try:
            rows = _query_sql(
                # Row 1 per catalog: total in-scope table count
                f"SELECT '__TOTAL__' AS tag_name,"
                f"  COUNT(DISTINCT CONCAT(table_schema, '.', table_name)) AS cnt"
                f" FROM `{catalog}`.information_schema.tables"
                f" WHERE table_schema IN ({in_list})"
                f"   AND table_type NOT IN ('SYSTEM_DEFINED', 'TEMPORARY')"
                f"   AND LEFT(table_name, 2) != '__'"
                f" UNION ALL"
                # One row per tag_name: distinct (schema.table) pairs that have it set
                f" SELECT tg.tag_name,"
                f"  COUNT(DISTINCT CONCAT(tg.schema_name, '.', tg.table_name)) AS cnt"
                f" FROM `{catalog}`.information_schema.table_tags tg"
                f" JOIN `{catalog}`.information_schema.tables t"
                f"   ON t.table_schema = tg.schema_name AND t.table_name = tg.table_name"
                f" WHERE tg.schema_name IN ({in_list})"
                f"   AND t.table_type NOT IN ('SYSTEM_DEFINED', 'TEMPORARY')"
                f"   AND LEFT(t.table_name, 2) != '__'"
                f"{tag_filter}"
                f" GROUP BY tg.tag_name",
                workspace_url=workspace_url,
            )
            for row in rows:
                name = row.get("tag_name") or ""
                cnt  = int(row.get("cnt") or 0)
                if name == "__TOTAL__":
                    total_tables += cnt
                else:
                    tag_counts[name] = tag_counts.get(name, 0) + cnt
        except Exception:  # noqa: BLE001
            pass

    result = sorted(
        [
            {
                "tag_key": tag,
                "tables_tagged": count,
                "tables_total": total_tables,
                "pct": _pct(count, total_tables),
            }
            for tag, count in tag_counts.items()
        ],
        key=lambda x: x["pct"],
        reverse=True,
    )
    _cc.put(cache_key, result, ttl=_COUNTS_TTL)
    return result


@router.get("/metrics")
def get_metrics():
    """Blocking aggregate endpoint — kept for backwards compatibility."""
    try:
        scope = cfg.get_scope_config(active_only=True)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"scope error: {exc}")

    # Group by (workspace, catalog) to batch SQL
    groups: dict[tuple, list[str]] = {}
    for e in scope:
        key = (e.get("workspace_url", "primary"), e["catalog_name"])
        groups.setdefault(key, []).append(e["schema_name"])

    per_schema: list[dict] = []
    for (ws, cat), schemas in groups.items():
        try:
            rows = _catalog_counts_sql(cat, schemas, ws)
            by_sch = {r["table_schema"]: r for r in rows}
            for sch in schemas:
                r = by_sch.get(sch)
                total  = int(r["total"]  or 0) if r else 0
                tagged = int(r["tagged"] or 0) if r else 0
                per_schema.append({
                    "workspace_url": ws, "catalog": cat, "schema": sch,
                    "tables_total": total, "tables_tagged": tagged,
                    "tables_tagged_pct": _pct(tagged, total), "error": False,
                })
        except Exception:  # noqa: BLE001
            for sch in schemas:
                per_schema.append({
                    "workspace_url": ws, "catalog": cat, "schema": sch,
                    "tables_total": 0, "tables_tagged": 0,
                    "tables_tagged_pct": 0.0, "error": True,
                })

    tables_total  = sum(r["tables_total"]  for r in per_schema)
    tables_tagged = sum(r["tables_tagged"] for r in per_schema)
    return {
        "tables_total": tables_total,
        "tables_tagged_pct": _pct(tables_tagged, tables_total),
        "tables_tagged": tables_tagged,
        "per_schema": per_schema,
    }
