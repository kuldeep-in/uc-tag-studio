"""Table and column comment endpoints (metadata only)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from server.dependencies import current_user_token
from server.services import unity_catalog as uc

router = APIRouter(prefix="/api/comments", tags=["comments"])


class CommentBody(BaseModel):
    comment: str = ""
    workspace_url: str = "primary"


class BulkTarget(BaseModel):
    type: str  # "table" | "column"
    full_name: str
    column_name: str | None = None
    workspace_url: str = "primary"


class BulkBody(BaseModel):
    targets: list[BulkTarget]
    comment: str = ""
    workspace_url: str = "primary"


@router.get("/table/{full_name}")
def get_table_comment(
    full_name: str,
    workspace_url: str = "primary",
    token: str = Depends(current_user_token),
):
    try:
        comment = uc.get_table_comment(full_name, workspace_url=workspace_url, token=token)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=str(exc))
    return {"full_name": full_name, "comment": comment}


@router.patch("/table/{full_name}")
def patch_table_comment(
    full_name: str,
    body: CommentBody,
    token: str = Depends(current_user_token),
):
    try:
        uc.update_table_comment(full_name, body.comment,
                                workspace_url=body.workspace_url, token=token)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=str(exc))
    return {"full_name": full_name, "comment": body.comment, "ok": True}


@router.get("/columns/{full_name}")
def get_columns(
    full_name: str,
    workspace_url: str = "primary",
    token: str = Depends(current_user_token),
):
    try:
        columns = uc.list_columns(full_name, workspace_url=workspace_url, token=token)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=str(exc))
    return [
        {
            "name": c.get("name"),
            "type_text": c.get("type_text"),
            "comment": c.get("comment") or "",
            "has_comment": bool((c.get("comment") or "").strip()),
        }
        for c in columns
    ]


@router.patch("/column/{full_name}/{column_name}")
def patch_column_comment(
    full_name: str,
    column_name: str,
    body: CommentBody,
    token: str = Depends(current_user_token),
):
    try:
        uc.update_column_comment(full_name, column_name, body.comment,
                                 workspace_url=body.workspace_url, token=token)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=str(exc))
    return {"full_name": full_name, "column_name": column_name,
            "comment": body.comment, "ok": True}


@router.post("/bulk")
def bulk_comment(body: BulkBody, token: str = Depends(current_user_token)):
    results = []
    for target in body.targets:
        ws_url = target.workspace_url or body.workspace_url or "primary"
        try:
            if target.type == "table":
                uc.update_table_comment(target.full_name, body.comment,
                                        workspace_url=ws_url, token=token)
            elif target.type == "column":
                if not target.column_name:
                    raise ValueError("column_name required for column targets")
                uc.update_column_comment(target.full_name, target.column_name,
                                         body.comment, workspace_url=ws_url, token=token)
            else:
                raise ValueError(f"unknown target type: {target.type}")
            results.append({"full_name": target.full_name,
                             "column_name": target.column_name, "ok": True})
        except Exception as exc:  # noqa: BLE001
            results.append({"full_name": target.full_name,
                             "column_name": target.column_name,
                             "ok": False, "error": str(exc)})
    return {
        "applied": sum(1 for r in results if r["ok"]),
        "failed": sum(1 for r in results if not r["ok"]),
        "results": results,
    }
