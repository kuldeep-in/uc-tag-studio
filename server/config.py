"""Dual-mode authentication and configuration.

This module exposes WorkspaceClient factories for the two workspace types:

* Primary Region  — where this Databricks App runs. Authenticated via the
  logged-in user's OAuth token (X-Forwarded-Access-Token); locally falls back
  to the ``fevm01`` CLI profile.
* Secondary Region — one or more remote workspaces, each authenticated with a
  dedicated service principal whose credentials are supplied via ``SEC_N_*``
  env vars in ``app.yaml``. Never uses the logged-in user's identity.
"""

from __future__ import annotations

import logging
import os

from databricks.sdk import WorkspaceClient

logger = logging.getLogger(__name__)

# True when running inside a deployed Databricks App (creds auto-injected).
IS_DATABRICKS_APP: bool = bool(os.environ.get("DATABRICKS_APP_NAME"))

# Local development profile for the Primary Region workspace.
PRIMARY_PROFILE = "fevm01"

# --- Config table location (Primary Region) ---
CONFIG_CATALOG = os.environ.get("CONFIG_CATALOG", "main")
CONFIG_SCHEMA = os.environ.get("CONFIG_SCHEMA", "uc_governance")
SQL_WAREHOUSE_ID = os.environ.get("SQL_WAREHOUSE_ID", "")


def get_primary_client() -> WorkspaceClient:
    """WorkspaceClient for the Primary Region workspace.

    Inside a Databricks App this resolves to the app's own service principal via
    auto-injected env vars. Locally it uses the ``fevm01`` CLI profile.
    """
    if IS_DATABRICKS_APP:
        return WorkspaceClient()
    return WorkspaceClient(profile=PRIMARY_PROFILE)


def get_user_client(token: str) -> WorkspaceClient:
    """WorkspaceClient authenticated as the logged-in user via their OAuth token.

    Databricks Apps injects the user's token in X-Forwarded-Access-Token on
    every request. Pass that token here so all UC operations run under the
    calling user's identity instead of the app SP.

    Setting auth_type="pat" bypasses the SDK's multi-auth conflict check in
    Config._validate() and tells DefaultCredentials to skip all non-PAT
    providers — so the auto-injected DATABRICKS_CLIENT_ID/SECRET env vars are
    ignored even though they're present.

    Falls back to get_primary_client() when no token or host is available.
    """
    host = primary_host()
    if not token or not host:
        return get_primary_client()
    return WorkspaceClient(host=host, token=token, auth_type="pat")


def _build_secondary_client(workspace_url: str, client_id: str, client_secret: str) -> WorkspaceClient:
    """Build a WorkspaceClient for a secondary workspace using OAuth M2M credentials.

    The Databricks Apps platform injects DATABRICKS_CLIENT_ID/SECRET (primary SP) as env vars.
    Passing those to WorkspaceClient() alongside explicit secondary credentials causes the SDK
    to use the primary SP credentials, which aren't registered in the secondary workspace.
    Fix: exchange the token manually (bypassing the SDK auth layer), then create a PAT client.
    """
    import httpx as _httpx

    host = workspace_url.strip().rstrip("/")
    if not host.startswith("http"):
        host = f"https://{host}"

    logger.info(
        "Secondary workspace M2M token exchange: host=%s client_id=%s secret_len=%d",
        host, client_id, len(client_secret),
    )
    resp = _httpx.post(
        f"{host}/oidc/v1/token",
        data={
            "grant_type": "client_credentials",
            "client_id": client_id,
            "client_secret": client_secret,
            "scope": "all-apis",
        },
        timeout=30,
    )
    if resp.status_code != 200:
        raise RuntimeError(
            f"M2M token exchange failed for {host} (client_id={client_id}): "
            f"{resp.status_code} {resp.text}"
        )
    token = resp.json().get("access_token", "")
    if not token:
        raise RuntimeError(f"M2M token exchange returned no access_token for {host}")

    logger.info("Secondary workspace token acquired OK: host=%s", host)
    return WorkspaceClient(host=host, token=token, auth_type="pat")


def _resolve_secret_ref(value: str) -> str:
    """Resolve a {{secrets/scope/key}} reference by reading directly from the Secrets API.

    Databricks Apps is supposed to resolve these references at startup, but in some
    environments the literal placeholder string is injected instead. This function
    detects that case and reads the value via the Databricks Secrets API using the
    app's own service principal credentials (which have READ on the scope).
    """
    if not (value.startswith("{{secrets/") and value.endswith("}}")):
        return value  # already a plain value — nothing to do
    path = value[2:-2]  # strip {{ and }}
    parts = path.split("/")
    if len(parts) != 3 or parts[0] != "secrets":
        return value  # unrecognised format — return as-is
    scope, key = parts[1], parts[2]
    logger.info("Secret ref unresolved by platform — fetching via Secrets API: scope=%s key=%s", scope, key)
    try:
        import base64 as _base64
        result = get_primary_client().secrets.get_secret(scope=scope, key=key)
        b64 = result.value or ""
        decoded = _base64.b64decode(b64).decode("utf-8")
        logger.info("Secret fetched OK from Secrets API: scope=%s key=%s decoded_len=%d", scope, key, len(decoded))
        return decoded
    except Exception as exc:
        raise RuntimeError(
            f"Failed to resolve secret {{{{secrets/{scope}/{key}}}}}: {exc}"
        ) from exc


