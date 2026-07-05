"""Room HTTP API routes.

This module exposes the REST endpoints for creating rooms, joining players,
changing game state, uploading assets, assigning roles, and broadcasting updates.
"""

import base64

from fastapi import APIRouter, File, Form, Header, HTTPException, UploadFile

from app.game.room_state import (
    AssignCharacterRequest,
    CreateRoomRequest,
    DemonBluffsRequest,
    ExecuteNomineeRequest,
    JoinRoomRequest,
    LeaveRoomRequest,
    PhaseRequest,
    PlayerNominationRequest,
    RandomAssignCharactersRequest,
    SetStorytellerRequest,
    StartNominationRequest,
    StorytellerActionRequest,
    UpdatePlayerRequest,
    UpdateRoomRequest,
    VoteRequest,
)
from app.game.character_packs import MAX_PACK_BYTES, parse_character_pack
from app.game.media_validation import MAX_PROFILE_IMAGE_BYTES, validate_profile_image
from app.game.store import room_store
from app.websocket.room_hub import room_hub

# HTTP API for everything that happens in an MVP room.
# Every write action persists to PostgreSQL first, then broadcasts the new room state.
router = APIRouter(prefix="/api/rooms", tags=["rooms"])

_UPLOAD_CHUNK_BYTES = 64 * 1024


async def _read_upload_capped(file: UploadFile, max_bytes: int) -> bytes:
    """Read an upload in chunks and abort once it exceeds the allowed size.

    Starlette buffers multipart bodies without any global limit, so reading the
    whole file first would let a huge POST exhaust memory. Streaming with a
    running cap keeps memory bounded regardless of the declared Content-Length.
    """
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await file.read(_UPLOAD_CHUNK_BYTES)
        if not chunk:
            break
        total += len(chunk)
        if total > max_bytes:
            raise HTTPException(status_code=413, detail="Upload is too large")
        chunks.append(chunk)
    return b"".join(chunks)


@router.post("")
async def create_room(request: CreateRoomRequest):
    """Create a new room and return the founder's private session credentials."""
    session = room_store.create_room(request)
    await room_hub.broadcast_state(session.room)
    return session


@router.get("/{room_id}")
def get_room(room_id: str):
    """Return one room snapshot by id."""
    room = room_store.get_room(room_id)
    if room is None:
        raise HTTPException(status_code=404, detail="Room not found")
    return room


@router.patch("/{room_id}")
async def update_room(room_id: str, request: UpdateRoomRequest, x_player_secret: str | None = Header(default=None)):
    """Apply storyteller-owned room setting changes."""
    try:
        room = room_store.update_room(room_id, request, x_player_secret)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    if room is None:
        raise HTTPException(status_code=404, detail="Room not found")
    if room.phase == "night" and not room.allow_public_voice_during_night:
        await room_hub.close_public_voice_rooms(room_id)
    await room_hub.broadcast_state(room)
    return room


@router.post("/{room_id}/players")
async def join_room(room_id: str, request: JoinRoomRequest):
    """Join an existing room and return the new player's private session credentials."""
    try:
        session = room_store.join_room(room_id, request)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    if session is None:
        raise HTTPException(status_code=404, detail="Room not found")
    await room_hub.broadcast_state(session.room)
    return session


@router.post("/{room_id}/storyteller")
async def set_storyteller(
    room_id: str,
    request: SetStorytellerRequest,
    x_player_secret: str | None = Header(default=None),
):
    """Transfer the storyteller role to another player when allowed."""
    try:
        room = room_store.set_storyteller(room_id, request, x_player_secret)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    if room is None:
        raise HTTPException(status_code=404, detail="Room or player not found")
    await room_hub.broadcast_state(room)
    return room


@router.patch("/{room_id}/players/{player_id}")
async def update_player(
    room_id: str,
    player_id: str,
    request: UpdatePlayerRequest,
    x_player_secret: str | None = Header(default=None),
):
    """Update one player's seat, status, or dead-vote state."""
    try:
        room = room_store.update_player(room_id, player_id, request, x_player_secret)
    except ValueError as error:
        if str(error) == "seat changes are too frequent":
            raise HTTPException(status_code=429, detail=str(error)) from error
        raise HTTPException(status_code=400, detail=str(error)) from error
    if room is None:
        raise HTTPException(status_code=404, detail="Room or player not found")
    await room_hub.broadcast_state(room)
    return room


@router.delete("/{room_id}/players/{player_id}")
async def leave_room(
    room_id: str,
    player_id: str,
    request: LeaveRoomRequest,
    x_player_secret: str | None = Header(default=None),
):
    """Remove a player from a room by self-leave or storyteller kick."""
    was_kick = request.actor_player_id != player_id
    try:
        room = room_store.leave_room(room_id, player_id, request.actor_player_id, x_player_secret)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    if room is None:
        raise HTTPException(status_code=404, detail="Room or player not found")
    if was_kick:
        await room_hub.kick_player(room_id, player_id, "The storyteller removed you from the room.")
    await room_hub.broadcast_state(room)
    return room


