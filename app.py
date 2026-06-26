"""FastAPI entry point for the Unity Catalog Metadata Manager.

Serves the React SPA built into ``frontend/dist`` and mounts the API routers.
"""

from __future__ import annotations

import logging
import sys
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.exception_handlers import http_exception_handler as _http_exc_handler
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

logging.basicConfig(
    stream=sys.stdout,
    level=logging.INFO,
    format="%(levelname)s %(name)s: %(message)s",
)

from server.routers import (
    catalogs,
    config,
    overview,
    tables,
    tags,
)

app = FastAPI(title="Unity Catalog Metadata Manager")
_log = logging.getLogger("app")


@app.exception_handler(HTTPException)
async def logged_http_exception_handler(request: Request, exc: HTTPException):
    if exc.status_code >= 500:
        _log.error("API %d on %s: %s", exc.status_code, request.url.path, exc.detail)
    return await _http_exc_handler(request, exc)


# API routers
app.include_router(catalogs.router)
app.include_router(tables.router)
app.include_router(tags.router)
app.include_router(config.router)
app.include_router(overview.router)


@app.get("/api/health")
def health():
    return {"status": "healthy"}


# --------------------------------------------------------------------------- #
# Serve the React SPA
# --------------------------------------------------------------------------- #
FRONTEND_DIST = Path(__file__).parent / "frontend" / "dist"

if FRONTEND_DIST.exists():
    assets_dir = FRONTEND_DIST / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    @app.get("/{full_path:path}")
    def serve_spa(full_path: str):
        # API routes are handled above; anything else falls back to index.html.
        if full_path.startswith("api/"):
            return JSONResponse({"error": "Not found"}, status_code=404)
        candidate = FRONTEND_DIST / full_path
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(FRONTEND_DIST / "index.html")

else:

    @app.get("/")
    def no_frontend():
        return {
            "message": "Frontend not built. Run `npm run build` in frontend/.",
        }
