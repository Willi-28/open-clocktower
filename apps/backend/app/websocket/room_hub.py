"""In-memory realtime room hub.

The hub tracks active WebSocket connections and ephemeral realtime state such
as raised hands, voice rooms, synced timers, and vote counters.
"""

import json
from datetime import datetime, timezone

from fastapi import WebSocket

from app.game.chat_rules import find_player
from app.game.room_state import RoomState
from app.game.store import room_store


class RoomHub:
    """Coordinate live events for all connected room WebSockets."""

    # Tracks open WebSocket connections per room.
    # REST endpoints call broadcast_state so every browser updates live.
    def __init__(self) -> None:
        """Create empty realtime state maps for every live room."""
        self._rooms: dict[str, dict[WebSocket, str | None]] = {}
        self._raised_hands: dict[str, set[str]] = {}
        self._muted_players: dict[str, set[str]] = {}
        self._deafened_players: dict[str, set[str]] = {}
        self._voice_rooms: dict[str, dict[str, str]] = {}
        self._timers: dict[str, dict[str, int | bool | str | None]] = {}
        self._vote_counts: dict[str, dict[str, int | bool]] = {}

    async def connect(self, room_id: str, websocket: WebSocket, player_id: str | None) -> None:
        """Accept a WebSocket and send the current ephemeral room state."""
        # Accepts a browser connection for a specific room.
        await websocket.accept()
        self._rooms.setdefault(room_id, {})[websocket] = player_id
        is_night, storyteller_id = room_store.night_voice_info(room_id)
        participants = self._voice_participants(room_id)
        if is_night:
            participants = self._night_visible_participants(room_id, participants, player_id, storyteller_id)
        await websocket.send_json({"type": "hand.state", "payload": {"playerIds": sorted(self._raised_hands.get(room_id, set()))}})
        await websocket.send_json({"type": "mute.state", "payload": {"playerIds": sorted(self._muted_players.get(room_id, set()))}})
        await websocket.send_json({"type": "deafen.state", "payload": {"playerIds": sorted(self._deafened_players.get(room_id, set()))}})
        await websocket.send_json({"type": "voice.state", "payload": {"participants": participants}})
        await websocket.send_json({"type": "timer.state", "payload": self._timer_state(room_id)})
        await websocket.send_json({"type": "vote_count.state", "payload": self._vote_count_state(room_id)})

    def disconnect(self, room_id: str, websocket: WebSocket) -> None:
        """Remove a closed WebSocket from the tracked room connections."""
        # Removes closed connections so later broadcasts do not send to them.
        connections = self._rooms.get(room_id)
        if connections is None:
            return
        connections.pop(websocket, None)
        if not connections:
            self._rooms.pop(room_id, None)

    def has_player_connection(self, room_id: str, player_id: str) -> bool:
        """Return whether a player still has at least one live WebSocket."""
        return player_id in set(self._rooms.get(room_id, {}).values())

    async def _broadcast_text(self, room_id: str, payload: dict) -> None:
        """Serialize one payload once and send it to every socket in a room."""
        # send_json re-serializes per socket; serializing once here matters because
        # the room snapshot can carry many large base64 avatar data URLs.
        message = json.dumps(payload)
        for websocket in list(self._rooms.get(room_id, {})):
            try:
                await websocket.send_text(message)
            except RuntimeError:
                self.disconnect(room_id, websocket)

    async def broadcast_state(self, room: RoomState) -> None:
        """Send a persisted room snapshot to every connected browser."""
        # Sends the current room snapshot to all connected clients in that room.
        await self._broadcast_text(room.id, {"type": "game.updated", "payload": room.model_dump(mode="json")})

    async def broadcast_deleted(self, room_id: str) -> None:
        """Notify clients that a room was deleted and clear its ephemeral state."""
        # Tells connected clients that the current room no longer exists.
        await self._broadcast_text(room_id, {"type": "room.deleted", "payload": {"roomId": room_id}})
        self._raised_hands.pop(room_id, None)
        self._muted_players.pop(room_id, None)
        self._deafened_players.pop(room_id, None)
        self._voice_rooms.pop(room_id, None)
        self._timers.pop(room_id, None)
        self._vote_counts.pop(room_id, None)

    async def send_to_players(self, room_id: str, player_ids: set[str], payload: dict) -> None:
        """Send one event only to WebSockets owned by selected players."""
        # Sends private events only to the browsers owned by the addressed players.
        message = json.dumps(payload)
        for websocket, connected_player_id in list(self._rooms.get(room_id, {}).items()):
            if connected_player_id not in player_ids:
                continue
            try:
                await websocket.send_text(message)
            except RuntimeError:
                self.disconnect(room_id, websocket)

    async def kick_player(self, room_id: str, player_id: str, reason: str) -> None:
        """Notify a kicked player and remove their ephemeral room state."""
        await self.send_to_players(
            room_id,
            {player_id},
            {"type": "room.kicked", "payload": {"roomId": room_id, "reason": reason}},
        )
        self._raised_hands.setdefault(room_id, set()).discard(player_id)
        self._muted_players.setdefault(room_id, set()).discard(player_id)
        self._deafened_players.setdefault(room_id, set()).discard(player_id)
        self._voice_rooms.setdefault(room_id, {}).pop(player_id, None)
        await self.broadcast_room_event(
            room_id,
            {"type": "hand.state", "payload": {"playerIds": sorted(self._raised_hands.get(room_id, set()))}},
        )
        await self.broadcast_voice_state(room_id)

    async def set_hand_raised(self, room_id: str, player_id: str, is_raised: bool) -> None:
        """Update a player's raised-hand status and broadcast the hand list."""
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

    async def set_muted(self, room_id: str, player_id: str, is_muted: bool) -> None:
        """Track a player's microphone-mute state and broadcast the muted list."""
        room = room_store.get_room(room_id)
        if room is None or find_player(room.players, player_id) is None:
            return
        muted = self._muted_players.setdefault(room_id, set())
        if is_muted:
            muted.add(player_id)
        else:
            muted.discard(player_id)
        await self.broadcast_room_event(room_id, {"type": "mute.state", "payload": {"playerIds": sorted(muted)}})

    async def set_deafened(self, room_id: str, player_id: str, is_deafened: bool) -> None:
        """Track a player's deafen (headphone-mute) state and broadcast the list."""
        room = room_store.get_room(room_id)
        if room is None or find_player(room.players, player_id) is None:
            return
        deafened = self._deafened_players.setdefault(room_id, set())
        if is_deafened:
            deafened.add(player_id)
        else:
            deafened.discard(player_id)
        await self.broadcast_room_event(room_id, {"type": "deafen.state", "payload": {"playerIds": sorted(deafened)}})

    async def broadcast_room_event(self, room_id: str, payload: dict) -> None:
        """Send a lightweight realtime event to every connection in a room."""
        # Sends a lightweight event to every connected browser in the room.
        await self._broadcast_text(room_id, payload)

    async def set_voice_room(self, room_id: str, player_id: str, voice_room: str | None) -> None:
        """Track which voice room a player joined and broadcast voice presence."""
        # Tracks which voice room each connected player joined.
        room_voice = self._voice_rooms.setdefault(room_id, {})
        if room_voice.get(player_id) == voice_room:
            return
        if voice_room:
            room_voice[player_id] = voice_room
        else:
            room_voice.pop(player_id, None)
            # Mute/deafen status is only meaningful inside a voice room; clear on exit.
            muted = self._muted_players.get(room_id)
            if muted and player_id in muted:
                muted.discard(player_id)
                await self.broadcast_room_event(room_id, {"type": "mute.state", "payload": {"playerIds": sorted(muted)}})
            deafened = self._deafened_players.get(room_id)
            if deafened and player_id in deafened:
                deafened.discard(player_id)
                await self.broadcast_room_event(room_id, {"type": "deafen.state", "payload": {"playerIds": sorted(deafened)}})
        await self.broadcast_voice_state(room_id)

    async def close_public_voice_rooms(self, room_id: str) -> None:
        """Remove players from public voice rooms when night restrictions apply."""
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
        await self.broadcast_voice_state(room_id)

    async def send_voice_signal(self, room_id: str, target_player_id: str, payload: dict) -> None:
        """Forward one WebRTC signaling payload to a target player."""
        await self.send_to_players(room_id, {target_player_id}, payload)

    async def broadcast_voice_state(self, room_id: str) -> None:
        """Send voice presence; at night each player only learns their own room.

        Day (and the storyteller at any time) gets the full participant list.
        At night everyone else must not be able to tell who is absent from a
        room or privately calling - not even on the wire.
        """
        is_night, storyteller_id = room_store.night_voice_info(room_id)
        participants = self._voice_participants(room_id)
        if not is_night:
            await self.broadcast_room_event(room_id, {"type": "voice.state", "payload": {"participants": participants}})
            return
        for websocket, player_id in list(self._rooms.get(room_id, {}).items()):
            visible = self._night_visible_participants(room_id, participants, player_id, storyteller_id)
            try:
                await websocket.send_text(json.dumps({"type": "voice.state", "payload": {"participants": visible}}))
            except RuntimeError:
                self.disconnect(room_id, websocket)

    def _night_visible_participants(
        self,
        room_id: str,
        participants: list[dict[str, str]],
        viewer_id: str | None,
        storyteller_id: str | None,
    ) -> list[dict[str, str]]:
        """Reduce voice presence to what one viewer may see during night."""
        if viewer_id is not None and viewer_id == storyteller_id:
            return participants
        own_room = self._voice_rooms.get(room_id, {}).get(viewer_id) if viewer_id else None
        if own_room is None:
            return []
        return [participant for participant in participants if participant["voiceRoom"] == own_room]

    async def set_timer(self, room_id: str, duration_seconds: int, remaining_seconds: int, is_running: bool) -> None:
        """Store and broadcast the storyteller-controlled discussion timer."""
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
        """Store and broadcast the public automatic vote counter state."""
        # Storyteller-controlled public vote counter. Clients use it to animate
        # the same clockwise clock hand and play the same tick.
        self._vote_counts[room_id] = {"index": max(-1, index), "isRunning": is_running}
        await self.broadcast_room_event(room_id, {"type": "vote_count.state", "payload": self._vote_count_state(room_id)})

    def _timer_state(self, room_id: str) -> dict[str, int | bool | str | None]:
        """Return a timer snapshot with elapsed running time applied."""
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
        """Return the current vote counter state for one room."""
        return self._vote_counts.get(room_id, {"index": -1, "isRunning": False})

    def _voice_participants(self, room_id: str) -> list[dict[str, str]]:
        """Return all players currently present in voice rooms."""
        return [
            {"playerId": player_id, "voiceRoom": voice_room}
            for player_id, voice_room in self._voice_rooms.get(room_id, {}).items()
        ]


room_hub = RoomHub()
