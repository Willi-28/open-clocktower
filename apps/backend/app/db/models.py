"""SQLAlchemy table models.

These classes persist rooms, players, votes, nominations, character packs,
assignments, demon bluffs, avatars, and imported reminder tokens.
"""

from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


def utc_now() -> datetime:
    """Return a timezone-aware UTC timestamp for database defaults."""
    # Shared timestamp helper for database rows.
    return datetime.now(timezone.utc)


class RoomModel(Base):
    """Persist one room and own all cascading room-local game data."""

    # Persisted game session. Deleting the room cascades to players,
    # nominations, and votes, so most game data lives only as long as the room.
    __tablename__ = "rooms"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    seat_count: Mapped[int] = mapped_column(Integer)
    phase: Mapped[str] = mapped_column(String(20), default="lobby")
    day_count: Mapped[int] = mapped_column(Integer, default=0)
    night_count: Mapped[int] = mapped_column(Integer, default=0)
    allow_public_voice_during_night: Mapped[bool] = mapped_column(Boolean, default=False)
    show_board: Mapped[bool] = mapped_column(Boolean, default=False)
    shared_grimoire_player_ids: Mapped[str] = mapped_column(Text, default="[]")
    shared_grimoire_reminders: Mapped[str] = mapped_column(Text, default="[]")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)

    players: Mapped[list["PlayerModel"]] = relationship(
        back_populates="room",
        cascade="all, delete-orphan",
        order_by="PlayerModel.created_at",
    )
    nominations: Mapped[list["NominationModel"]] = relationship(back_populates="room", cascade="all, delete-orphan")
    nomination_requests: Mapped[list["NominationRequestModel"]] = relationship(
        back_populates="room",
        cascade="all, delete-orphan",
    )
    characters: Mapped[list["CharacterModel"]] = relationship(back_populates="room", cascade="all, delete-orphan")
    reminder_tokens: Mapped[list["ReminderTokenModel"]] = relationship(back_populates="room", cascade="all, delete-orphan")
    character_assignments: Mapped[list["CharacterAssignmentModel"]] = relationship(
        back_populates="room",
        cascade="all, delete-orphan",
    )
    demon_bluffs: Mapped[list["DemonBluffModel"]] = relationship(back_populates="room", cascade="all, delete-orphan")
    votes: Mapped[list["VoteModel"]] = relationship(back_populates="room", cascade="all, delete-orphan")
    player_avatars: Mapped[list["PlayerAvatarModel"]] = relationship(back_populates="room", cascade="all, delete-orphan")


