"""SQLAlchemy engine, sessions, and schema bootstrap helpers.

This module owns the database connection pool and creates or lightly migrates
the MVP schema until a dedicated migration system is introduced.
"""

from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy import inspect
from sqlalchemy import text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import settings


# Shared base class for all SQLAlchemy table models.
class Base(DeclarativeBase):
    """Declarative base class used by every SQLAlchemy model."""

    pass


# Engine = connection pool for PostgreSQL.
# pool_pre_ping checks connections before use and avoids stale connections.
engine = create_engine(settings.database_url, pool_pre_ping=True)

# Factory for database sessions. A session is the unit of work for DB operations.
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_session() -> Iterator[Session]:
    """Yield one database session for FastAPI dependency-style use."""
    # FastAPI dependency for later endpoints that should receive an injected session.
    with SessionLocal() as session:
        yield session


def create_db_schema() -> None:
    """Create missing tables and apply small compatibility column additions."""
    # Imports the models so SQLAlchemy knows them, then creates missing tables.
    # A later production version should replace this with Alembic migrations.
    from app.db import models  # noqa: F401

    Base.metadata.create_all(bind=engine)
    _add_missing_columns()


def _add_missing_columns() -> None:
    """Add columns introduced after the initial schema when they are missing."""
    # Tiny development migration bridge until Alembic exists.
    inspector = inspect(engine)
    room_columns = {column["name"] for column in inspector.get_columns("rooms")}
    with engine.begin() as connection:
        if "day_count" not in room_columns:
            connection.execute(text("ALTER TABLE rooms ADD COLUMN day_count INTEGER NOT NULL DEFAULT 0"))
        if "night_count" not in room_columns:
            connection.execute(text("ALTER TABLE rooms ADD COLUMN night_count INTEGER NOT NULL DEFAULT 0"))
        if "allow_public_voice_during_night" not in room_columns:
            connection.execute(
                text("ALTER TABLE rooms ADD COLUMN allow_public_voice_during_night BOOLEAN NOT NULL DEFAULT FALSE")
            )
        if "show_board" not in room_columns:
            connection.execute(text("ALTER TABLE rooms ADD COLUMN show_board BOOLEAN NOT NULL DEFAULT FALSE"))
        if "shared_grimoire_player_ids" not in room_columns:
            connection.execute(text("ALTER TABLE rooms ADD COLUMN shared_grimoire_player_ids TEXT NOT NULL DEFAULT '[]'"))
        if "shared_grimoire_reminders" not in room_columns:
            connection.execute(text("ALTER TABLE rooms ADD COLUMN shared_grimoire_reminders TEXT NOT NULL DEFAULT '[]'"))

    player_columns = {column["name"] for column in inspector.get_columns("players")}
    with engine.begin() as connection:
        if "has_dead_vote" not in player_columns:
            connection.execute(text("ALTER TABLE players ADD COLUMN has_dead_vote BOOLEAN NOT NULL DEFAULT TRUE"))
        if "secret" not in player_columns:
            # Existing rows get an empty secret and can no longer authenticate, so
            # in-flight sessions must rejoin. Rooms are ephemeral, so this is a
            # one-time disruption rather than data loss.
            connection.execute(text("ALTER TABLE players ADD COLUMN secret VARCHAR(64) NOT NULL DEFAULT ''"))

    character_columns = {column["name"] for column in inspector.get_columns("characters")}
    with engine.begin() as connection:
        if "sort_order" not in character_columns:
            connection.execute(text("ALTER TABLE characters ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0"))
        if "first_night" not in character_columns:
            connection.execute(text("ALTER TABLE characters ADD COLUMN first_night INTEGER NOT NULL DEFAULT 0"))
        if "first_night_reminder" not in character_columns:
            connection.execute(text("ALTER TABLE characters ADD COLUMN first_night_reminder TEXT NOT NULL DEFAULT ''"))
        if "other_night" not in character_columns:
            connection.execute(text("ALTER TABLE characters ADD COLUMN other_night INTEGER NOT NULL DEFAULT 0"))
        if "other_night_reminder" not in character_columns:
            connection.execute(text("ALTER TABLE characters ADD COLUMN other_night_reminder TEXT NOT NULL DEFAULT ''"))
        if "translations" not in character_columns:
            connection.execute(text("ALTER TABLE characters ADD COLUMN translations TEXT NOT NULL DEFAULT '{}'"))
        if "default_language" not in character_columns:
            connection.execute(text("ALTER TABLE characters ADD COLUMN default_language VARCHAR(16) NOT NULL DEFAULT 'en'"))

    reminder_token_columns = {column["name"] for column in inspector.get_columns("reminder_tokens")}
    with engine.begin() as connection:
        if "translations" not in reminder_token_columns:
            connection.execute(text("ALTER TABLE reminder_tokens ADD COLUMN translations TEXT NOT NULL DEFAULT '{}'"))
        if "default_language" not in reminder_token_columns:
            connection.execute(text("ALTER TABLE reminder_tokens ADD COLUMN default_language VARCHAR(16) NOT NULL DEFAULT 'en'"))