def _parse_secondary_workspaces_from_env() -> list[dict]:
    """Scan app.yaml env vars for SEC_N_* blocks and return workspace configs.

    Each secondary workspace needs five variables (N = 1, 2, 3, ...):
      SEC_N_WORKSPACE_URL, SEC_N_DISPLAY_NAME (optional),
      SEC_N_SP_CLIENT_ID, SEC_N_SP_CLIENT_SECRET, SEC_N_SQL_WAREHOUSE_ID
    Scanning stops at the first N with no WORKSPACE_URL set.
    """
    workspaces = []
    n = 1
    while True:
        url = os.environ.get(f"SEC_{n}_WORKSPACE_URL", "").strip()
        if not url:
            break
        normalized = url if url.startswith("http") else f"https://{url}"
        raw_secret = os.environ.get(f"SEC_{n}_SP_CLIENT_SECRET", "").strip()
        workspaces.append({
            "workspace_url": normalized,
            "display_name": (
                os.environ.get(f"SEC_{n}_DISPLAY_NAME", "").strip()
                or normalized.replace("https://", "")
            ),
            "client_id": _resolve_secret_ref(os.environ.get(f"SEC_{n}_SP_CLIENT_ID", "").strip()),
            "client_secret": _resolve_secret_ref(raw_secret),
            "warehouse_id": os.environ.get(f"SEC_{n}_SQL_WAREHOUSE_ID", "").strip(),
        })
        n += 1
    return workspaces


def get_secondary_client(workspace_url: str = "") -> WorkspaceClient:
    """WorkspaceClient for a secondary workspace.

    Resolves credentials by matching workspace_url against SEC_N_WORKSPACE_URL
    entries in the environment. Add secondary workspaces by adding SEC_N_* blocks
    to app.yaml and running databricks bundle deploy.
    """
    if not workspace_url or workspace_url == "primary":
        return get_primary_client()

    primary_host_val = primary_host()
    if primary_host_val and workspace_url.rstrip("/") == primary_host_val.rstrip("/"):
        return get_primary_client()

    target = workspace_url.strip()
    if not target.startswith("http"):
        target = f"https://{target}"

    for ws in _parse_secondary_workspaces_from_env():
        if ws["workspace_url"].rstrip("/") == target.rstrip("/"):
            if not ws["client_id"] or not ws["client_secret"]:
                raise RuntimeError(
                    f"Credentials incomplete for secondary workspace: {workspace_url}. "
                    "Check SEC_N_SP_CLIENT_ID and SEC_N_SP_CLIENT_SECRET in app.yaml."
                )
            return _build_secondary_client(target, ws["client_id"], ws["client_secret"])

    raise RuntimeError(
        f"No credentials configured for secondary workspace: {workspace_url}. "
        "Add a SEC_N_WORKSPACE_URL / SEC_N_SP_CLIENT_ID / SEC_N_SP_CLIENT_SECRET "
        "block to app.yaml and redeploy."
    )


def get_secondary_warehouse_id(workspace_url: str) -> str:
    """Return the SQL warehouse ID configured for a secondary workspace."""
    target = workspace_url.strip()
    if not target.startswith("http"):
        target = f"https://{target}"
    for ws in _parse_secondary_workspaces_from_env():
        if ws["workspace_url"].rstrip("/") == target.rstrip("/"):
            return ws["warehouse_id"]
    return ""


def primary_host() -> str:
    """Return the normalized Primary Region host (with scheme, no trailing slash).

    When running as a Databricks App the host is taken from DATABRICKS_HOST.
    Locally it falls back to an empty string (profile-based auth has no explicit host).
    """
    host = os.environ.get("DATABRICKS_HOST", "").strip()
    if host and not host.startswith("http"):
        host = f"https://{host}"
    return host.rstrip("/")


def config_fqn(table: str) -> str:
    """Fully qualified name of a config table in the Primary Region."""
    return f"{CONFIG_CATALOG}.{CONFIG_SCHEMA}.{table}"


def _display_name_from_url(url: str) -> str:
    """Derive a short display name from a workspace URL (strip scheme + trailing slash)."""
    return url.replace("https://", "").replace("http://", "").rstrip("/")


def get_all_workspace_infos() -> list[dict]:
    """Return all configured workspaces — primary first, then secondary.

    Primary workspace URL comes from DATABRICKS_HOST (auto-injected by the
    Apps platform). Display name falls back to the hostname if not configured.
    """
    ph = primary_host()
    result = [
        {
            "workspace_url": ph,
            "display_name": _display_name_from_url(ph) if ph else "Primary",
            "is_primary": True,
        }
    ]
    for ws in _parse_secondary_workspaces_from_env():
        result.append({
            "workspace_url": ws["workspace_url"],
            "display_name": ws["display_name"],
            "is_primary": False,
        })
    return result


def get_known_secondary_workspace_urls() -> list[dict]:
    """Return secondary workspaces from SEC_N_* env vars for the workspace selector."""
    return [
        {"workspace_url": ws["workspace_url"], "display_name": ws["display_name"]}
        for ws in _parse_secondary_workspaces_from_env()
    ]
