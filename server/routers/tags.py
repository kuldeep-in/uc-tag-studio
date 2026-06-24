"""Table tag endpoints (metadata only)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from server.dependencies import current_user_token
from server.services import unity_catalog as uc

router = APIRouter(prefix="/api/tags", tags=["tags"])


class TagsBody(BaseModel):
    tags: dict[str, str]
    workspace_url: str = "primary"


@router.get("/table/{full_name}")
def get_table_tags(
    full_name: str,
    workspace_url: str = "primary",
    token: str = Depends(current_user_token),
):
    try:
        tags = uc.get_table_tags(full_name, workspace_url=workspace_url, token=token)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=str(exc))
    return {"full_name": full_name, "tags": tags}


@router.patch("/table/{full_name}")
def patch_table_tags(
    full_name: str,
    body: TagsBody,
    token: str = Depends(current_user_token),
):
    try:
        uc.update_table_tags(full_name, body.tags,
                             workspace_url=body.workspace_url, token=token)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=str(exc))
    return {"full_name": full_name, "tags": body.tags, "ok": True}
