import base64

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

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
from app.game.media_validation import validate_profile_image
from app.game.store import room_store
from app.websocket.room_hub import room_hub

# HTTP API for everything that happens in an MVP room.
# Every write action persists to PostgreSQL first, then broadcasts the new room state.
router = APIRouter(prefix="/api/rooms", tags=["rooms"])

@router.post("")
async def create_room(request: CreateRoomRequest):
    room = room_store.create_room(request)
    await room_hub.broadcast_state(room)
    return room


@router.get("/{room_id}")
def get_room(room_id: str):
    room = room_store.get_room(room_id)
    if room is None:
        raise HTTPException(status_code=404, detail="Room not found")
    return room


@router.patch("/{room_id}")
async def update_room(room_id: str, request: UpdateRoomRequest):
    try:
        room = room_store.update_room(room_id, request)
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
    try:
        room = room_store.join_room(room_id, request)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    if room is None:
        raise HTTPException(status_code=404, detail="Room not found")
    await room_hub.broadcast_state(room)
    return room


@router.post("/{room_id}/storyteller")
async def set_storyteller(room_id: str, request: SetStorytellerRequest):
    try:
        room = room_store.set_storyteller(room_id, request)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    if room is None:
        raise HTTPException(status_code=404, detail="Room or player not found")
    await room_hub.broadcast_state(room)
    return room


@router.patch("/{room_id}/players/{player_id}")
async def update_player(room_id: str, player_id: str, request: UpdatePlayerRequest):
    try:
        room = room_store.update_player(room_id, player_id, request)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    if room is None:
        raise HTTPException(status_code=404, detail="Room or player not found")
    await room_hub.broadcast_state(room)
    return room


@router.delete("/{room_id}/players/{player_id}")
async def leave_room(room_id: str, player_id: str, request: LeaveRoomRequest):
    was_kick = request.actor_player_id != player_id
    try:
        room = room_store.leave_room(room_id, player_id, request.actor_player_id)
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
):
    data = await file.read()
    media_type = file.content_type or ""
    try:
        validate_profile_image(file.filename or "", media_type, data)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    encoded = base64.b64encode(data).decode("ascii")
    try:
        room = room_store.set_player_avatar(room_id, player_id, actor_player_id, f"data:{media_type};base64,{encoded}")
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    if room is None:
        raise HTTPException(status_code=404, detail="Room or player not found")
    await room_hub.broadcast_state(room)
    return room


@router.post("/{room_id}/phase")
async def set_phase(room_id: str, request: PhaseRequest):
    try:
        room = room_store.set_phase(room_id, request)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    if room is None:
        raise HTTPException(status_code=404, detail="Room not found")
    if room.phase == "night" and not room.allow_public_voice_during_night:
        await room_hub.close_public_voice_rooms(room_id)
    await room_hub.broadcast_state(room)
    return room


@router.post("/{room_id}/nominations")
async def start_nomination(room_id: str, request: StartNominationRequest):
    try:
        room = room_store.start_nomination(room_id, request)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    if room is None:
        raise HTTPException(status_code=404, detail="Room or player not found")
    await room_hub.broadcast_state(room)
    return room


@router.post("/{room_id}/nomination-requests")
async def request_nomination(room_id: str, request: PlayerNominationRequest):
    try:
        room = room_store.request_nomination(room_id, request)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    if room is None:
        raise HTTPException(status_code=404, detail="Room or player not found")
    await room_hub.broadcast_state(room)
    return room


@router.delete("/{room_id}/nomination-requests/{request_id}")
async def reject_nomination_request(room_id: str, request_id: str, request: StorytellerActionRequest):
    try:
        room = room_store.reject_nomination_request(room_id, request_id, request)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    if room is None:
        raise HTTPException(status_code=404, detail="Room or nomination request not found")
    await room_hub.broadcast_state(room)
    return room


@router.post("/{room_id}/votes")
async def cast_vote(room_id: str, request: VoteRequest):
    try:
        room = room_store.cast_vote(room_id, request)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    if room is None:
        raise HTTPException(status_code=404, detail="Room, player, or nomination not found")
    await room_hub.broadcast_state(room)
    return room


