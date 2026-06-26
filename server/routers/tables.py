"""Table listing with tag status (metadata only)."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from server.services import unity_catalog as uc

router = APIRouter(prefix="/api", tags=["tables"])


@router.get("/tables")
def get_tables(
    catalog: str = Query(...),
    schema: str = Query(...),
    workspace_url: str = Query(default="primary"),
):
    try:
        tables = uc.list_tables(catalog, schema, workspace_url=workspace_url)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=str(exc))

    out = []
    for t in tables:
        status = uc.table_status(t)
        out.append(
            {
                "full_name": t.get("full_name") or f"{catalog}.{schema}.{t.get('name')}",
                "catalog_name": t.get("catalog_name", catalog),
                "schema_name": t.get("schema_name", schema),
                "workspace_url": workspace_url,
                "name": t.get("name"),
                "table_type": t.get("table_type"),
                "tag_count": status["tag_count"],
                "tags": status["tags"],
            }
        )
    return out
