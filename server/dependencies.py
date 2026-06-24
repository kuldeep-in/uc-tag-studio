"""Shared FastAPI dependencies."""

from __future__ import annotations

import os

from fastapi import Request


def current_user_token(request: Request) -> str:
    """Extract the user's OAuth token injected by the Databricks Apps proxy.

    Databricks Apps sets X-Forwarded-Access-Token on every request so the
    backend can act on behalf of the logged-in user. Falls back to
    DATABRICKS_TOKEN env var for local development.
    """
    token = request.headers.get("X-Forwarded-Access-Token", "").strip()
    if not token:
        token = os.environ.get("DATABRICKS_TOKEN", "").strip()
    return token