class PlayerModel(Base):
    """Persist one player or storyteller inside a room."""

    # A player belongs to exactly one room. Storytellers are technically players too,
    # but is_storyteller later gives them a different view and different permissions.
    __tablename__ = "players"
    __table_args__ = (UniqueConstraint("room_id", "seat_index", name="uq_players_room_seat"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    room_id: Mapped[str] = mapped_column(ForeignKey("rooms.id", ondelete="CASCADE"), index=True)
    display_name: Mapped[str] = mapped_column(String(80))
    seat_index: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="alive")
    has_dead_vote: Mapped[bool] = mapped_column(Boolean, default=True)
    is_connected: Mapped[bool] = mapped_column(Boolean, default=True)
    is_storyteller: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    room: Mapped[RoomModel] = relationship(back_populates="players")


class NominationModel(Base):
    """Persist one nomination between a nominator and nominee."""

    # A nomination connects nominator and nominee. For the MVP, each room has only
    # one active nomination; older nominations remain as history.
    __tablename__ = "nominations"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    room_id: Mapped[str] = mapped_column(ForeignKey("rooms.id", ondelete="CASCADE"), index=True)
    nominator_id: Mapped[str] = mapped_column(ForeignKey("players.id", ondelete="CASCADE"))
    nominee_id: Mapped[str] = mapped_column(ForeignKey("players.id", ondelete="CASCADE"))
    is_open: Mapped[bool] = mapped_column(Boolean, default=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    room: Mapped[RoomModel] = relationship(back_populates="nominations")


class NominationRequestModel(Base):
    """Persist a player nomination request waiting for storyteller action."""

    # A player-created nomination request waiting for storyteller approval.
    __tablename__ = "nomination_requests"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    room_id: Mapped[str] = mapped_column(ForeignKey("rooms.id", ondelete="CASCADE"), index=True)
    nominator_id: Mapped[str] = mapped_column(ForeignKey("players.id", ondelete="CASCADE"))
    nominee_id: Mapped[str] = mapped_column(ForeignKey("players.id", ondelete="CASCADE"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    room: Mapped[RoomModel] = relationship(back_populates="nomination_requests")


class VoteModel(Base):
    """Persist a single player's current vote for one room."""

    # One vote per player and room. New votes replace that player's previous vote.
    __tablename__ = "votes"
    __table_args__ = (UniqueConstraint("room_id", "player_id", name="uq_votes_room_player"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    room_id: Mapped[str] = mapped_column(ForeignKey("rooms.id", ondelete="CASCADE"), index=True)
    player_id: Mapped[str] = mapped_column(ForeignKey("players.id", ondelete="CASCADE"))
    value: Mapped[bool] = mapped_column(Boolean)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    room: Mapped[RoomModel] = relationship(back_populates="votes")


class PlayerAvatarModel(Base):
    """Persist one room-local profile image as a data URL."""

    # User-uploaded room-local profile image. Stored as a data URL for the MVP.
    __tablename__ = "player_avatars"

    player_id: Mapped[str] = mapped_column(ForeignKey("players.id", ondelete="CASCADE"), primary_key=True)
    room_id: Mapped[str] = mapped_column(ForeignKey("rooms.id", ondelete="CASCADE"), index=True)
    data_url: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    room: Mapped[RoomModel] = relationship(back_populates="player_avatars")


class CharacterModel(Base):
    """Persist one imported character definition for a room."""

    # Character definition imported from a room-local character pack.
    __tablename__ = "characters"
    __table_args__ = (UniqueConstraint("room_id", "external_id", name="uq_characters_room_external_id"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    room_id: Mapped[str] = mapped_column(ForeignKey("rooms.id", ondelete="CASCADE"), index=True)
    external_id: Mapped[str] = mapped_column(String(80))
    name: Mapped[str] = mapped_column(String(120))
    team: Mapped[str] = mapped_column(String(80))
    category: Mapped[str] = mapped_column(String(80))
    ability: Mapped[str] = mapped_column(Text)
    icon: Mapped[str | None] = mapped_column(Text, nullable=True)
    first_night: Mapped[int] = mapped_column(Integer, default=0)
    first_night_reminder: Mapped[str] = mapped_column(Text, default="")
    other_night: Mapped[int] = mapped_column(Integer, default=0)
    other_night_reminder: Mapped[str] = mapped_column(Text, default="")
    translations: Mapped[str] = mapped_column(Text, default="{}")
    default_language: Mapped[str] = mapped_column(String(16), default="en")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    room: Mapped[RoomModel] = relationship(back_populates="characters")


class ReminderTokenModel(Base):
    """Persist one imported reminder token definition for a room."""

    # Reminder token definition imported from a room-local pack.
    __tablename__ = "reminder_tokens"
    __table_args__ = (UniqueConstraint("room_id", "external_id", name="uq_reminder_tokens_room_external_id"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    room_id: Mapped[str] = mapped_column(ForeignKey("rooms.id", ondelete="CASCADE"), index=True)
    external_id: Mapped[str] = mapped_column(String(120))
    label: Mapped[str] = mapped_column(String(120))
    character: Mapped[str | None] = mapped_column(String(120), nullable=True)
    icon: Mapped[str | None] = mapped_column(Text, nullable=True)
    translations: Mapped[str] = mapped_column(Text, default="{}")
    default_language: Mapped[str] = mapped_column(String(16), default="en")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    room: Mapped[RoomModel] = relationship(back_populates="reminder_tokens")


class CharacterAssignmentModel(Base):
    """Persist the real storyteller-owned role assignment for a player."""

    # Storyteller-owned real character assignment for one player.
    __tablename__ = "character_assignments"
    __table_args__ = (UniqueConstraint("room_id", "player_id", name="uq_character_assignments_room_player"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    room_id: Mapped[str] = mapped_column(ForeignKey("rooms.id", ondelete="CASCADE"), index=True)
    player_id: Mapped[str] = mapped_column(ForeignKey("players.id", ondelete="CASCADE"))
    character_id: Mapped[str] = mapped_column(ForeignKey("characters.id", ondelete="CASCADE"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    room: Mapped[RoomModel] = relationship(back_populates="character_assignments")


class DemonBluffModel(Base):
    """Persist one storyteller-selected demon bluff character."""

    # Three storyteller-selected characters that can later be shown to the evil team.
    # They are not part of public room state and are never returned to normal players.
    __tablename__ = "demon_bluffs"
    __table_args__ = (UniqueConstraint("room_id", "character_id", name="uq_demon_bluffs_room_character"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    room_id: Mapped[str] = mapped_column(ForeignKey("rooms.id", ondelete="CASCADE"), index=True)
    character_id: Mapped[str] = mapped_column(ForeignKey("characters.id", ondelete="CASCADE"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    room: Mapped[RoomModel] = relationship(back_populates="demon_bluffs")
