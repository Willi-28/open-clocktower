import json
import os
from typing import Any

from pydantic import BaseModel


def _env_bool(name: str, default: bool = False) -> bool:
    return os.getenv(name, str(default)).strip().lower() in {"1", "true", "yes", "on"}


def _database_url() -> str:
    # SQLAlchemy uses psycopg2 for plain "postgresql://" URLs. The image ships
    # psycopg v3 instead, so normalize common PostgreSQL URLs to the v3 driver.
    database_url = os.getenv(
        "DATABASE_URL",
        "postgresql+psycopg://open_clocktower:open_clocktower@localhost:5432/open_clocktower",
    )
    if database_url.startswith("postgresql+psycopg2://"):
        return database_url.replace("postgresql+psycopg2://", "postgresql+psycopg://", 1)
    if database_url.startswith("postgresql://"):
        return database_url.replace("postgresql://", "postgresql+psycopg://", 1)
    if database_url.startswith("postgres://"):
        return database_url.replace("postgres://", "postgresql+psycopg://", 1)
    return database_url


# Central backend configuration.
# Values come from environment variables, for example docker-compose.yml/.env.
class Settings(BaseModel):
    app_env: str = os.getenv("APP_ENV", "development")
    data_dir: str = os.getenv("DATA_DIR", "/app/data")
    upload_dir: str = os.getenv("UPLOAD_DIR", "/app/data/uploads")
    # PostgreSQL is the default database. In Docker Compose, the DB service is named "db".
    database_url: str = _database_url()
    # WebRTC needs ICE servers. STUN works on many local networks; TURN is required
    # for reliable voice behind strict routers or across the public internet.
    ice_servers_json: str = os.getenv("ICE_SERVERS_JSON", '[{"urls":"stun:stun.l.google.com:19302"}]')
    # Production should only be used through HTTPS. Traefik redirects first; this
    # is the backend guard for accidental direct HTTP access.
    force_https: bool = _env_bool("FORCE_HTTPS", os.getenv("APP_ENV", "development") == "production")
    # Empty rooms are deleted automatically after nobody has been connected for this long.
    room_idle_ttl_seconds: int = int(os.getenv("ROOM_IDLE_TTL_SECONDS", "3600"))
    room_cleanup_interval_seconds: int = int(os.getenv("ROOM_CLEANUP_INTERVAL_SECONDS", "300"))

    def ice_servers(self) -> list[dict[str, Any]]:
        try:
            servers = json.loads(self.ice_servers_json)
        except json.JSONDecodeError:
            return [{"urls": "stun:stun.l.google.com:19302"}]
        if not isinstance(servers, list):
            return [{"urls": "stun:stun.l.google.com:19302"}]
        return [server for server in servers if isinstance(server, dict) and server.get("urls")]


settings = Settings()
