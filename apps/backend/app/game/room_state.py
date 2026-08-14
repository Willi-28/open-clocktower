"""Shared room-state schemas for the backend API.

These Pydantic models describe the data exchanged between REST endpoints,
WebSockets, and the frontend, while also enforcing basic validation limits.
"""

from datetime import datetime, timezone
from enum import StrEnum
from pydantic import BaseModel, Field


class GamePhase(StrEnum):
    """Manual game phases. The app does not automate specific game rules."""

    LOBBY = "lobby"
    DAY = "day"
    NIGHT = "night"


class PlayerStatus(StrEnum):
    """Publicly visible player status at the table."""

    ALIVE = "alive"
    DEAD = "dead"
    ABSENT = "absent"


class Player(BaseModel):
    """Player snapshot sent to the frontend."""

    id: str
    display_name: str
    seat_index: int | None = None
    status: PlayerStatus = PlayerStatus.ALIVE
    has_dead_vote: bool = True
    is_connected: bool = True
    is_storyteller: bool = False
    avatar_url: str | None = None


class Nomination(BaseModel):
    """Active or recently closed room nomination."""

    id: str
    nominator_id: str
    nominee_id: str
    is_open: bool = True
    created_at: str


class NominationRequestState(BaseModel):
    """Player-created nomination request waiting for the storyteller."""

    id: str
    nominator_id: str
    nominee_id: str
    created_at: str


class Vote(BaseModel):
    """Single yes/no vote from one player."""

    player_id: str
    value: bool


class Character(BaseModel):
    """Public character data loaded from a storyteller-uploaded pack."""

    id: str
    name: str
    team: str
    category: str
    ability: str
    icon: str | None = None
    first_night: int = 0
    first_night_reminder: str = ""
    other_night: int = 0
    other_night_reminder: str = ""
    translations: dict[str, dict[str, str]] = Field(default_factory=dict)
    default_language: str = "en"
    available_languages: list[str] = Field(default_factory=list)


class ReminderTokenDefinition(BaseModel):
    """Public reminder token definition loaded from a room-local pack."""

    id: str
    label: str
    character: str | None = None
    icon: str | None = None
    translations: dict[str, dict[str, str]] = Field(default_factory=dict)
    default_language: str = "en"
    available_languages: list[str] = Field(default_factory=list)


class CharacterAssignment(BaseModel):
    """Actual character assignment. Normal players should only receive their own."""

    player_id: str
    character_id: str


class SharedReminderToken(BaseModel):
    """Storyteller reminder token snapshot shared with selected players.

    Every field is bounded: this list is persisted and then re-broadcast inside
    every room snapshot, so unbounded text (or a non-finite coordinate, which
    serializes to invalid JSON) would be amplified to all connected clients.
    """

    id: str = Field(max_length=120)
    tokenId: str | None = Field(default=None, max_length=120)
    label: str = Field(max_length=200)
    # Normalized table position in percent; the range is generous on purpose so
    # dragging past the table edge still works, while rejecting inf/NaN.
    x: float = Field(ge=-1000, le=1000)
    y: float = Field(ge=-1000, le=1000)


class RoomState(BaseModel):
    """Full room snapshot that is broadcast over WebSocket after changes."""

    id: str
    name: str
    seat_count: int = Field(ge=5, le=20)
    phase: GamePhase = GamePhase.LOBBY
    day_count: int = 0
    night_count: int = 0
    allow_public_voice_during_night: bool = False
    show_board: bool = False
    shared_grimoire_player_ids: list[str] = Field(default_factory=list)
    shared_grimoire_reminders: list[SharedReminderToken] = Field(default_factory=list)
    players: list[Player] = Field(default_factory=list)
    active_nomination: Nomination | None = None
    nomination_requests: list[NominationRequestState] = Field(default_factory=list)
    votes: list[Vote] = Field(default_factory=list)
    created_at: str
    updated_at: str


class PlayerSession(BaseModel):
    """Room snapshot plus the private credentials handed to one joining player.

    player_secret is a per-player bearer token. It is returned only to the player
    it belongs to (at create/join time) and is never part of the broadcast
    RoomState, so other room members cannot learn it and act on this player's behalf.
    """

    room: RoomState
    player_id: str
    player_secret: str


class CreateRoomRequest(BaseModel):
    """Data the frontend sends when creating a room."""

    name: str = Field(default="New room", max_length=120)
    creator_name: str = Field(min_length=1, max_length=80)
    seat_count: int = Field(default=9, ge=5, le=20)


class UpdateRoomRequest(BaseModel):
    """Storyteller-owned room settings that can still change when allowed."""

    actor_player_id: str
    seat_count: int | None = Field(default=None, ge=5, le=20)
    allow_public_voice_during_night: bool | None = None
    show_board: bool | None = None
    # Bounded because both lists are stored and rebroadcast in every snapshot;
    # a room holds at most 20 seats and far fewer grimoire tokens than this.
    shared_grimoire_player_ids: list[str] | None = Field(default=None, max_length=64)
    shared_grimoire_reminders: list[SharedReminderToken] | None = Field(default=None, max_length=300)


class JoinRoomRequest(BaseModel):
    """Data a player sends when joining a room."""

    display_name: str = Field(min_length=1, max_length=80)
    seat_index: int | None = Field(default=None, ge=0)


class UpdatePlayerRequest(BaseModel):
    """Player changes such as seat, status, or dead-vote state."""

    actor_player_id: str | None = None
    seat_index: int | None = Field(default=None, ge=0)
    status: PlayerStatus | None = None
    has_dead_vote: bool | None = None


class LeaveRoomRequest(BaseModel):
    """Request body for a player leaving or being removed from a room."""

    actor_player_id: str


class SetStorytellerRequest(BaseModel):
    """Current storyteller may transfer the role before the next match starts."""

    actor_player_id: str
    player_id: str


class PhaseRequest(BaseModel):
    """Request body for changing the room phase."""

    phase: GamePhase
    actor_player_id: str | None = None


class StartNominationRequest(BaseModel):
    """Storyteller-approved nomination."""

    actor_player_id: str | None = None
    nominator_id: str
    nominee_id: str


class PlayerNominationRequest(BaseModel):
    """Player request for a nomination that the storyteller can approve."""

    nominator_id: str
    nominee_id: str


class StorytellerActionRequest(BaseModel):
    """Generic request body for storyteller-only actions without extra data."""

    actor_player_id: str | None = None


class ExecuteNomineeRequest(BaseModel):
    """Storyteller execution for the active nomination after vote validation."""

    actor_player_id: str


class VoteRequest(BaseModel):
    """Player vote for the current nomination."""

    player_id: str
    value: bool


class AssignCharacterRequest(BaseModel):
    """Storyteller assigns one real character to one player."""

    actor_player_id: str
    player_id: str
    character_id: str


class RandomAssignCharactersRequest(BaseModel):
    """Storyteller selects characters; the server shuffles them across seated players."""

    actor_player_id: str
    character_ids: list[str] = Field(min_length=1)


class DemonBluffsRequest(BaseModel):
    """Storyteller-only list of up to three demon bluff characters."""

    actor_player_id: str
    character_ids: list[str] = Field(default_factory=list, max_length=3)


def utc_now() -> str:
    """Return the current UTC time as an ISO string for API snapshots."""
    return datetime.now(timezone.utc).isoformat()
