"""Overview metrics aggregated across the active scope."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from server.dependencies import current_user_token
from server.services import delta_config as cfg
from server.services import unity_catalog as uc

router = APIRouter(prefix="/api/overview", tags=["overview"])


def _pct(numerator: int, denominator: int) -> float:
    if denominator <= 0:
        return 0.0
    return round(100.0 * numerator / denominator, 1)


@router.get("/metrics")
def get_metrics(token: str = Depends(current_user_token)):
    try:
        scope = cfg.get_scope_config(active_only=True, token=token)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"scope error: {exc}")

    tables_total = 0
    tables_tagged = 0
    tables_commented = 0
    columns_total = 0
    columns_commented = 0
    per_schema: list[dict] = []

    for entry in scope:
        workspace_url = entry.get("workspace_url", "primary")
        catalog = entry["catalog_name"]
        schema = entry["schema_name"]
        try:
            tables = uc.list_tables(catalog, schema,
                                    workspace_url=workspace_url, token=token)
        except Exception:  # noqa: BLE001
            per_schema.append({
                "workspace_url": workspace_url,
                "catalog": catalog, "schema": schema,
                "tables_total": 0, "tables_tagged": 0, "tables_commented": 0,
                "columns_total": 0, "columns_commented": 0,
                "tables_tagged_pct": 0.0, "tables_commented_pct": 0.0,
                "columns_commented_pct": 0.0, "error": True,
            })
            continue

        s_total = len(tables)
        s_tagged = s_commented = s_cols = s_cols_commented = 0

        for t in tables:
            status = uc.table_status(t)
            if status["tag_count"] > 0:
                s_tagged += 1
            if status["has_comment"]:
                s_commented += 1
            s_cols += status["columns_total"]
            s_cols_commented += status["columns_commented"]

        tables_total += s_total
        tables_tagged += s_tagged
        tables_commented += s_commented
        columns_total += s_cols
        columns_commented += s_cols_commented

        per_schema.append({
            "workspace_url": workspace_url,
            "catalog": catalog, "schema": schema,
            "tables_total": s_total,
            "tables_tagged": s_tagged, "tables_commented": s_commented,
            "columns_total": s_cols, "columns_commented": s_cols_commented,
            "tables_tagged_pct": _pct(s_tagged, s_total),
            "tables_commented_pct": _pct(s_commented, s_total),
            "columns_commented_pct": _pct(s_cols_commented, s_cols),
            "error": False,
        })

    return {
        "tables_total": tables_total,
        "tables_tagged_pct": _pct(tables_tagged, tables_total),
        "tables_commented_pct": _pct(tables_commented, tables_total),
        "columns_commented_pct": _pct(columns_commented, columns_total),
        "tables_tagged": tables_tagged,
        "tables_commented": tables_commented,
        "columns_total": columns_total,
        "columns_commented": columns_commented,
        "per_schema": per_schema,
    }
