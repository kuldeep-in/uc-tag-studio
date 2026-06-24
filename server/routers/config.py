"""Config endpoints — scope, tag dictionary, and secondary workspaces."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from server.dependencies import current_user_token
from server.services import delta_config as cfg

router = APIRouter(prefix="/api/config", tags=["config"])


@router.get("/identity")
def get_identity(token: str = Depends(current_user_token)):
    """Return the identity of the logged-in user."""
    try:
        from server.config import get_user_client, get_primary_client, SQL_WAREHOUSE_ID
        client = get_user_client(token) if token else get_primary_client()
        me = client.current_user.me()
        return {
            "user_name": me.user_name,
            "display_name": me.display_name or me.user_name or "",
            "is_service_principal": not me.user_name or "@" not in (me.user_name or ""),
            "sql_warehouse_id": SQL_WAREHOUSE_ID,
        }
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=str(exc))


class ScopeBody(BaseModel):
    workspace_url: str = "primary"
    catalog: str
    schema: str
    is_active: bool = True


class TagDictBody(BaseModel):
    tag_key: str
    allowed_values: list[str] | None = None
    free_text: bool = False


# --------------------------------------------------------------------------- #
# Scope
# --------------------------------------------------------------------------- #
@router.get("/scope")
def get_scope(token: str = Depends(current_user_token)):
    try:
        return cfg.get_scope_config(token=token)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=str(exc))


@router.post("/scope")
def post_scope(body: ScopeBody, token: str = Depends(current_user_token)):
    try:
        return cfg.upsert_scope(body.workspace_url, body.catalog,
                                body.schema, body.is_active, token=token)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=str(exc))


@router.delete("/scope")
def delete_scope(body: ScopeBody, token: str = Depends(current_user_token)):
    try:
        return cfg.delete_scope(body.workspace_url, body.catalog, body.schema, token=token)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=str(exc))


# --------------------------------------------------------------------------- #
# Tag dictionary
# --------------------------------------------------------------------------- #
@router.get("/tagdictionary")
def get_tag_dictionary(token: str = Depends(current_user_token)):
    try:
        return cfg.get_tag_dictionary(token=token)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=str(exc))


@router.post("/tagdictionary")
def post_tag_dictionary(body: TagDictBody, token: str = Depends(current_user_token)):
    try:
        return cfg.upsert_tag_key(body.tag_key, body.allowed_values,
                                   body.free_text, token=token)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=str(exc))


@router.delete("/tagdictionary/{tag_key}")
def delete_tag_dictionary(tag_key: str, token: str = Depends(current_user_token)):
    try:
        return cfg.delete_tag_key(tag_key, token=token)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=str(exc))


class TagOrderBody(BaseModel):
    ordered_keys: list[str]


@router.put("/tagdictionary/order")
def put_tag_order(body: TagOrderBody, token: str = Depends(current_user_token)):
    try:
        cfg.set_tag_order(body.ordered_keys, token=token)
        return {"ordered_keys": body.ordered_keys}
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=str(exc))


# --------------------------------------------------------------------------- #
# Secondary workspaces
# --------------------------------------------------------------------------- #
@router.get("/workspaces")
def get_workspaces(token: str = Depends(current_user_token)):
    """All workspaces — primary first, then SEC_N_* secondaries."""
    try:
        from server.config import get_all_workspace_infos
        return get_all_workspace_infos()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=str(exc))


