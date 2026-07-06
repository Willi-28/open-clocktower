"""Room WebSocket endpoint and event routing.

This module accepts browser WebSockets, validates room/player identity, and
forwards realtime chat, voice, timer, bell, hand, and vote-count events.
"""

from time import monotonic

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.game.chat_rules import can_chat, find_player
from app.game.store import room_store
from app.websocket.room_hub import room_hub

router = APIRouter()

# Flood protection: one player may send at most this many chat messages within
# the sliding window; messages beyond the cap are silently dropped.
MAX_CHAT_BURST = 8
CHAT_WINDOW_SECONDS = 5.0
_chat_message_times: dict[tuple[str, str], list[float]] = {}


def _chat_rate_ok(room_id: str, player_id: str) -> bool:
    """Return whether this player may send another chat message right now."""
    now = monotonic()
    key = (room_id, player_id)
    recent = [stamp for stamp in _chat_message_times.get(key, []) if now - stamp < CHAT_WINDOW_SECONDS]
    if len(recent) >= MAX_CHAT_BURST:
        _chat_message_times[key] = recent
        return False
    recent.append(now)
    _chat_message_times[key] = recent
    return True


@router.websocket("/ws/rooms/{room_id}")
async def room_socket(websocket: WebSocket, room_id: str):
    """Handle one browser's live connection to a room."""
    # Keeps the room connection open and handles lightweight private chat and voice events.
    player_id = websocket.query_params.get("player_id")
    secret = websocket.query_params.get("secret")
    room = room_store.get_room(room_id)
    if room is None:
        await websocket.close(code=1008)
        return
    # An identity is only accepted when the bearer secret matches; otherwise the
    # connection is downgraded to a read-only spectator that cannot act as anyone.
    if player_id and not room_store.authenticate_player(room_id, player_id, secret):
        player_id = None
    await room_hub.connect(room_id, websocket, player_id)
    if player_id:
        room = room_store.set_player_connection(room_id, player_id, True)
        if room is not None:
            await room_hub.broadcast_state(room)
    await websocket.send_json({"type": "connected", "payload": {"roomId": room_id}})
    try:
        while True:
            try:
                message = await websocket.receive_json()
            except (ValueError, TypeError, KeyError):
                # Ignore malformed or non-JSON frames instead of dropping the socket.
                continue
            if not isinstance(message, dict):
                continue
            try:
                await _dispatch_message(room_id, player_id, message)
            except (ValueError, TypeError):
                # A single bad payload must never tear down the whole connection.
                continue
    except WebSocketDisconnect:
        pass
    finally:
        # Cleanup must run on every exit path so a room never keeps a stale
        # socket or a permanently is_connected=True player after a crash.
        room_hub.disconnect(room_id, websocket)
        if player_id and not room_hub.has_player_connection(room_id, player_id):
            await room_hub.set_hand_raised(room_id, player_id, False)
            await room_hub.set_voice_room(room_id, player_id, None)
            room = room_store.set_player_connection(room_id, player_id, False)
            if room is not None:
                await room_hub.broadcast_state(room)


async def _dispatch_message(room_id: str, player_id: str | None, message: dict) -> None:
    """Route one validated WebSocket message from a known player to its handler."""
    if not player_id:
        return
    payload = message.get("payload", {})
    if not isinstance(payload, dict):
        payload = {}
    message_type = message.get("type")
    if message_type == "chat.send":
        await _handle_chat_message(room_id, player_id, payload)
    elif message_type == "hand.set":
        await room_hub.set_hand_raised(room_id, player_id, bool(payload.get("isRaised")))
    elif message_type == "voice.join":
        voice_room = str(payload.get("voiceRoom", "")).strip() or None
        if _can_join_voice_room(room_id, player_id, voice_room):
            await room_hub.set_voice_room(room_id, player_id, voice_room)
    elif message_type == "voice.leave":
        await room_hub.set_voice_room(room_id, player_id, None)
    elif message_type == "voice.call.request":
        await _forward_voice_call(room_id, player_id, payload, "voice.call.request")
    elif message_type == "voice.call.accept":
        await _forward_voice_call(room_id, player_id, payload, "voice.call.accept")
    elif message_type == "voice.call.reject":
        await _forward_voice_reject(room_id, player_id, payload)
    elif message_type == "voice.signal":
        await _forward_voice_signal(room_id, player_id, payload)
    elif message_type == "timer.set":
        await _handle_timer(room_id, player_id, payload)
    elif message_type == "bell.ring":
        await _handle_bell(room_id, player_id)
    elif message_type == "vote_count.set":
        await _handle_vote_count(room_id, player_id, payload)


