from datetime import datetime, timezone

from fastapi import WebSocket

from app.game.chat_rules import find_player
from app.game.room_state import RoomState
from app.game.store import room_store


class RoomHub:
    # Tracks open WebSocket connections per room.
    # REST endpoints call broadcast_state so every browser updates live.
    def __init__(self) -> None:
        self._rooms: dict[str, dict[WebSocket, str | None]] = {}
        self._raised_hands: dict[str, set[str]] = {}
        self._voice_rooms: dict[str, dict[str, str]] = {}
        self._timers: dict[str, dict[str, int | bool | str | None]] = {}
        self._vote_counts: dict[str, dict[str, int | bool]] = {}

    async def connect(self, room_id: str, websocket: WebSocket, player_id: str | None) -> None:
        # Accepts a browser connection for a specific room.
        await websocket.accept()
        self._rooms.setdefault(room_id, {})[websocket] = player_id
        await websocket.send_json({"type": "hand.state", "payload": {"playerIds": sorted(self._raised_hands.get(room_id, set()))}})
        await websocket.send_json({"type": "voice.state", "payload": {"participants": self._voice_participants(room_id)}})
        await websocket.send_json({"type": "timer.state", "payload": self._timer_state(room_id)})
        await websocket.send_json({"type": "vote_count.state", "payload": self._vote_count_state(room_id)})

    def disconnect(self, room_id: str, websocket: WebSocket) -> None:
        # Removes closed connections so later broadcasts do not send to them.
        connections = self._rooms.get(room_id)
        if connections is None:
            return
        connections.pop(websocket, None)
        if not connections:
            self._rooms.pop(room_id, None)

    def has_player_connection(self, room_id: str, player_id: str) -> bool:
        return player_id in set(self._rooms.get(room_id, {}).values())

    async def broadcast_state(self, room: RoomState) -> None:
        # Sends the current room snapshot to all connected clients in that room.
        payload = {"type": "game.updated", "payload": room.model_dump(mode="json")}
        for websocket in list(self._rooms.get(room.id, {})):
            try:
                await websocket.send_json(payload)
            except RuntimeError:
                self.disconnect(room.id, websocket)

    async def broadcast_deleted(self, room_id: str) -> None:
        # Tells connected clients that the current room no longer exists.
        payload = {"type": "room.deleted", "payload": {"roomId": room_id}}
        for websocket in list(self._rooms.get(room_id, {})):
            try:
                await websocket.send_json(payload)
            except RuntimeError:
                self.disconnect(room_id, websocket)
        self._raised_hands.pop(room_id, None)
        self._voice_rooms.pop(room_id, None)
        self._timers.pop(room_id, None)
        self._vote_counts.pop(room_id, None)

    async def send_to_players(self, room_id: str, player_ids: set[str], payload: dict) -> None:
        # Sends private events only to the browsers owned by the addressed players.
        for websocket, connected_player_id in list(self._rooms.get(room_id, {}).items()):
            if connected_player_id not in player_ids:
                continue
            try:
                await websocket.send_json(payload)
            except RuntimeError:
                self.disconnect(room_id, websocket)

    async def kick_player(self, room_id: str, player_id: str, reason: str) -> None:
        await self.send_to_players(
            room_id,
            {player_id},
            {"type": "room.kicked", "payload": {"roomId": room_id, "reason": reason}},
        )
        self._raised_hands.setdefault(room_id, set()).discard(player_id)
        self._voice_rooms.setdefault(room_id, {}).pop(player_id, None)
        await self.broadcast_room_event(
            room_id,
            {"type": "hand.state", "payload": {"playerIds": sorted(self._raised_hands.get(room_id, set()))}},
        )
        await self.broadcast_room_event(
            room_id,
            {"type": "voice.state", "payload": {"participants": self._voice_participants(room_id)}},
        )

    async def set_hand_raised(self, room_id: str, player_id: str, is_raised: bool) -> None:
        # Hand raises are ephemeral room signals and reset when the backend restarts.
        room = room_store.get_room(room_id)
        if room is None or find_player(room.players, player_id) is None:
            return
        raised_hands = self._raised_hands.setdefault(room_id, set())
        if is_raised:
            raised_hands.add(player_id)
        else:
            raised_hands.discard(player_id)
        await self.broadcast_room_event(room_id, {"type": "hand.state", "payload": {"playerIds": sorted(raised_hands)}})

    async def broadcast_room_event(self, room_id: str, payload: dict) -> None:
        # Sends a lightweight event to every connected browser in the room.
        for websocket in list(self._rooms.get(room_id, {})):
            try:
                await websocket.send_json(payload)
            except RuntimeError:
                self.disconnect(room_id, websocket)

    async def set_voice_room(self, room_id: str, player_id: str, voice_room: str | None) -> None:
        # Tracks which voice room each connected player joined.
        room_voice = self._voice_rooms.setdefault(room_id, {})
        if room_voice.get(player_id) == voice_room:
            return
        if voice_room:
            room_voice[player_id] = voice_room
        else:
            room_voice.pop(player_id, None)
        await self.broadcast_room_event(
            room_id,
            {"type": "voice.state", "payload": {"participants": self._voice_participants(room_id)}},
        )

    async def close_public_voice_rooms(self, room_id: str) -> None:
        # Night restrictions only close public rooms; private storyteller calls stay active.
        room_voice = self._voice_rooms.setdefault(room_id, {})
        public_player_ids = [
            player_id
            for player_id, voice_room in room_voice.items()
            if ":private:" not in voice_room
        ]
        if not public_player_ids:
            return
        for player_id in public_player_ids:
            room_voice.pop(player_id, None)
        await self.broadcast_room_event(
            room_id,
            {"type": "voice.state", "payload": {"participants": self._voice_participants(room_id)}},
        )

    async def send_voice_signal(self, room_id: str, target_player_id: str, payload: dict) -> None:
        await self.send_to_players(room_id, {target_player_id}, payload)

    async def set_timer(self, room_id: str, duration_seconds: int, remaining_seconds: int, is_running: bool) -> None:
        duration = max(0, min(duration_seconds, 60 * 60))
        remaining = max(0, min(remaining_seconds, duration if duration > 0 else 60 * 60))
        self._timers[room_id] = {
            "durationSeconds": duration,
            "remainingSeconds": remaining,
            "isRunning": is_running,
            "startedAt": datetime.now(timezone.utc).isoformat() if is_running else None,
        }
        await self.broadcast_room_event(room_id, {"type": "timer.state", "payload": self._timer_state(room_id)})

    async def set_vote_count(self, room_id: str, index: int, is_running: bool) -> None:
        # Storyteller-controlled public vote counter. Clients use it to animate
        # the same clockwise clock hand and play the same tick.
        self._vote_counts[room_id] = {"index": max(-1, index), "isRunning": is_running}
        await self.broadcast_room_event(room_id, {"type": "vote_count.state", "payload": self._vote_count_state(room_id)})

    def _timer_state(self, room_id: str) -> dict[str, int | bool | str | None]:
        timer = self._timers.get(
            room_id,
            {
                "durationSeconds": 300,
                "remainingSeconds": 300,
                "isRunning": False,
                "startedAt": None,
            },
        )
        if timer.get("isRunning") and timer.get("startedAt"):
            try:
                started_at = datetime.fromisoformat(str(timer["startedAt"]))
                elapsed = int((datetime.now(timezone.utc) - started_at).total_seconds())
                remaining = max(0, int(timer["remainingSeconds"]) - elapsed)
                if remaining == 0:
                    timer = {**timer, "remainingSeconds": 0, "isRunning": False, "startedAt": None}
                    self._timers[room_id] = timer
                else:
                    return {**timer, "remainingSeconds": remaining, "startedAt": datetime.now(timezone.utc).isoformat()}
            except ValueError:
                timer = {**timer, "isRunning": False, "startedAt": None}
                self._timers[room_id] = timer
        return timer

    def _vote_count_state(self, room_id: str) -> dict[str, int | bool]:
        return self._vote_counts.get(room_id, {"index": -1, "isRunning": False})

    def _voice_participants(self, room_id: str) -> list[dict[str, str]]:
        return [
            {"playerId": player_id, "voiceRoom": voice_room}
            for player_id, voice_room in self._voice_rooms.get(room_id, {}).items()
        ]


room_hub = RoomHub()