@router.post("/{room_id}/players/{player_id}/avatar")
async def upload_player_avatar(
    room_id: str,
    player_id: str,
    actor_player_id: str = Form(...),
    file: UploadFile = File(...),
    x_player_secret: str | None = Header(default=None),
):
    """Validate and store one player's uploaded avatar image."""
    data = await _read_upload_capped(file, MAX_PROFILE_IMAGE_BYTES)
    media_type = file.content_type or ""
    try:
        validate_profile_image(file.filename or "", media_type, data)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    encoded = base64.b64encode(data).decode("ascii")
    try:
        room = room_store.set_player_avatar(
            room_id, player_id, actor_player_id, x_player_secret, f"data:{media_type};base64,{encoded}"
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    if room is None:
        raise HTTPException(status_code=404, detail="Room or player not found")
    await room_hub.broadcast_state(room)
    return room


@router.post("/{room_id}/phase")
async def set_phase(room_id: str, request: PhaseRequest, x_player_secret: str | None = Header(default=None)):
    """Move the room between lobby, day, and night phases."""
    try:
        room = room_store.set_phase(room_id, request, x_player_secret)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    if room is None:
        raise HTTPException(status_code=404, detail="Room not found")
    if room.phase == "night" and not room.allow_public_voice_during_night:
        await room_hub.close_public_voice_rooms(room_id)
    await room_hub.broadcast_state(room)
    return room


@router.post("/{room_id}/nominations")
async def start_nomination(
    room_id: str,
    request: StartNominationRequest,
    x_player_secret: str | None = Header(default=None),
):
    """Start a storyteller-approved nomination immediately."""
    try:
        room = room_store.start_nomination(room_id, request, x_player_secret)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    if room is None:
        raise HTTPException(status_code=404, detail="Room or player not found")
    await room_hub.broadcast_state(room)
    return room


@router.post("/{room_id}/nomination-requests")
async def request_nomination(
    room_id: str,
    request: PlayerNominationRequest,
    x_player_secret: str | None = Header(default=None),
):
    """Create a player nomination request for storyteller approval."""
    try:
        room = room_store.request_nomination(room_id, request, x_player_secret)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    if room is None:
        raise HTTPException(status_code=404, detail="Room or player not found")
    await room_hub.broadcast_state(room)
    return room


@router.delete("/{room_id}/nomination-requests/{request_id}")
async def reject_nomination_request(
    room_id: str,
    request_id: str,
    request: StorytellerActionRequest,
    x_player_secret: str | None = Header(default=None),
):
    """Reject and remove a pending nomination request."""
    try:
        room = room_store.reject_nomination_request(room_id, request_id, request, x_player_secret)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    if room is None:
        raise HTTPException(status_code=404, detail="Room or nomination request not found")
    await room_hub.broadcast_state(room)
    return room


@router.post("/{room_id}/votes")
async def cast_vote(room_id: str, request: VoteRequest, x_player_secret: str | None = Header(default=None)):
    """Record or replace one player's vote for the active nomination."""
    try:
        room = room_store.cast_vote(room_id, request, x_player_secret)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    if room is None:
        raise HTTPException(status_code=404, detail="Room, player, or nomination not found")
    await room_hub.broadcast_state(room)
    return room


@router.post("/{room_id}/votes/close")
async def close_vote(room_id: str, request: StorytellerActionRequest, x_player_secret: str | None = Header(default=None)):
    """Close the active vote without executing the nominee."""
    try:
        room = room_store.close_vote(room_id, request, x_player_secret)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    if room is None:
        raise HTTPException(status_code=404, detail="Room not found")
    await room_hub.broadcast_state(room)
    return room


@router.post("/{room_id}/executions")
async def execute_nominee(room_id: str, request: ExecuteNomineeRequest, x_player_secret: str | None = Header(default=None)):
    """Execute the active nominee after the backend validates vote threshold."""
    try:
        room = room_store.execute_nominee(room_id, request, x_player_secret)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    if room is None:
        raise HTTPException(status_code=404, detail="Room, nomination, or nominee not found")
    await room_hub.broadcast_state(room)
    await room_hub.broadcast_room_event(room_id, {"type": "nomination.executed", "payload": {"roomId": room_id}})
    return room


@router.post("/{room_id}/reset")
async def reset_game(room_id: str, request: StorytellerActionRequest, x_player_secret: str | None = Header(default=None)):
    """Reset gameplay state so the same room can start a fresh match."""
    try:
        room = room_store.reset_game(room_id, request, x_player_secret)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    if room is None:
        raise HTTPException(status_code=404, detail="Room not found")
    await room_hub.broadcast_state(room)
    return room


@router.delete("/{room_id}")
async def delete_room(room_id: str, request: StorytellerActionRequest, x_player_secret: str | None = Header(default=None)):
    """Delete a room when requested by the storyteller."""
    try:
        deleted = room_store.delete_room(room_id, request.actor_player_id, x_player_secret)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    if not deleted:
        raise HTTPException(status_code=404, detail="Room not found")
    await room_hub.broadcast_deleted(room_id)
    return {"status": "deleted"}


@router.post("/{room_id}/characters/upload")
async def upload_characters(
    room_id: str,
    actor_player_id: str = Form(...),
    file: UploadFile = File(...),
    x_player_secret: str | None = Header(default=None),
):
    """Parse and replace the room's character pack."""
    data = await _read_upload_capped(file, MAX_PACK_BYTES)
    try:
        characters, reminder_tokens = parse_character_pack(data)
        room = room_store.replace_pack(room_id, actor_player_id, x_player_secret, characters, reminder_tokens)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    if room is None:
        raise HTTPException(status_code=404, detail="Room not found")
    await room_hub.broadcast_state(room)
    return {"characters": len(characters), "reminder_tokens": len(reminder_tokens)}


@router.get("/{room_id}/characters")
def list_characters(room_id: str, language: str | None = None):
    """List imported characters, optionally translated for one language."""
    characters = room_store.list_characters(room_id, language)
    if characters is None:
        raise HTTPException(status_code=404, detail="Room not found")
    return characters


@router.get("/{room_id}/reminder-tokens")
def list_reminder_tokens(room_id: str, language: str | None = None):
    """List imported reminder tokens, optionally translated for one language."""
    reminder_tokens = room_store.list_reminder_tokens(room_id, language)
    if reminder_tokens is None:
        raise HTTPException(status_code=404, detail="Room not found")
    return reminder_tokens


@router.post("/{room_id}/character-assignments")
async def assign_character(
    room_id: str,
    request: AssignCharacterRequest,
    x_player_secret: str | None = Header(default=None),
):
    """Assign one specific character to one player."""
    try:
        assignments = room_store.assign_character(room_id, request, x_player_secret)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    if assignments is None:
        raise HTTPException(status_code=404, detail="Room, player, or character not found")
    room = room_store.get_room(room_id)
    if room is not None:
        await room_hub.broadcast_state(room)
    return assignments


@router.post("/{room_id}/character-assignments/random")
async def assign_random_characters(
    room_id: str,
    request: RandomAssignCharactersRequest,
    x_player_secret: str | None = Header(default=None),
):
    """Shuffle selected characters across currently seated players."""
    try:
        assignments = room_store.assign_random_characters(room_id, request, x_player_secret)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    if assignments is None:
        raise HTTPException(status_code=404, detail="Room, player, or character not found")
    room = room_store.get_room(room_id)
    if room is not None:
        await room_hub.broadcast_state(room)
    return assignments


@router.get("/{room_id}/character-assignments")
def list_character_assignments(
    room_id: str,
    viewer_player_id: str,
    x_player_secret: str | None = Header(default=None),
):
    """Return character assignments visible to the requesting viewer."""
    try:
        assignments = room_store.list_assignments(room_id, viewer_player_id, x_player_secret)
    except ValueError as error:
        raise HTTPException(status_code=403, detail=str(error)) from error
    if assignments is None:
        raise HTTPException(status_code=404, detail="Room or viewer not found")
    return assignments


@router.get("/{room_id}/demon-bluffs")
def list_demon_bluffs(
    room_id: str,
    viewer_player_id: str,
    x_player_secret: str | None = Header(default=None),
):
    """Return storyteller-only demon bluff character ids."""
    try:
        bluffs = room_store.list_demon_bluffs(room_id, viewer_player_id, x_player_secret)
    except ValueError as error:
        raise HTTPException(status_code=403, detail=str(error)) from error
    if bluffs is None:
        raise HTTPException(status_code=404, detail="Room or viewer not found")
    return bluffs


@router.post("/{room_id}/demon-bluffs")
async def set_demon_bluffs(room_id: str, request: DemonBluffsRequest, x_player_secret: str | None = Header(default=None)):
    """Replace the storyteller's selected demon bluff characters."""
    try:
        bluffs = room_store.set_demon_bluffs(room_id, request, x_player_secret)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    if bluffs is None:
        raise HTTPException(status_code=404, detail="Room, storyteller, or character not found")
    room = room_store.get_room(room_id)
    if room is not None:
        await room_hub.broadcast_state(room)
    return bluffs
