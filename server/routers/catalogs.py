"""Catalog and schema listing endpoints (metadata only)."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from server.services import unity_catalog as uc

router = APIRouter(prefix="/api", tags=["catalogs"])


@router.get("/catalogs")
def get_catalogs(workspace_url: str = Query(default="primary")):
    try:
        catalogs = uc.list_catalogs(workspace_url=workspace_url)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=str(exc))
    return [{"name": c.get("name"), "comment": c.get("comment")} for c in catalogs]


@router.get("/schemas")
def get_schemas(
    catalog: str = Query(...),
    workspace_url: str = Query(default="primary"),
):
    try:
        schemas = uc.list_schemas(catalog, workspace_url=workspace_url)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=str(exc))
    return [
        {
            "name": s.get("name"),
            "catalog_name": s.get("catalog_name"),
            "comment": s.get("comment"),
        }
        for s in schemas
    ]
