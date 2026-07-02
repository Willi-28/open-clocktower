"""Persistent room store and game mutation layer.

RoomStore is the backend's central write/read service for rooms, players,
votes, nominations, character packs, assignments, and storyteller-only checks.
"""

import json
from random import SystemRandom
from secrets import token_urlsafe
from time import monotonic

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.db.models import (
    CharacterAssignmentModel,
    CharacterModel,
    DemonBluffModel,
    NominationModel,
    NominationRequestModel,
    PlayerAvatarModel,
    PlayerModel,
    ReminderTokenModel,
    RoomModel,
    VoteModel,
)
from app.db.session import SessionLocal

from .rules import can_change_seats, claim_seat_index, has_execution_votes
from .room_state import (
    CreateRoomRequest,
    AssignCharacterRequest,
    Character,
    CharacterAssignment,
    DemonBluffsRequest,
    ExecuteNomineeRequest,
    GamePhase,
    JoinRoomRequest,
    Nomination,
    NominationRequestState,
    PhaseRequest,
    Player,
    PlayerStatus,
    PlayerNominationRequest,
    RandomAssignCharactersRequest,
    ReminderTokenDefinition,
    SetStorytellerRequest,
    SharedReminderToken,
    RoomState,
    StartNominationRequest,
    StorytellerActionRequest,
    UpdateRoomRequest,
    UpdatePlayerRequest,
    Vote,
    VoteRequest,
)


