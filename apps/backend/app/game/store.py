"""Persistent room store and game mutation layer.

RoomStore is the backend's central write/read service for rooms, players,
votes, nominations, character packs, assignments, and storyteller-only checks.
"""

import json
from random import SystemRandom
from secrets import compare_digest, token_urlsafe
from threading import Lock
from time import monotonic

from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError
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
    PlayerSession,
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
        self._seat_change_locks: dict[str, Lock] = {}

    def create_room(self, request: CreateRoomRequest) -> PlayerSession:
        """Create a new room with the creator as its initial storyteller."""
        with SessionLocal() as session:
            secret = token_urlsafe(16)
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
                secret=secret,
            )
            room.players.append(founder)
            session.add(room)
            session.commit()
            return PlayerSession(
                room=self._to_state(session, room),
                player_id=founder.id,
                player_secret=secret,
            )

    def get_room(self, room_id: str) -> RoomState | None:
        """Return the current snapshot for one room if it exists."""
        with SessionLocal() as session:
            room = session.get(RoomModel, room_id)
            return self._to_state(session, room) if room else None

    def update_room(self, room_id: str, request: UpdateRoomRequest, secret: str | None) -> RoomState | None:
        """Apply storyteller-controlled room settings and shared grimoire changes."""
        with SessionLocal() as session:
            room = session.get(RoomModel, room_id)
            if room is None:
                return None
            self._require_storyteller(session, room_id, request.actor_player_id, secret)
            if request.seat_count is not None:
                # The storyteller may resize the table even mid-game so
                # travelers can join a running round.
                seated_players = [player for player in room.players if player.seat_index is not None]
                if len(seated_players) > request.seat_count:
                    raise ValueError("No free seats available.")
                self._compact_seats(session, seated_players, room.seat_count, request.seat_count)
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

    def join_room(self, room_id: str, request: JoinRoomRequest) -> PlayerSession | None:
        """Add a new player, assigning a seat only when seat changes are allowed."""
        with SessionLocal() as session:
            room = session.get(RoomModel, room_id)
            if room is None:
                return None
            secret = token_urlsafe(16)
            player = PlayerModel(
                id=token_urlsafe(6),
                display_name=request.display_name.strip() or "Player",
                seat_index=self._claim_seat(room, request.seat_index) if self._can_change_seats(room) else None,
                secret=secret,
            )
            room.players.append(player)
            self._touch(room)
            session.commit()
            return PlayerSession(
                room=self._to_state(session, room),
                player_id=player.id,
                player_secret=secret,
            )

    def leave_room(self, room_id: str, player_id: str, actor_player_id: str, secret: str | None) -> RoomState | None:
        """Remove a player when they leave themselves or the storyteller removes them."""
        with SessionLocal() as session:
            room = session.get(RoomModel, room_id)
            if room is None:
                return None
            player = self._find_player(session, room_id, player_id)
            if player is None:
                return None
            actor = self._authenticate(session, room_id, actor_player_id, secret)
            if player.is_storyteller:
                raise ValueError("storyteller cannot leave the room")
            if actor_player_id != player_id and not actor.is_storyteller:
                raise ValueError("only the storyteller can perform this action")
            session.delete(player)
            self._touch(room)
            session.commit()
            return self._to_state(session, room)

    def set_storyteller(self, room_id: str, request: SetStorytellerRequest, secret: str | None) -> RoomState | None:
        """Transfer the storyteller role before a match starts or after the board is shown."""
        with SessionLocal() as session:
            room = session.get(RoomModel, room_id)
            if room is None:
                return None
            if not self._can_change_seats(room):
                raise ValueError("storyteller can only be selected before the game or after the board is shown")
            self._require_storyteller(session, room_id, request.actor_player_id, secret)
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

    def update_player(
        self,
        room_id: str,
        player_id: str,
        request: UpdatePlayerRequest,
        secret: str | None,
    ) -> RoomState | None:
        """Update a player's seat, status, or dead-vote flag with role checks."""
        fields_set = self._request_fields_set(request)
        if "seat_index" in fields_set and request.actor_player_id == player_id:
            self._require_seat_change_rate(room_id, player_id)
        if "seat_index" in fields_set:
            with self._seat_change_lock(room_id):
                return self._update_player(room_id, player_id, request, fields_set, secret)
        return self._update_player(room_id, player_id, request, fields_set, secret)

    def _update_player(
        self,
        room_id: str,
        player_id: str,
        request: UpdatePlayerRequest,
        fields_set: set[str],
        secret: str | None,
    ) -> RoomState | None:
        """Apply a player update inside one database transaction."""
        with SessionLocal() as session:
            room = session.get(RoomModel, room_id)
            if room is None:
                return None
            player = self._find_player(session, room_id, player_id)
            if player is None:
                return None
            # The actor must always prove their identity; per-field role checks
            # below then decide whether they may change this particular player.
            self._authenticate(session, room_id, request.actor_player_id, secret)
            if "seat_index" in fields_set:
                if not self._can_change_seats(room):
                    # Mid-game, travelers may still sit down on a free seat or
                    # stand up; seated players cannot swap seats mid-round.
                    is_sitting_down = player.seat_index is None and request.seat_index is not None
                    is_standing_up = request.seat_index is None
                    if not is_sitting_down and not is_standing_up:
                        raise ValueError("seats can only be swapped before the game or after the board is shown")
                if request.actor_player_id != player_id:
                    raise ValueError("players can only change their own seat")
                if player.is_storyteller and request.seat_index is not None:
                    raise ValueError("storyteller cannot take a seat")
                player.seat_index = self._claim_seat(room, request.seat_index, player_id)
            if request.status is not None:
                # Outside the lobby only the storyteller may set status. In the
                # lobby a player may still set their own, but not anyone else's.
                if room.phase != GamePhase.LOBBY.value or request.actor_player_id != player_id:
                    self._require_storyteller(session, room_id, request.actor_player_id, secret)
                player.status = request.status.value
                if request.status == PlayerStatus.ALIVE:
                    player.has_dead_vote = True
            if request.has_dead_vote is not None:
                self._require_storyteller(session, room_id, request.actor_player_id, secret)
                player.has_dead_vote = request.has_dead_vote
            self._touch(room)
            try:
                session.commit()
            except IntegrityError as error:
                session.rollback()
                if "seat_index" in fields_set:
                    raise ValueError("seat is no longer available") from error
                raise
            return self._to_state(session, room)

    def set_phase(self, room_id: str, request: PhaseRequest, secret: str | None) -> RoomState | None:
        """Move the room between lobby, day, and night while resetting phase data."""
        with SessionLocal() as session:
            room = session.get(RoomModel, room_id)
            if room is None:
                return None
            self._require_storyteller(session, room_id, request.actor_player_id, secret)
            if request.phase != GamePhase.LOBBY:
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

    def request_nomination(self, room_id: str, request: PlayerNominationRequest, secret: str | None) -> RoomState | None:
        """Store a player nomination request for later storyteller approval."""
        with SessionLocal() as session:
            room = session.get(RoomModel, room_id)
            if room is None:
                return None
            self._authenticate(session, room_id, request.nominator_id, secret)
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

    def start_nomination(self, room_id: str, request: StartNominationRequest, secret: str | None) -> RoomState | None:
        """Start an active nomination after storyteller approval and rule validation."""
        with SessionLocal() as session:
            room = session.get(RoomModel, room_id)
            if room is None:
                return None
            self._require_storyteller(session, room_id, request.actor_player_id, secret)
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
        secret: str | None,
    ) -> RoomState | None:
        """Delete a pending nomination request after the storyteller rejects it."""
        with SessionLocal() as session:
            room = session.get(RoomModel, room_id)
            if room is None:
                return None
            self._require_storyteller(session, room_id, request.actor_player_id, secret)
            nomination_request = session.get(NominationRequestModel, request_id)
            if nomination_request is None or nomination_request.room_id != room_id:
                return None
            session.delete(nomination_request)
            self._touch(room)
            session.commit()
            return self._to_state(session, room)

    def cast_vote(self, room_id: str, request: VoteRequest, secret: str | None) -> RoomState | None:
        """Record a player's vote for the active nomination."""
        with SessionLocal() as session:
            room = session.get(RoomModel, room_id)
            nomination = self._active_nomination(session, room_id)
            if room is None or nomination is None:
                return None
            if not nomination.is_open:
                raise ValueError("vote is closed")
            player = self._authenticate(session, room_id, request.player_id, secret)
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

    def close_vote(self, room_id: str, request: StorytellerActionRequest, secret: str | None) -> RoomState | None:
        """Close the active vote without executing the nominee."""
        with SessionLocal() as session:
            room = session.get(RoomModel, room_id)
            if room is None:
                return None
            self._require_storyteller(session, room_id, request.actor_player_id, secret)
            nomination = self._active_nomination(session, room_id)
            if nomination is not None:
                nomination.is_open = False
                nomination.is_active = False
                session.execute(delete(VoteModel).where(VoteModel.room_id == room_id))
            self._touch(room)
            session.commit()
            return self._to_state(session, room)

    def execute_nominee(self, room_id: str, request: ExecuteNomineeRequest, secret: str | None) -> RoomState | None:
        """Mark the nominated player dead after confirming the vote threshold."""
        with SessionLocal() as session:
            room = session.get(RoomModel, room_id)
            nomination = self._active_nomination(session, room_id)
            if room is None or nomination is None:
                return None
            self._require_storyteller(session, room_id, request.actor_player_id, secret)
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

    def reset_game(self, room_id: str, request: StorytellerActionRequest, secret: str | None) -> RoomState | None:
        """Reset match-only state so the same room can be prepared again."""
        with SessionLocal() as session:
            room = session.get(RoomModel, room_id)
            if room is None:
                return None
            self._require_storyteller(session, room_id, request.actor_player_id, secret)
            self._begin_new_round(session, room)
            session.execute(delete(CharacterAssignmentModel).where(CharacterAssignmentModel.room_id == room_id))
            self._touch(room)
            session.commit()
            return self._to_state(session, room)

    def _begin_new_round(self, session: Session, room: RoomModel) -> None:
        """Roll the room back to a hidden pre-game lobby for the next round."""
        room.phase = GamePhase.LOBBY.value
        room.day_count = 0
        room.night_count = 0
        room.show_board = False
        room.shared_grimoire_player_ids = "[]"
        room.shared_grimoire_reminders = "[]"
        self._clear_active_nomination(session, room.id)
        session.execute(delete(VoteModel).where(VoteModel.room_id == room.id))
        session.execute(delete(NominationRequestModel).where(NominationRequestModel.room_id == room.id))
        session.execute(delete(DemonBluffModel).where(DemonBluffModel.room_id == room.id))
        for player in room.players:
            player.status = PlayerStatus.ALIVE.value
            player.has_dead_vote = True

    def delete_room(self, room_id: str, actor_player_id: str | None, secret: str | None) -> bool:
        """Delete a room after storyteller authorization."""
        with SessionLocal() as session:
            room = session.get(RoomModel, room_id)
            if room is None:
                return False
            self._require_storyteller(session, room_id, actor_player_id, secret)
            session.delete(room)
            session.commit()
            self._forget_room_runtime_state(room_id)
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
            for room_id in room_ids:
                self._forget_room_runtime_state(room_id)
            return room_ids

    def mark_all_players_disconnected(self) -> None:
        """Clear stale connection flags after backend startup."""
        # After a backend restart there are no live WebSockets, even if the DB
        # still contains old is_connected=true flags from the previous process.
        with SessionLocal() as session:
            session.execute(
                update(PlayerModel).where(PlayerModel.is_connected.is_(True)).values(is_connected=False)
            )
            session.commit()

    def replace_pack(
        self,
        room_id: str,
        actor_player_id: str,
        secret: str | None,
        characters: list[Character],
        reminder_tokens: list[ReminderTokenDefinition],
    ) -> RoomState | None:
        """Replace a room's imported characters and reminder tokens."""
        with SessionLocal() as session:
            room = session.get(RoomModel, room_id)
            if room is None:
                return None
            self._require_storyteller(session, room_id, actor_player_id, secret)
            if room.phase != GamePhase.LOBBY.value:
                raise ValueError("character packs can only be uploaded in lobby")
            if not characters:
                raise ValueError("character pack must contain at least one character")
            session.execute(delete(CharacterAssignmentModel).where(CharacterAssignmentModel.room_id == room_id))
            session.execute(delete(DemonBluffModel).where(DemonBluffModel.room_id == room_id))
            session.execute(delete(CharacterModel).where(CharacterModel.room_id == room_id))
            session.execute(delete(ReminderTokenModel).where(ReminderTokenModel.room_id == room_id))
            for sort_order, character in enumerate(characters):
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
                        sort_order=sort_order,
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
                .order_by(CharacterModel.sort_order.asc(), CharacterModel.category.asc(), CharacterModel.name.asc())
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

    def assign_character(
        self,
        room_id: str,
        request: AssignCharacterRequest,
        secret: str | None,
    ) -> list[CharacterAssignment] | None:
        """Assign one imported character to one player."""
        with SessionLocal() as session:
            room = session.get(RoomModel, room_id)
            if room is None:
                return None
            self._require_storyteller(session, room_id, request.actor_player_id, secret)
            player = self._find_player(session, room_id, request.player_id)
            if player is None:
                return None
            if player.is_storyteller:
                raise ValueError("storyteller cannot receive a character assignment")
            character = session.get(CharacterModel, request.character_id)
            if character is None or character.room_id != room_id:
                return None
            # Assigning after the board reveal starts the next round: hide the
            # board again so only each player's own role is visible.
            if room.show_board:
                self._begin_new_round(session, room)
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
            return self.list_assignments(room_id, request.actor_player_id, secret)

    def assign_random_characters(
        self,
        room_id: str,
        request: RandomAssignCharactersRequest,
        secret: str | None,
    ) -> list[CharacterAssignment] | None:
        """Shuffle selected characters across all currently seated players."""
        with SessionLocal() as session:
            room = session.get(RoomModel, room_id)
            if room is None:
                return None
            self._require_storyteller(session, room_id, request.actor_player_id, secret)
            if room.phase != GamePhase.LOBBY.value and not room.show_board:
                raise ValueError(
                    "random assignment would reshuffle every role mid-game; assign characters individually instead"
                )
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

            # Assigning after the board reveal starts the next round: hide the
            # board again so only each player's own role is visible.
            if room.show_board:
                self._begin_new_round(session, room)
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
            return self.list_assignments(room_id, request.actor_player_id, secret)

    def set_demon_bluffs(self, room_id: str, request: DemonBluffsRequest, secret: str | None) -> list[str] | None:
        """Replace the storyteller-only demon bluff character list."""
        with SessionLocal() as session:
            room = session.get(RoomModel, room_id)
            if room is None:
                return None
            self._require_storyteller(session, room_id, request.actor_player_id, secret)
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
            return self.list_demon_bluffs(room_id, request.actor_player_id, secret)

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

    def authenticate_player(self, room_id: str, player_id: str, secret: str | None) -> bool:
        """Return whether a player id and bearer secret match, for the WS handshake."""
        if not player_id or not secret:
            return False
        with SessionLocal() as session:
            stored = session.scalar(
                select(PlayerModel.secret).where(PlayerModel.room_id == room_id, PlayerModel.id == player_id)
            )
        return bool(stored) and compare_digest(stored, secret)

    def is_storyteller(self, room_id: str, player_id: str) -> bool:
        """Return whether a player is the room storyteller using one cheap query."""
        with SessionLocal() as session:
            return (
                session.scalar(
                    select(PlayerModel.is_storyteller).where(
                        PlayerModel.room_id == room_id,
                        PlayerModel.id == player_id,
                    )
                )
                is True
            )

    def players_in_room(self, room_id: str, player_ids: set[str]) -> bool:
        """Return whether every given player id belongs to the room."""
        wanted = {player_id for player_id in player_ids if player_id}
        if not wanted:
            return False
        with SessionLocal() as session:
            found = session.scalars(
                select(PlayerModel.id).where(PlayerModel.room_id == room_id, PlayerModel.id.in_(wanted))
            ).all()
        return set(found) == wanted

    def set_player_avatar(
        self,
        room_id: str,
        player_id: str,
        actor_player_id: str,
        secret: str | None,
        data_url: str,
    ) -> RoomState | None:
        """Replace a player's stored avatar image after ownership validation."""
        with SessionLocal() as session:
            room = session.get(RoomModel, room_id)
            if room is None:
                return None
            player = self._find_player(session, room_id, player_id)
            if player is None:
                return None
            self._authenticate(session, room_id, actor_player_id, secret)
            if actor_player_id != player_id:
                raise ValueError("players can only change their own profile image")
            session.execute(delete(PlayerAvatarModel).where(PlayerAvatarModel.player_id == player_id))
            session.add(PlayerAvatarModel(room_id=room_id, player_id=player_id, data_url=data_url))
            self._touch(room)
            session.commit()
            return self._to_state(session, room)

    def list_assignments(
        self,
        room_id: str,
        viewer_player_id: str,
        secret: str | None,
    ) -> list[CharacterAssignment] | None:
        """Return character assignments visible to the requesting viewer."""
        with SessionLocal() as session:
            room = session.get(RoomModel, room_id)
            if room is None:
                return None
            viewer = self._authenticate(session, room_id, viewer_player_id, secret)
            shared_grimoire_player_ids = set(self._parse_shared_grimoire_player_ids(room))
            if not viewer.is_storyteller and not room.show_board and viewer_player_id not in shared_grimoire_player_ids:
                # Players see their own role only once the game has started;
                # in the lobby the assignments stay storyteller-only.
                if room.phase == GamePhase.LOBBY.value:
                    return []
                query = select(CharacterAssignmentModel).where(
                    CharacterAssignmentModel.room_id == room_id,
                    CharacterAssignmentModel.player_id == viewer_player_id,
                )
            else:
                query = select(CharacterAssignmentModel).where(CharacterAssignmentModel.room_id == room_id)
            rows = session.scalars(query).all()
            return [
                CharacterAssignment(player_id=row.player_id, character_id=row.character_id)
                for row in rows
            ]

    def list_demon_bluffs(self, room_id: str, viewer_player_id: str, secret: str | None) -> list[str] | None:
        """Return demon bluffs after verifying the viewer is storyteller."""
        with SessionLocal() as session:
            room = session.get(RoomModel, room_id)
            if room is None:
                return None
            self._require_storyteller(session, room_id, viewer_player_id, secret)
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

    def _request_fields_set(self, request: UpdatePlayerRequest) -> set[str]:
        """Return explicitly supplied request fields for Pydantic v1 or v2."""
        fields_set = getattr(request, "model_fields_set", None)
        if fields_set is None:
            fields_set = request.__fields_set__
        return set(fields_set)

    def _seat_change_lock(self, room_id: str) -> Lock:
        """Return the in-process lock that serializes seat claims for one room."""
        lock = self._seat_change_locks.get(room_id)
        if lock is None:
            lock = Lock()
            self._seat_change_locks[room_id] = lock
        return lock

    def _forget_room_runtime_state(self, room_id: str) -> None:
        """Drop in-memory rate limits and locks after a room is deleted."""
        self._seat_change_locks.pop(room_id, None)
        for key in [key for key in self._next_seat_change_at if key[0] == room_id]:
            self._next_seat_change_at.pop(key, None)

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

    def night_voice_info(self, room_id: str) -> tuple[bool, str | None]:
        """Return (is_night, storyteller_id) using cheap scalar queries.

        The voice hub calls this on every presence broadcast, so it must not
        load the full room snapshot (which carries base64 avatars).
        """
        with SessionLocal() as session:
            phase = session.scalar(select(RoomModel.phase).where(RoomModel.id == room_id))
            if phase is None:
                return (False, None)
            storyteller_id = session.scalar(
                select(PlayerModel.id).where(PlayerModel.room_id == room_id, PlayerModel.is_storyteller.is_(True))
            )
            return (phase == GamePhase.NIGHT.value, storyteller_id)

    def _can_change_seats(self, room: RoomModel) -> bool:
        """Return whether the room currently allows seat changes."""
        return can_change_seats(room.phase, room.show_board)

    def _compact_seats(self, session: Session, seated_players: list[PlayerModel], old_count: int, new_count: int) -> None:
        """Reindex seated players when shrinking removes free seats.

        Occupied seats are never dropped: free seats are removed from the top
        of the circle downwards and everyone keeps their relative order.
        """
        if new_count >= old_count:
            return
        occupied = {player.seat_index for player in seated_players}
        kept_seats = list(range(old_count))
        for seat_index in range(old_count - 1, -1, -1):
            if len(kept_seats) <= new_count:
                break
            if seat_index not in occupied:
                kept_seats.remove(seat_index)
        if len(kept_seats) > new_count:
            raise ValueError("No free seats available.")
        new_index_by_seat = {seat_index: position for position, seat_index in enumerate(kept_seats)}
        final_index_by_player: dict[str, int] = {}
        for player in seated_players:
            if player.seat_index is None or player.seat_index not in new_index_by_seat:
                raise ValueError("No free seats available.")
            final_index_by_player[player.id] = new_index_by_seat[player.seat_index]
        if all(player.seat_index == final_index_by_player[player.id] for player in seated_players):
            return

        # Move seats into unused temporary slots before the final compacted
        # indices so the database never sees two players on the same seat.
        highest_existing_seat = max((player.seat_index for player in seated_players if player.seat_index is not None), default=-1)
        temporary_start = max(old_count, highest_existing_seat) + len(seated_players) + 1
        for offset, player in enumerate(seated_players):
            player.seat_index = temporary_start + offset
        session.flush()
        for player in seated_players:
            player.seat_index = final_index_by_player[player.id]

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

    def _authenticate(self, session: Session, room_id: str, player_id: str | None, secret: str | None) -> PlayerModel:
        """Return the acting player only when their id and bearer secret both match."""
        if not player_id or not secret:
            raise ValueError("invalid player credentials")
        player = self._find_player(session, room_id, player_id)
        if player is None or not player.secret or not compare_digest(player.secret, secret):
            raise ValueError("invalid player credentials")
        return player

    def _require_storyteller(
        self,
        session: Session,
        room_id: str,
        player_id: str | None,
        secret: str | None,
    ) -> PlayerModel:
        """Return the actor when they are the authenticated room storyteller."""
        player = self._authenticate(session, room_id, player_id, secret)
        if not player.is_storyteller:
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