@router.post("/{room_id}/votes/close")
async def close_vote(room_id: str, request: StorytellerActionRequest):
    try:
        room = room_store.close_vote(room_id, request)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    if room is None:
        raise HTTPException(status_code=404, detail="Room not found")
    await room_hub.broadcast_state(room)
    return room


@router.post("/{room_id}/executions")
async def execute_nominee(room_id: str, request: ExecuteNomineeRequest):
    try:
        room = room_store.execute_nominee(room_id, request)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    if room is None:
        raise HTTPException(status_code=404, detail="Room, nomination, or nominee not found")
    await room_hub.broadcast_state(room)
    return room


@router.post("/{room_id}/reset")
async def reset_game(room_id: str, request: StorytellerActionRequest):
    try:
        room = room_store.reset_game(room_id, request)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    if room is None:
        raise HTTPException(status_code=404, detail="Room not found")
    await room_hub.broadcast_state(room)
    return room


@router.delete("/{room_id}")
async def delete_room(room_id: str, request: StorytellerActionRequest):
    try:
        deleted = room_store.delete_room(room_id, request.actor_player_id)
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
):
    data = await file.read()
    if len(data) > MAX_PACK_BYTES:
        raise HTTPException(status_code=400, detail="Character pack is too large")
    try:
        characters, reminder_tokens = parse_character_pack(data)
        room = room_store.replace_pack(room_id, actor_player_id, characters, reminder_tokens)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    if room is None:
        raise HTTPException(status_code=404, detail="Room not found")
    await room_hub.broadcast_state(room)
    return {"characters": len(characters), "reminder_tokens": len(reminder_tokens)}


@router.get("/{room_id}/characters")
def list_characters(room_id: str, language: str | None = None):
    characters = room_store.list_characters(room_id, language)
    if characters is None:
        raise HTTPException(status_code=404, detail="Room not found")
    return characters


@router.get("/{room_id}/reminder-tokens")
def list_reminder_tokens(room_id: str, language: str | None = None):
    reminder_tokens = room_store.list_reminder_tokens(room_id, language)
    if reminder_tokens is None:
        raise HTTPException(status_code=404, detail="Room not found")
    return reminder_tokens


@router.post("/{room_id}/character-assignments")
async def assign_character(room_id: str, request: AssignCharacterRequest):
    try:
        assignments = room_store.assign_character(room_id, request)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    if assignments is None:
        raise HTTPException(status_code=404, detail="Room, player, or character not found")
    room = room_store.get_room(room_id)
    if room is not None:
        await room_hub.broadcast_state(room)
    return assignments


@router.post("/{room_id}/character-assignments/random")
async def assign_random_characters(room_id: str, request: RandomAssignCharactersRequest):
    try:
        assignments = room_store.assign_random_characters(room_id, request)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    if assignments is None:
        raise HTTPException(status_code=404, detail="Room, player, or character not found")
    room = room_store.get_room(room_id)
    if room is not None:
        await room_hub.broadcast_state(room)
    return assignments


@router.get("/{room_id}/character-assignments")
def list_character_assignments(room_id: str, viewer_player_id: str):
    assignments = room_store.list_assignments(room_id, viewer_player_id)
    if assignments is None:
        raise HTTPException(status_code=404, detail="Room or viewer not found")
    return assignments


@router.get("/{room_id}/demon-bluffs")
def list_demon_bluffs(room_id: str, viewer_player_id: str):
    try:
        bluffs = room_store.list_demon_bluffs(room_id, viewer_player_id)
    except ValueError as error:
        raise HTTPException(status_code=403, detail=str(error)) from error
    if bluffs is None:
        raise HTTPException(status_code=404, detail="Room or viewer not found")
    return bluffs


@router.post("/{room_id}/demon-bluffs")
async def set_demon_bluffs(room_id: str, request: DemonBluffsRequest):
    try:
        bluffs = room_store.set_demon_bluffs(room_id, request)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    if bluffs is None:
        raise HTTPException(status_code=404, detail="Room, storyteller, or character not found")
    room = room_store.get_room(room_id)
    if room is not None:
        await room_hub.broadcast_state(room)
    return bluffs