class RoomStore:
    """Coordinate validated room mutations against the database."""

    def __init__(self) -> None:
        """Create store-level helpers such as secure randomization and seat throttles."""
        self._random = SystemRandom()
        self._next_seat_change_at: dict[tuple[str, str], float] = {}

    def create_room(self, request: CreateRoomRequest) -> RoomState:
        """Create a new room with the creator as its initial storyteller."""
        with SessionLocal() as session:
            room = RoomModel(
                id=token_urlsafe(5),
                name=request.name.strip() or "New room",
                seat_count=request.seat_count,
                phase=GamePhase.LOBBY.value,
            )
            founder = PlayerModel(
                id=token_urlsafe(6),
                display_name=request.creator_name.strip() or "Storyteller",
                is_storyteller=True,
            )
            room.players.append(founder)
            session.add(room)
            session.commit()
            return self._to_state(session, room)

    def get_room(self, room_id: str) -> RoomState | None:
        """Return the current snapshot for one room if it exists."""
        with SessionLocal() as session:
            room = session.get(RoomModel, room_id)
            return self._to_state(session, room) if room else None

    def update_room(self, room_id: str, request: UpdateRoomRequest) -> RoomState | None:
        """Apply storyteller-controlled room settings and shared grimoire changes."""
        with SessionLocal() as session:
            room = session.get(RoomModel, room_id)
            if room is None:
                return None
            self._require_storyteller(session, room_id, request.actor_player_id)
            if request.seat_count is not None:
                if not self._can_change_seats(room):
                    raise ValueError("room seats can only be changed before the game or after the board is shown")
                occupied_seats = [player.seat_index for player in room.players if player.seat_index is not None]
                if occupied_seats and max(occupied_seats) >= request.seat_count:
                    raise ValueError("seat_count cannot remove occupied seats")
                room.seat_count = request.seat_count
            if request.allow_public_voice_during_night is not None:
                room.allow_public_voice_during_night = request.allow_public_voice_during_night
            if request.show_board is not None:
                room.show_board = request.show_board
                if request.show_board:
                    room.shared_grimoire_player_ids = "[]"
                    room.shared_grimoire_reminders = "[]"
            if request.shared_grimoire_player_ids is not None:
                room.shared_grimoire_player_ids = self._serialize_shared_grimoire_player_ids(
                    session,
                    room_id,
                    request.shared_grimoire_player_ids,
                )
            if request.shared_grimoire_reminders is not None:
                room.shared_grimoire_reminders = json.dumps(
                    [reminder.model_dump(mode="json") for reminder in request.shared_grimoire_reminders],
                )
            self._touch(room)
            session.commit()
            return self._to_state(session, room)

    def join_room(self, room_id: str, request: JoinRoomRequest) -> RoomState | None:
        """Add a new player, assigning a seat only when seat changes are allowed."""
        with SessionLocal() as session:
            room = session.get(RoomModel, room_id)
            if room is None:
                return None
            player = PlayerModel(
                id=token_urlsafe(6),
                display_name=request.display_name.strip() or "Player",
                seat_index=self._claim_seat(room, request.seat_index) if self._can_change_seats(room) else None,
            )
            room.players.append(player)
            self._touch(room)
            session.commit()
            return self._to_state(session, room)

    def leave_room(self, room_id: str, player_id: str, actor_player_id: str) -> RoomState | None:
        """Remove a player when they leave themselves or the storyteller removes them."""
        with SessionLocal() as session:
            room = session.get(RoomModel, room_id)
            if room is None:
                return None
            player = self._find_player(session, room_id, player_id)
            if player is None:
                return None
            if player.is_storyteller:
                raise ValueError("storyteller cannot leave the lobby")
            if actor_player_id == player_id:
                if room.phase != GamePhase.LOBBY.value:
                    raise ValueError("players can only leave while the room is in lobby")
            else:
                self._require_storyteller(session, room_id, actor_player_id)
            session.delete(player)
            self._touch(room)
            session.commit()
            return self._to_state(session, room)

    def set_storyteller(self, room_id: str, request: SetStorytellerRequest) -> RoomState | None:
        """Transfer the storyteller role before a match starts or after the board is shown."""
        with SessionLocal() as session:
            room = session.get(RoomModel, room_id)
            if room is None:
                return None
            if not self._can_change_seats(room):
                raise ValueError("storyteller can only be selected before the game or after the board is shown")
            self._require_storyteller(session, room_id, request.actor_player_id)
            selected = self._find_player(session, room_id, request.player_id)
            if selected is None:
                return None
            for player in room.players:
                player.is_storyteller = player.id == selected.id
                if player.is_storyteller:
                    player.seat_index = None
            self._touch(room)
            session.commit()
            return self._to_state(session, room)

    def update_player(self, room_id: str, player_id: str, request: UpdatePlayerRequest) -> RoomState | None:
        """Update a player's seat, status, or dead-vote flag with role checks."""
        with SessionLocal() as session:
            room = session.get(RoomModel, room_id)
            if room is None:
                return None
            player = self._find_player(session, room_id, player_id)
            if player is None:
                return None
            fields_set = getattr(request, "model_fields_set", None)
            if fields_set is None:
                fields_set = request.__fields_set__
            if "seat_index" in fields_set:
                if not self._can_change_seats(room):
                    raise ValueError("seats can only be changed before the game or after the board is shown")
                if request.actor_player_id != player_id:
                    raise ValueError("players can only change their own seat")
                if player.is_storyteller and request.seat_index is not None:
                    raise ValueError("storyteller cannot take a seat")
                self._require_seat_change_rate(room_id, player_id)
                player.seat_index = self._claim_seat(room, request.seat_index, player_id)
            if request.status is not None:
                if room.phase != GamePhase.LOBBY.value:
                    self._require_storyteller(session, room_id, request.actor_player_id)
                player.status = request.status.value
                if request.status == PlayerStatus.ALIVE:
                    player.has_dead_vote = True
            if request.has_dead_vote is not None:
                self._require_storyteller(session, room_id, request.actor_player_id)
                player.has_dead_vote = request.has_dead_vote
            self._touch(room)
            session.commit()
            return self._to_state(session, room)

    def set_phase(self, room_id: str, request: PhaseRequest) -> RoomState | None:
        """Move the room between lobby, day, and night while resetting phase data."""
        with SessionLocal() as session:
            room = session.get(RoomModel, room_id)
            if room is None:
                return None
            if request.phase != GamePhase.LOBBY:
                self._require_storyteller(session, room_id, request.actor_player_id)
                self._require_exactly_one_storyteller(room)
            if request.phase == GamePhase.DAY and room.phase != GamePhase.DAY.value:
                self._clear_day_nominations(session, room_id)
                room.day_count += 1
            if request.phase == GamePhase.NIGHT and room.phase != GamePhase.NIGHT.value:
                room.night_count += 1
            room.phase = request.phase.value
            if request.phase == GamePhase.NIGHT:
                self._clear_active_nomination(session, room_id)
                session.execute(delete(VoteModel).where(VoteModel.room_id == room_id))
                session.execute(delete(NominationRequestModel).where(NominationRequestModel.room_id == room_id))
            self._touch(room)
            session.commit()
            return self._to_state(session, room)

    def request_nomination(self, room_id: str, request: PlayerNominationRequest) -> RoomState | None:
        """Store a player nomination request for later storyteller approval."""
        with SessionLocal() as session:
            room = session.get(RoomModel, room_id)
            if room is None:
                return None
            if room.phase == GamePhase.LOBBY.value:
                raise ValueError("nominations can only be requested after the game starts")
            if not self._valid_nomination_pair(session, room, request.nominator_id, request.nominee_id):
                return None
            self._require_can_nominate_today(session, room_id, request.nominator_id, request.nominee_id)
            session.add(
                NominationRequestModel(
                    id=token_urlsafe(6),
                    room_id=room_id,
                    nominator_id=request.nominator_id,
                    nominee_id=request.nominee_id,
                )
            )
            self._touch(room)
            session.commit()
            return self._to_state(session, room)

    def start_nomination(self, room_id: str, request: StartNominationRequest) -> RoomState | None:
        """Start an active nomination after storyteller approval and rule validation."""
        with SessionLocal() as session:
            room = session.get(RoomModel, room_id)
            if room is None:
                return None
            self._require_storyteller(session, room_id, request.actor_player_id)
            if not self._valid_nomination_pair(session, room, request.nominator_id, request.nominee_id):
                return None
            self._require_can_nominate_today(session, room_id, request.nominator_id, request.nominee_id)

            self._clear_active_nomination(session, room_id)
            session.execute(delete(VoteModel).where(VoteModel.room_id == room_id))
            session.execute(
                delete(NominationRequestModel).where(
                    NominationRequestModel.room_id == room_id,
                    NominationRequestModel.nominator_id == request.nominator_id,
                    NominationRequestModel.nominee_id == request.nominee_id,
                )
            )
            session.add(
                NominationModel(
                    id=token_urlsafe(6),
                    room_id=room_id,
                    nominator_id=request.nominator_id,
                    nominee_id=request.nominee_id,
                )
            )
            self._touch(room)
            session.commit()
            return self._to_state(session, room)

    def reject_nomination_request(
        self,
        room_id: str,
        request_id: str,
        request: StorytellerActionRequest,
    ) -> RoomState | None:
        """Delete a pending nomination request after the storyteller rejects it."""
        with SessionLocal() as session:
            room = session.get(RoomModel, room_id)
            if room is None:
                return None
            self._require_storyteller(session, room_id, request.actor_player_id)
            nomination_request = session.get(NominationRequestModel, request_id)
            if nomination_request is None or nomination_request.room_id != room_id:
                return None
            session.delete(nomination_request)
            self._touch(room)
            session.commit()
            return self._to_state(session, room)

    def cast_vote(self, room_id: str, request: VoteRequest) -> RoomState | None:
        """Record a player's vote for the active nomination."""
        with SessionLocal() as session:
            room = session.get(RoomModel, room_id)
            nomination = self._active_nomination(session, room_id)
            if room is None or nomination is None:
                return None
            if not nomination.is_open:
                raise ValueError("vote is closed")
            player = self._find_player(session, room_id, request.player_id)
            if player is None:
                return None
            if player.is_storyteller:
                raise ValueError("storyteller cannot vote")
            if player.seat_index is None:
                raise ValueError("spectators cannot vote")
            if player.status == PlayerStatus.DEAD.value and request.value:
                if not player.has_dead_vote:
                    raise ValueError("dead player has no vote remaining")
                player.has_dead_vote = False

            session.execute(
                delete(VoteModel).where(VoteModel.room_id == room_id, VoteModel.player_id == request.player_id)
            )
            session.add(VoteModel(room_id=room_id, player_id=request.player_id, value=request.value))
            self._touch(room)
            session.commit()
            return self._to_state(session, room)

    def close_vote(self, room_id: str, request: StorytellerActionRequest) -> RoomState | None:
        """Close the active vote without executing the nominee."""
        with SessionLocal() as session:
            room = session.get(RoomModel, room_id)
            if room is None:
                return None
            self._require_storyteller(session, room_id, request.actor_player_id)
            nomination = self._active_nomination(session, room_id)
            if nomination is not None:
                nomination.is_open = False
                nomination.is_active = False
                session.execute(delete(VoteModel).where(VoteModel.room_id == room_id))
            self._touch(room)
            session.commit()
            return self._to_state(session, room)

    def execute_nominee(self, room_id: str, request: ExecuteNomineeRequest) -> RoomState | None:
        """Mark the nominated player dead after confirming the vote threshold."""
        with SessionLocal() as session:
            room = session.get(RoomModel, room_id)
            nomination = self._active_nomination(session, room_id)
            if room is None or nomination is None:
                return None
            self._require_storyteller(session, room_id, request.actor_player_id)
            nominee = self._find_player(session, room_id, nomination.nominee_id)
            if nominee is None:
                return None
            if not self._has_execution_votes(session, room_id):
                raise ValueError("execution requires at least half of living players to vote")
            nominee.status = PlayerStatus.DEAD.value
            nomination.is_open = False
            nomination.is_active = False
            session.execute(delete(VoteModel).where(VoteModel.room_id == room_id))
            self._touch(room)
            session.commit()
            return self._to_state(session, room)

    def reset_game(self, room_id: str, request: StorytellerActionRequest) -> RoomState | None:
        """Reset match-only state so the same room can be prepared again."""
        with SessionLocal() as session:
            room = session.get(RoomModel, room_id)
            if room is None:
                return None
            self._require_storyteller(session, room_id, request.actor_player_id)
            room.phase = GamePhase.LOBBY.value
            room.day_count = 0
            room.night_count = 0
            room.show_board = False
            room.shared_grimoire_player_ids = "[]"
            room.shared_grimoire_reminders = "[]"
            self._clear_active_nomination(session, room_id)
            session.execute(delete(VoteModel).where(VoteModel.room_id == room_id))
            session.execute(delete(NominationRequestModel).where(NominationRequestModel.room_id == room_id))
            session.execute(delete(CharacterAssignmentModel).where(CharacterAssignmentModel.room_id == room_id))
            session.execute(delete(DemonBluffModel).where(DemonBluffModel.room_id == room_id))
            for player in room.players:
                player.status = PlayerStatus.ALIVE.value
                player.has_dead_vote = True
            self._touch(room)
            session.commit()
            return self._to_state(session, room)

    def delete_room(self, room_id: str, actor_player_id: str | None) -> bool:
        """Delete a room after storyteller authorization."""
        with SessionLocal() as session:
            room = session.get(RoomModel, room_id)
            if room is None:
                return False
            self._require_storyteller(session, room_id, actor_player_id)
            session.delete(room)
            session.commit()
            return True

    def delete_inactive_rooms(self, idle_seconds: int) -> list[str]:
        """Delete rooms whose players disconnected and whose idle window expired."""
        # A room becomes disposable only after every player disconnected and the
        # room has stayed untouched for the configured idle window.
        from datetime import timedelta

        from app.db.models import utc_now

        cutoff = utc_now() - timedelta(seconds=max(60, idle_seconds))
        with SessionLocal() as session:
            rooms = session.scalars(
                select(RoomModel).where(
                    RoomModel.updated_at < cutoff,
                    ~RoomModel.players.any(PlayerModel.is_connected.is_(True)),
                )
            ).all()
            room_ids = [room.id for room in rooms]
            for room in rooms:
                session.delete(room)
            session.commit()
            return room_ids

    def mark_all_players_disconnected(self) -> None:
        """Clear stale connection flags after backend startup."""
        # After a backend restart there are no live WebSockets, even if the DB
        # still contains old is_connected=true flags from the previous process.
        with SessionLocal() as session:
            for player in session.scalars(select(PlayerModel).where(PlayerModel.is_connected.is_(True))).all():
                player.is_connected = False
            session.commit()

    def replace_pack(
        self,
        room_id: str,
        actor_player_id: str,
        characters: list[Character],
        reminder_tokens: list[ReminderTokenDefinition],
    ) -> RoomState | None:
        """Replace a room's imported characters and reminder tokens."""
        with SessionLocal() as session:
            room = session.get(RoomModel, room_id)
            if room is None:
                return None
            self._require_storyteller(session, room_id, actor_player_id)
            if room.phase != GamePhase.LOBBY.value:
                raise ValueError("character packs can only be uploaded in lobby")
            if not characters:
                raise ValueError("character pack must contain at least one character")
            session.execute(delete(CharacterAssignmentModel).where(CharacterAssignmentModel.room_id == room_id))
            session.execute(delete(DemonBluffModel).where(DemonBluffModel.room_id == room_id))
            session.execute(delete(CharacterModel).where(CharacterModel.room_id == room_id))
            session.execute(delete(ReminderTokenModel).where(ReminderTokenModel.room_id == room_id))
            for character in characters:
                session.add(
                    CharacterModel(
                        id=token_urlsafe(8),
                        room_id=room_id,
                        external_id=character.id,
                        name=character.name,
                        team=character.team,
                        category=character.category,
                        ability=character.ability,
                        icon=character.icon,
                        first_night=character.first_night,
                        first_night_reminder=character.first_night_reminder,
                        other_night=character.other_night,
                        other_night_reminder=character.other_night_reminder,
                        translations=json.dumps(character.translations),
                        default_language=character.default_language,
                    )
                )
            for token in reminder_tokens:
                session.add(
                    ReminderTokenModel(
                        id=token_urlsafe(8),
                        room_id=room_id,
                        external_id=token.id,
                        label=token.label,
                        character=token.character,
                        icon=token.icon,
                        translations=json.dumps(token.translations),
                        default_language=token.default_language,
                    )
                )
            self._touch(room)
            session.commit()
            return self._to_state(session, room)

    def list_characters(self, room_id: str, language: str | None = None) -> list[Character] | None:
        """List room characters, optionally applying one translated language."""
        with SessionLocal() as session:
            if session.get(RoomModel, room_id) is None:
                return None
            rows = session.scalars(
                select(CharacterModel)
                .where(CharacterModel.room_id == room_id)
                .order_by(CharacterModel.category.asc(), CharacterModel.name.asc())
            ).all()
            return [self._to_character(row, language) for row in rows]

    def list_reminder_tokens(self, room_id: str, language: str | None = None) -> list[ReminderTokenDefinition] | None:
        """List room reminder tokens, optionally applying one translated language."""
        with SessionLocal() as session:
            if session.get(RoomModel, room_id) is None:
                return None
            rows = session.scalars(
                select(ReminderTokenModel)
                .where(ReminderTokenModel.room_id == room_id)
                .order_by(ReminderTokenModel.character.asc(), ReminderTokenModel.label.asc())
            ).all()
            return [self._to_reminder_token(row, language) for row in rows]

    def assign_character(self, room_id: str, request: AssignCharacterRequest) -> list[CharacterAssignment] | None:
        """Assign one imported character to one player."""
        with SessionLocal() as session:
            room = session.get(RoomModel, room_id)
            if room is None:
                return None
            self._require_storyteller(session, room_id, request.actor_player_id)
            player = self._find_player(session, room_id, request.player_id)
            if player is None:
                return None
            if player.is_storyteller:
                raise ValueError("storyteller cannot receive a character assignment")
            character = session.get(CharacterModel, request.character_id)
            if character is None or character.room_id != room_id:
                return None
            session.execute(
                delete(CharacterAssignmentModel).where(
                    CharacterAssignmentModel.room_id == room_id,
                    CharacterAssignmentModel.player_id == request.player_id,
                )
            )
            session.add(
                CharacterAssignmentModel(
                    room_id=room_id,
                    player_id=request.player_id,
                    character_id=request.character_id,
                )
            )
            self._touch(room)
            session.commit()
            return self.list_assignments(room_id, request.actor_player_id)

    def assign_random_characters(
        self,
        room_id: str,
        request: RandomAssignCharactersRequest,
    ) -> list[CharacterAssignment] | None:
        """Shuffle selected characters across all currently seated players."""
        with SessionLocal() as session:
            room = session.get(RoomModel, room_id)
            if room is None:
                return None
            self._require_storyteller(session, room_id, request.actor_player_id)
            players = [
                player
                for player in room.players
                if not player.is_storyteller and player.seat_index is not None
            ]
            if not players:
                raise ValueError("at least one seated player is required")
            if len(request.character_ids) != len(players):
                raise ValueError("select exactly one character for each seated player")
            if len(set(request.character_ids)) != len(request.character_ids):
                raise ValueError("selected characters must be unique")

            characters = session.scalars(
                select(CharacterModel).where(
                    CharacterModel.room_id == room_id,
                    CharacterModel.id.in_(request.character_ids),
                )
            ).all()
            if len(characters) != len(request.character_ids):
                return None

            ordered_players = sorted(players, key=lambda player: player.seat_index or 0)
            shuffled_characters = list(characters)
            self._random.shuffle(shuffled_characters)

            session.execute(delete(CharacterAssignmentModel).where(CharacterAssignmentModel.room_id == room_id))
            for player, character in zip(ordered_players, shuffled_characters):
                session.add(
                    CharacterAssignmentModel(
                        room_id=room_id,
                        player_id=player.id,
                        character_id=character.id,
                    )
                )
            self._touch(room)
            session.commit()
            return self.list_assignments(room_id, request.actor_player_id)

    def set_demon_bluffs(self, room_id: str, request: DemonBluffsRequest) -> list[str] | None:
        """Replace the storyteller-only demon bluff character list."""
        with SessionLocal() as session:
            room = session.get(RoomModel, room_id)
            if room is None:
                return None
            self._require_storyteller(session, room_id, request.actor_player_id)
            character_ids = list(dict.fromkeys(request.character_ids))
            if len(character_ids) != len(request.character_ids):
                raise ValueError("bluff characters must be unique")
            characters = session.scalars(
                select(CharacterModel).where(CharacterModel.room_id == room_id, CharacterModel.id.in_(character_ids))
            ).all()
            if len(characters) != len(character_ids):
                return None

            session.execute(delete(DemonBluffModel).where(DemonBluffModel.room_id == room_id))
            for character_id in character_ids:
                session.add(DemonBluffModel(room_id=room_id, character_id=character_id))
            self._touch(room)
            session.commit()
            return self.list_demon_bluffs(room_id, request.actor_player_id)

    def set_player_connection(self, room_id: str, player_id: str, is_connected: bool) -> RoomState | None:
        """Persist a player's WebSocket connection status."""
        with SessionLocal() as session:
            room = session.get(RoomModel, room_id)
            if room is None:
                return None
            player = self._find_player(session, room_id, player_id)
            if player is None:
                return None
            player.is_connected = is_connected
            self._touch(room)
            session.commit()
            return self._to_state(session, room)

    def set_player_avatar(self, room_id: str, player_id: str, actor_player_id: str, data_url: str) -> RoomState | None:
        """Replace a player's stored avatar image after ownership validation."""
        with SessionLocal() as session:
            room = session.get(RoomModel, room_id)
            if room is None:
                return None
            player = self._find_player(session, room_id, player_id)
            if player is None:
                return None
            if actor_player_id != player_id:
                raise ValueError("players can only change their own profile image")
            session.execute(delete(PlayerAvatarModel).where(PlayerAvatarModel.player_id == player_id))
            session.add(PlayerAvatarModel(room_id=room_id, player_id=player_id, data_url=data_url))
            self._touch(room)
            session.commit()
            return self._to_state(session, room)

    def list_assignments(self, room_id: str, viewer_player_id: str) -> list[CharacterAssignment] | None:
        """Return character assignments visible to the requesting viewer."""
        with SessionLocal() as session:
            room = session.get(RoomModel, room_id)
            if room is None:
                return None
            viewer = self._find_player(session, room_id, viewer_player_id)
            if viewer is None:
                return None
            query = select(CharacterAssignmentModel).where(CharacterAssignmentModel.room_id == room_id)
            shared_grimoire_player_ids = set(self._parse_shared_grimoire_player_ids(room))
            if not viewer.is_storyteller and not room.show_board and viewer_player_id not in shared_grimoire_player_ids:
                query = query.where(CharacterAssignmentModel.player_id == viewer_player_id)
            rows = session.scalars(query).all()
            return [
                CharacterAssignment(player_id=row.player_id, character_id=row.character_id)
                for row in rows
            ]

    def list_demon_bluffs(self, room_id: str, viewer_player_id: str) -> list[str] | None:
        """Return demon bluffs after verifying the viewer is storyteller."""
        with SessionLocal() as session:
            room = session.get(RoomModel, room_id)
            if room is None:
                return None
            self._require_storyteller(session, room_id, viewer_player_id)
            rows = session.scalars(
                select(DemonBluffModel)
                .where(DemonBluffModel.room_id == room_id)
                .order_by(DemonBluffModel.created_at.asc())
            ).all()
            return [row.character_id for row in rows]

    def _to_state(self, session: Session, room: RoomModel) -> RoomState:
        """Convert database models into the API-facing room snapshot."""
        session.expire(room, ["players", "nominations", "nomination_requests", "votes"])
        active_nomination = self._active_nomination(session, room.id)
        nomination_requests = session.scalars(
            select(NominationRequestModel)
            .where(NominationRequestModel.room_id == room.id)
            .order_by(NominationRequestModel.created_at.asc())
        ).all()
        votes = session.scalars(select(VoteModel).where(VoteModel.room_id == room.id)).all()
        avatars = {
            avatar.player_id: avatar.data_url
            for avatar in session.scalars(select(PlayerAvatarModel).where(PlayerAvatarModel.room_id == room.id)).all()
        }
        return RoomState(
            id=room.id,
            name=room.name,
            seat_count=room.seat_count,
            phase=GamePhase(room.phase),
            day_count=room.day_count,
            night_count=room.night_count,
            allow_public_voice_during_night=room.allow_public_voice_during_night,
            show_board=room.show_board,
            shared_grimoire_player_ids=self._parse_shared_grimoire_player_ids(room),
            shared_grimoire_reminders=self._parse_shared_grimoire_reminders(room),
            players=[
                Player(
                    id=player.id,
                    display_name=player.display_name,
                    seat_index=player.seat_index,
                    status=PlayerStatus(player.status),
                    has_dead_vote=player.has_dead_vote,
                    is_connected=player.is_connected,
                    is_storyteller=player.is_storyteller,
                    avatar_url=avatars.get(player.id),
                )
                for player in room.players
            ],
            active_nomination=(
                Nomination(
                    id=active_nomination.id,
                    nominator_id=active_nomination.nominator_id,
                    nominee_id=active_nomination.nominee_id,
                    is_open=active_nomination.is_open,
                    created_at=active_nomination.created_at.isoformat(),
                )
                if active_nomination
                else None
            ),
            nomination_requests=[
                NominationRequestState(
                    id=request.id,
                    nominator_id=request.nominator_id,
                    nominee_id=request.nominee_id,
                    created_at=request.created_at.isoformat(),
                )
                for request in nomination_requests
            ],
            votes=[Vote(player_id=vote.player_id, value=vote.value) for vote in votes],
            created_at=room.created_at.isoformat(),
            updated_at=room.updated_at.isoformat(),
        )

    def _to_character(self, row: CharacterModel, language: str | None = None) -> Character:
        """Convert one character row into the translated API model."""
        translations = self._parse_translations(row.translations)
        selected = translations.get(language or "", {})
        return Character(
            id=row.id,
            name=selected.get("name", row.name),
            team=selected.get("team", row.team),
            category=selected.get("category", row.category),
            ability=selected.get("ability", row.ability),
            icon=row.icon,
            first_night=row.first_night,
            first_night_reminder=selected.get("first_night_reminder", row.first_night_reminder),
            other_night=row.other_night,
            other_night_reminder=selected.get("other_night_reminder", row.other_night_reminder),
            translations=translations,
            default_language=row.default_language,
            available_languages=sorted(translations),
        )

    def _to_reminder_token(self, row: ReminderTokenModel, language: str | None = None) -> ReminderTokenDefinition:
        """Convert one reminder token row into the translated API model."""
        translations = self._parse_translations(row.translations)
        selected = translations.get(language or "", {})
        return ReminderTokenDefinition(
            id=row.id,
            label=selected.get("label", row.label),
            character=selected.get("character", row.character or "") or None,
            icon=row.icon,
            translations=translations,
            default_language=row.default_language,
            available_languages=sorted(translations),
        )

    def _parse_translations(self, serialized: str | None) -> dict[str, dict[str, str]]:
        """Safely parse serialized translation maps from the database."""
        try:
            parsed = json.loads(serialized or "{}")
        except json.JSONDecodeError:
            return {}
        if not isinstance(parsed, dict):
            return {}
        translations: dict[str, dict[str, str]] = {}
        for language, translation in parsed.items():
            if isinstance(language, str) and isinstance(translation, dict):
                translations[language] = {
                    str(key): str(value)
                    for key, value in translation.items()
                    if isinstance(key, str) and isinstance(value, str)
                }
        return translations

    def _touch(self, room: RoomModel) -> None:
        """Update a room timestamp so cleanup and clients see recent activity."""
        from app.db.models import utc_now

        room.updated_at = utc_now()

    def _parse_shared_grimoire_player_ids(self, room: RoomModel) -> list[str]:
        """Read the shared-grimoire player id list from persisted JSON."""
        try:
            parsed = json.loads(room.shared_grimoire_player_ids or "[]")
        except json.JSONDecodeError:
            return []
        return [player_id for player_id in parsed if isinstance(player_id, str)]

    def _parse_shared_grimoire_reminders(self, room: RoomModel) -> list[SharedReminderToken]:
        """Read shared storyteller reminder tokens from persisted JSON."""
        try:
            parsed = json.loads(room.shared_grimoire_reminders or "[]")
        except json.JSONDecodeError:
            return []
        reminders: list[SharedReminderToken] = []
        for reminder in parsed:
            if not isinstance(reminder, dict):
                continue
            try:
                reminders.append(SharedReminderToken.model_validate(reminder))
            except ValueError:
                continue
        return reminders

    def _serialize_shared_grimoire_player_ids(
        self,
        session: Session,
        room_id: str,
        player_ids: list[str],
    ) -> str:
        """Serialize only valid non-storyteller player ids for grimoire sharing."""
        valid_player_ids = {
            player.id
            for player in session.scalars(
                select(PlayerModel).where(
                    PlayerModel.room_id == room_id,
                    PlayerModel.is_storyteller.is_(False),
                )
            ).all()
        }
        unique_player_ids = [
            player_id
            for player_id in dict.fromkeys(player_ids)
            if player_id in valid_player_ids
        ]
        return json.dumps(unique_player_ids)

    def _find_player(self, session: Session, room_id: str, player_id: str) -> PlayerModel | None:
        """Return a player only if they belong to the requested room."""
        return session.get(PlayerModel, player_id) if self._player_in_room(session, room_id, player_id) else None

    def _player_in_room(self, session: Session, room_id: str, player_id: str) -> bool:
        """Check whether a player id belongs to a room."""
        return (
            session.scalar(select(PlayerModel.id).where(PlayerModel.room_id == room_id, PlayerModel.id == player_id))
            is not None
        )

    def _claim_seat(self, room: RoomModel, seat_index: int | None, current_player_id: str | None = None) -> int | None:
        """Validate and reserve a seat index while ignoring the current player."""
        occupied = {
            player.seat_index
            for player in room.players
            if player.seat_index is not None and player.id != current_player_id
        }
        return claim_seat_index(seat_index, room.seat_count, occupied)

    def _can_change_seats(self, room: RoomModel) -> bool:
        """Return whether the room currently allows seat changes."""
        return can_change_seats(room.phase, room.show_board)

    def _require_seat_change_rate(self, room_id: str, player_id: str) -> None:
        """Throttle rapid seat changes from the same player."""
        key = (room_id, player_id)
        now = monotonic()
        if now < self._next_seat_change_at.get(key, 0):
            raise ValueError("seat changes are too frequent")
        self._next_seat_change_at[key] = now + 0.35

    def _require_exactly_one_storyteller(self, room: RoomModel) -> None:
        """Ensure a room has exactly one storyteller before game play starts."""
        if sum(1 for player in room.players if player.is_storyteller) != 1:
            raise ValueError("select exactly one storyteller before starting the game")

    def _require_storyteller(self, session: Session, room_id: str, player_id: str | None) -> PlayerModel:
        """Return the actor when they are the room storyteller, otherwise raise."""
        if player_id is None:
            raise ValueError("storyteller action requires actor_player_id")
        player = self._find_player(session, room_id, player_id)
        if player is None or not player.is_storyteller:
            raise ValueError("only the storyteller can perform this action")
        return player

    def _active_nomination(self, session: Session, room_id: str) -> NominationModel | None:
        """Return the newest active nomination for a room."""
        return session.scalar(
            select(NominationModel)
            .where(NominationModel.room_id == room_id, NominationModel.is_active.is_(True))
            .order_by(NominationModel.created_at.desc())
        )

    def _clear_active_nomination(self, session: Session, room_id: str) -> None:
        """Mark all active nominations in a room as inactive."""
        nominations = session.scalars(
            select(NominationModel).where(NominationModel.room_id == room_id, NominationModel.is_active.is_(True))
        )
        for nomination in nominations:
            nomination.is_active = False

    def _clear_day_nominations(self, session: Session, room_id: str) -> None:
        """Delete day-specific votes, requests, and nominations."""
        session.execute(delete(VoteModel).where(VoteModel.room_id == room_id))
        session.execute(delete(NominationRequestModel).where(NominationRequestModel.room_id == room_id))
        session.execute(delete(NominationModel).where(NominationModel.room_id == room_id))

    def _valid_nomination_pair(self, session: Session, room: RoomModel, nominator_id: str, nominee_id: str) -> bool:
        """Validate whether two players may form a nomination pair."""
        nominator = self._find_player(session, room.id, nominator_id)
        nominee = self._find_player(session, room.id, nominee_id)
        if nominator is None or nominee is None:
            return False
        if nominator.is_storyteller or nominee.is_storyteller:
            raise ValueError("storyteller cannot be part of a nomination")
        if nominator.seat_index is None or nominee.seat_index is None:
            raise ValueError("spectators cannot be part of a nomination")
        if nominator.status != PlayerStatus.ALIVE.value:
            raise ValueError("dead players cannot nominate")
        if nominee.status != PlayerStatus.ALIVE.value:
            raise ValueError("dead players cannot be nominated")
        if room.phase != GamePhase.DAY.value:
            raise ValueError("nominations can only happen during day")
        return True

    def _require_can_nominate_today(
        self,
        session: Session,
        room_id: str,
        nominator_id: str,
        nominee_id: str,
    ) -> None:
        """Ensure neither nominator nor nominee has already used today's nomination."""
        already_nominated = session.scalar(
            select(NominationModel.id).where(
                NominationModel.room_id == room_id,
                NominationModel.nominator_id == nominator_id,
            )
        )
        if already_nominated is not None:
            raise ValueError("player has already nominated today")
        already_was_nominated = session.scalar(
            select(NominationModel.id).where(
                NominationModel.room_id == room_id,
                NominationModel.nominee_id == nominee_id,
            )
        )
        if already_was_nominated is not None:
            raise ValueError("player has already been nominated today")

    def _has_execution_votes(self, session: Session, room_id: str) -> bool:
        """Check whether the active vote has enough yes votes to execute."""
        living_count = session.scalar(
            select(func.count(PlayerModel.id)).where(
                PlayerModel.room_id == room_id,
                PlayerModel.is_storyteller.is_(False),
                PlayerModel.status == PlayerStatus.ALIVE.value,
            )
        )
        yes_count = session.scalar(
            select(func.count(VoteModel.id)).where(VoteModel.room_id == room_id, VoteModel.value.is_(True))
        )
        return has_execution_votes(living_count or 0, yes_count or 0)


room_store = RoomStore()
