"""Overview metrics aggregated across the active scope."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from server.services import delta_config as cfg
from server.services import unity_catalog as uc

router = APIRouter(prefix="/api/overview", tags=["overview"])


def _pct(numerator: int, denominator: int) -> float:
    if denominator <= 0:
        return 0.0
    return round(100.0 * numerator / denominator, 1)


@router.get("/metrics")
def get_metrics():
    try:
        scope = cfg.get_scope_config(active_only=True)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"scope error: {exc}")

    tables_total = 0
    tables_tagged = 0
    per_schema: list[dict] = []

    for entry in scope:
        workspace_url = entry.get("workspace_url", "primary")
        catalog = entry["catalog_name"]
        schema = entry["schema_name"]
        try:
            tables = uc.list_tables(catalog, schema, workspace_url=workspace_url)
        except Exception:  # noqa: BLE001
            per_schema.append({
                "workspace_url": workspace_url,
                "catalog": catalog, "schema": schema,
                "tables_total": 0, "tables_tagged": 0,
                "tables_tagged_pct": 0.0, "error": True,
            })
            continue

        s_total = len(tables)
        s_tagged = 0

        for t in tables:
            status = uc.table_status(t)
            if status["tag_count"] > 0:
                s_tagged += 1

        tables_total += s_total
        tables_tagged += s_tagged

        per_schema.append({
            "workspace_url": workspace_url,
            "catalog": catalog, "schema": schema,
            "tables_total": s_total,
            "tables_tagged": s_tagged,
            "tables_tagged_pct": _pct(s_tagged, s_total),
            "error": False,
        })

    return {
        "tables_total": tables_total,
        "tables_tagged_pct": _pct(tables_tagged, tables_total),
        "tables_tagged": tables_tagged,
        "per_schema": per_schema,
    }