async def _handle_chat_message(room_id: str, player_id: str, payload: dict) -> None:
    """Validate and forward a public or private chat message."""
    if not _chat_rate_ok(room_id, player_id):
        return
    room = room_store.get_room(room_id)
    target_player_id = payload.get("toPlayerId")
    text = str(payload.get("text", "")).strip()
    sender = find_player(room.players, player_id) if room else None
    if room and sender and target_player_id and text and can_chat(room, player_id, target_player_id):
        await room_hub.send_to_players(
            room_id,
            {player_id, target_player_id},
            {
                "type": "chat.message",
                "payload": {"fromPlayerId": player_id, "toPlayerId": target_player_id, "text": text[:1000]},
            },
        )
        # Everyone may see THAT two players whisper (never what) - like passing
        # a note across the table. Storyteller conversations stay invisible.
        target = find_player(room.players, target_player_id)
        if target and not sender.is_storyteller and not target.is_storyteller:
            await room_hub.broadcast_room_event(
                room_id,
                {
                    "type": "chat.private.notice",
                    "payload": {"fromPlayerId": player_id, "toPlayerId": target_player_id},
                },
            )
    if room and sender and target_player_id is None and text:
        await room_hub.broadcast_room_event(
            room_id,
            {
                "type": "chat.message",
                "payload": {"fromPlayerId": player_id, "toPlayerId": None, "text": text[:1000]},
            },
        )


async def _forward_voice_call(room_id: str, player_id: str, payload: dict, event_type: str) -> None:
    """Forward a private voice call request or acceptance to the target player."""
    target_player_id = payload.get("toPlayerId")
    voice_room = str(payload.get("voiceRoom", "")).strip()
    if isinstance(target_player_id, str) and voice_room and _players_are_in_room(room_id, player_id, target_player_id):
        if not _call_allowed_now(room_id, player_id, target_player_id):
            return
        await room_hub.send_to_players(
            room_id,
            {target_player_id},
            {"type": event_type, "payload": {"fromPlayerId": player_id, "voiceRoom": voice_room}},
        )


def _call_allowed_now(room_id: str, player_id: str, target_player_id: str) -> bool:
    """Night calls must involve the storyteller; day calls are unrestricted."""
    is_night, storyteller_id = room_store.night_voice_info(room_id)
    if not is_night:
        return True
    return storyteller_id is not None and storyteller_id in {player_id, target_player_id}


async def _forward_voice_reject(room_id: str, player_id: str, payload: dict) -> None:
    """Tell a caller that the target player rejected the private voice call."""
    target_player_id = payload.get("toPlayerId")
    if isinstance(target_player_id, str) and _players_are_in_room(room_id, player_id, target_player_id):
        await room_hub.send_to_players(
            room_id,
            {target_player_id},
            {"type": "voice.call.reject", "payload": {"fromPlayerId": player_id}},
        )


async def _forward_voice_signal(room_id: str, player_id: str, payload: dict) -> None:
    """Forward WebRTC offer, answer, or ICE candidate data between room players."""
    target_player_id = payload.get("toPlayerId")
    if isinstance(target_player_id, str) and _players_are_in_room(room_id, player_id, target_player_id):
        await room_hub.send_voice_signal(
            room_id,
            target_player_id,
            {"type": "voice.signal", "payload": {"fromPlayerId": player_id, "signal": payload.get("signal")}},
        )


async def _handle_timer(room_id: str, player_id: str, payload: dict) -> None:
    """Apply storyteller timer changes and broadcast the synced timer state."""
    if _is_storyteller(room_id, player_id):
        await room_hub.set_timer(
            room_id,
            int(payload.get("durationSeconds", 300)),
            int(payload.get("remainingSeconds", 300)),
            bool(payload.get("isRunning")),
        )


async def _handle_bell(room_id: str, player_id: str) -> None:
    """Broadcast a bell event when the storyteller rings it."""
    if _is_storyteller(room_id, player_id):
        await room_hub.broadcast_room_event(room_id, {"type": "bell.ring", "payload": {"fromPlayerId": player_id}})


async def _handle_vote_count(room_id: str, player_id: str, payload: dict) -> None:
    """Apply storyteller-controlled vote counter state."""
    if _is_storyteller(room_id, player_id):
        await room_hub.set_vote_count(room_id, int(payload.get("index", -1)), bool(payload.get("isRunning")))


def _is_storyteller(room_id: str, player_id: str) -> bool:
    """Return whether a connected player is currently the room storyteller."""
    return room_store.is_storyteller(room_id, player_id)


def _players_are_in_room(room_id: str, player_id: str, target_player_id: str) -> bool:
    """Check that both voice signaling participants still belong to the room."""
    # Uses a single membership query so frequent WebRTC signaling never loads the
    # full room snapshot (which includes every player's base64 avatar).
    return room_store.players_in_room(room_id, {player_id, target_player_id})


def _can_join_voice_room(room_id: str, player_id: str, voice_room: str | None) -> bool:
    """Return whether a player may join a public or private voice room now."""
    room = room_store.get_room(room_id)
    sender = find_player(room.players, player_id) if room else None
    if room is None or sender is None or voice_room is None:
        return voice_room is None
    if sender.is_storyteller or room.phase != "night":
        return True
    # Night: players cannot roam voice rooms. Private calls only exist when the
    # storyteller is one of the two parties (i.e. the storyteller called them);
    # public rooms only stay reachable when night voice is explicitly allowed.
    if ":private:" in voice_room:
        storyteller = next((player for player in room.players if player.is_storyteller), None)
        return storyteller is not None and storyteller.id in voice_room.split(":private:")
    return room.allow_public_voice_during_night
