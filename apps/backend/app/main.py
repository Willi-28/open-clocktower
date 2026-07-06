"""FastAPI application entry point.

This file assembles middleware, lifecycle hooks, API routers, WebSocket routes,
and the production static frontend mount into one ASGI app.
"""

import asyncio
import logging
from contextlib import asynccontextmanager, suppress
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.httpsredirect import HTTPSRedirectMiddleware
from fastapi.staticfiles import StaticFiles
from pathlib import Path

from app.api.rooms import router as rooms_router
from app.config import settings
from app.db.session import create_db_schema
from app.game.store import room_store
from app.websocket.room_hub import room_hub
from app.websocket.rooms import router as websocket_router

logger = logging.getLogger("open_clocktower")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Prepare database state on boot and cancel background work on shutdown."""
    # Creates database tables automatically until proper migrations exist.
    create_db_schema()
    room_store.mark_all_players_disconnected()
    for room_id in room_store.delete_inactive_rooms(settings.room_idle_ttl_seconds):
        await room_hub.broadcast_deleted(room_id)
    cleanup_task = asyncio.create_task(cleanup_inactive_rooms())
    try:
        yield
    finally:
        cleanup_task.cancel()
        with suppress(asyncio.CancelledError):
            await cleanup_task


# FastAPI backend entry point. This wires together global settings,
# HTTP routes, WebSocket routes, and the built frontend files.
app = FastAPI(title="Open Clocktower", lifespan=lifespan)


def cache_control_for_path(path: str) -> str | None:
    """Choose a browser cache policy for API, HTML, and fingerprinted assets."""
    # Vite fingerprints production assets in /assets, so they are safe to cache
    # indefinitely. The HTML shell must always be fetched again so a deployment
    # immediately points browsers at the newest fingerprinted assets.
    if path.startswith("/assets/"):
        return "public, max-age=31536000, immutable"
    if path == "/api/client-config":
        return "no-store"
    if not path.startswith(("/api/", "/ws/")):
        return "no-cache, no-store, must-revalidate"
    return None


@app.middleware("http")
async def set_browser_cache_policy(request: Request, call_next):
    """Attach cache and transport-security headers to every response."""
    response = await call_next(request)
    cache_control = cache_control_for_path(request.url.path)
    if cache_control is not None:
        response.headers["Cache-Control"] = cache_control
    if settings.force_https:
        # HTTPS-only deployments should pin browsers to HTTPS (HSTS).
        response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    return response


# Production is HTTPS-only. Uvicorn is started with proxy headers enabled so
# requests forwarded by Traefik keep their original https/wss scheme here.
if settings.force_https:
    app.add_middleware(HTTPSRedirectMiddleware)

# Allows the local Vite dev server to call the backend from the browser.
# In production, the frontend is served by the same container and does not need this.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    """Return a minimal health response for containers and monitoring."""
    # Simple health check for Docker, monitoring, or quick manual tests.
    return {"status": "ok"}


@app.get("/api/client-config")
def client_config():
    """Expose safe runtime browser configuration such as WebRTC ICE servers."""
    # Runtime configuration that the browser needs after the frontend was built.
    # Do not put private server-only secrets here.
    return {"iceServers": settings.ice_servers()}


async def cleanup_inactive_rooms() -> None:
    """Periodically delete abandoned rooms and notify any stale browser clients."""
    # Deletes fully empty rooms in the background. This keeps abandoned lobbies
    # from living forever without needing a separate worker for version 0.1.
    interval = max(60, settings.room_cleanup_interval_seconds)
    while True:
        await asyncio.sleep(interval)
        # One failed sweep (for example a transient DB error) must not kill the
        # loop for the rest of the process lifetime.
        try:
            deleted_room_ids = room_store.delete_inactive_rooms(settings.room_idle_ttl_seconds)
            for room_id in deleted_room_ids:
                await room_hub.broadcast_deleted(room_id)
        except Exception:
            logger.exception("Room cleanup sweep failed; retrying next interval")


# Register the room/gameplay API and WebSockets for live updates.
app.include_router(rooms_router)
app.include_router(websocket_router)

static_dir = Path(__file__).parent / "static"
if static_dir.exists():
    # In the Docker image, this folder contains the built React frontend.
    app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")
