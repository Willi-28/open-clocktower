from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.game.chat_rules import can_chat, find_player
from app.game.store import room_store
from app.websocket.room_hub import room_hub

router = APIRouter()


@router.websocket("/ws/rooms/{room_id}")
async def room_socket(websocket: WebSocket, room_id: str):
    # Keeps the room connection open and handles lightweight private chat and voice events.
    player_id = websocket.query_params.get("player_id")
    room = room_store.get_room(room_id)
    if room is None:
        await websocket.close(code=1008)
        return
    if player_id and find_player(room.players, player_id) is None:
        player_id = None
    await room_hub.connect(room_id, websocket, player_id)
    if player_id:
        room = room_store.set_player_connection(room_id, player_id, True)
        if room is not None:
            await room_hub.broadcast_state(room)
    await websocket.send_json({"type": "connected", "payload": {"roomId": room_id}})
    try:
        while True:
            message = await websocket.receive_json()
            if message.get("type") == "chat.send" and player_id:
                await _handle_chat_message(room_id, player_id, message.get("payload", {}))
            if message.get("type") == "hand.set" and player_id:
                payload = message.get("payload", {})
                await room_hub.set_hand_raised(room_id, player_id, bool(payload.get("isRaised")))
            if message.get("type") == "voice.join" and player_id:
                payload = message.get("payload", {})
                voice_room = str(payload.get("voiceRoom", "")).strip() or None
                if _can_join_voice_room(room_id, player_id, voice_room):
                    await room_hub.set_voice_room(room_id, player_id, voice_room)
            if message.get("type") == "voice.leave" and player_id:
                await room_hub.set_voice_room(room_id, player_id, None)
            if message.get("type") == "voice.call.request" and player_id:
                await _forward_voice_call(room_id, player_id, message.get("payload", {}), "voice.call.request")
            if message.get("type") == "voice.call.accept" and player_id:
                await _forward_voice_call(room_id, player_id, message.get("payload", {}), "voice.call.accept")
            if message.get("type") == "voice.call.reject" and player_id:
                await _forward_voice_reject(room_id, player_id, message.get("payload", {}))
            if message.get("type") == "voice.signal" and player_id:
                await _forward_voice_signal(room_id, player_id, message.get("payload", {}))
            if message.get("type") == "timer.set" and player_id:
                await _handle_timer(room_id, player_id, message.get("payload", {}))
            if message.get("type") == "bell.ring" and player_id:
                await _handle_bell(room_id, player_id)
            if message.get("type") == "vote_count.set" and player_id:
                await _handle_vote_count(room_id, player_id, message.get("payload", {}))
    except WebSocketDisconnect:
        room_hub.disconnect(room_id, websocket)
        if player_id and not room_hub.has_player_connection(room_id, player_id):
            await room_hub.set_hand_raised(room_id, player_id, False)
            await room_hub.set_voice_room(room_id, player_id, None)
            room = room_store.set_player_connection(room_id, player_id, False)
            if room is not None:
                await room_hub.broadcast_state(room)


async def _handle_chat_message(room_id: str, player_id: str, payload: dict) -> None:
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
    if room and sender and target_player_id is None and text:
        await room_hub.broadcast_room_event(
            room_id,
            {
                "type": "chat.message",
                "payload": {"fromPlayerId": player_id, "toPlayerId": None, "text": text[:1000]},
            },
        )


async def _forward_voice_call(room_id: str, player_id: str, payload: dict, event_type: str) -> None:
    target_player_id = payload.get("toPlayerId")
    voice_room = str(payload.get("voiceRoom", "")).strip()
    if isinstance(target_player_id, str) and voice_room and _players_are_in_room(room_id, player_id, target_player_id):
        await room_hub.send_to_players(
            room_id,
            {target_player_id},
            {"type": event_type, "payload": {"fromPlayerId": player_id, "voiceRoom": voice_room}},
        )


async def _forward_voice_reject(room_id: str, player_id: str, payload: dict) -> None:
    target_player_id = payload.get("toPlayerId")
    if isinstance(target_player_id, str) and _players_are_in_room(room_id, player_id, target_player_id):
        await room_hub.send_to_players(
            room_id,
            {target_player_id},
            {"type": "voice.call.reject", "payload": {"fromPlayerId": player_id}},
        )


async def _forward_voice_signal(room_id: str, player_id: str, payload: dict) -> None:
    target_player_id = payload.get("toPlayerId")
    if isinstance(target_player_id, str) and _players_are_in_room(room_id, player_id, target_player_id):
        await room_hub.send_voice_signal(
            room_id,
            target_player_id,
            {"type": "voice.signal", "payload": {"fromPlayerId": player_id, "signal": payload.get("signal")}},
        )


async def _handle_timer(room_id: str, player_id: str, payload: dict) -> None:
    if _is_storyteller(room_id, player_id):
        await room_hub.set_timer(
            room_id,
            int(payload.get("durationSeconds", 300)),
            int(payload.get("remainingSeconds", 300)),
            bool(payload.get("isRunning")),
        )


async def _handle_bell(room_id: str, player_id: str) -> None:
    if _is_storyteller(room_id, player_id):
        await room_hub.broadcast_room_event(room_id, {"type": "bell.ring", "payload": {"fromPlayerId": player_id}})


async def _handle_vote_count(room_id: str, player_id: str, payload: dict) -> None:
    if _is_storyteller(room_id, player_id):
        await room_hub.set_vote_count(room_id, int(payload.get("index", -1)), bool(payload.get("isRunning")))


def _is_storyteller(room_id: str, player_id: str) -> bool:
    room = room_store.get_room(room_id)
    sender = find_player(room.players, player_id) if room else None
    return bool(sender and sender.is_storyteller)


def _players_are_in_room(room_id: str, player_id: str, target_player_id: str) -> bool:
    room = room_store.get_room(room_id)
    if room is None:
        return False
    return find_player(room.players, player_id) is not None and find_player(room.players, target_player_id) is not None


def _can_join_voice_room(room_id: str, player_id: str, voice_room: str | None) -> bool:
    room = room_store.get_room(room_id)
    sender = find_player(room.players, player_id) if room else None
    if room is None or sender is None or voice_room is None:
        return voice_room is None
    if sender.is_storyteller or room.phase != "night" or room.allow_public_voice_during_night:
        return True
    return ":private:" in voice_room
