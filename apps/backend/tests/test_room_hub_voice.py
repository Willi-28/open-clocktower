import asyncio
import json
import unittest

from app.websocket.room_hub import RoomHub


class FakeWebSocket:
    """Records what the hub sends, standing in for a browser connection."""

    def __init__(self) -> None:
        self.sent: list[dict] = []

    async def send_text(self, message: str) -> None:
        self.sent.append(json.loads(message))


def hub_with_connections(player_ids: list[str | None]) -> tuple[RoomHub, dict[str | None, FakeWebSocket]]:
    """Build a hub with live connections.

    The only public way in is connect(), which accepts a real WebSocket and hits
    the database, so the in-memory maps are populated directly here.
    """
    hub = RoomHub()
    sockets = {player_id: FakeWebSocket() for player_id in player_ids}
    hub._rooms["room"] = {socket: player_id for player_id, socket in sockets.items()}
    return hub, sockets


class GatherEveryoneInVoiceRoomTest(unittest.TestCase):
    def test_moves_every_connected_player_including_the_storyteller(self) -> None:
        hub, sockets = hub_with_connections(["st", "alice", "bob"])
        # Night state: the storyteller is in a private call, bob is in no room.
        hub._voice_rooms["room"] = {"st": "alice:private:st", "alice": "alice:private:st"}

        moved = asyncio.run(hub.gather_everyone_in_voice_room("room", "Town Square"))

        self.assertEqual(moved, ["alice", "bob", "st"])
        self.assertEqual(
            hub._voice_rooms["room"],
            {"st": "Town Square", "alice": "Town Square", "bob": "Town Square"},
        )

    def test_moved_players_are_told_so_their_clients_can_follow(self) -> None:
        hub, sockets = hub_with_connections(["alice", "bob"])
        # alice is already gathered; only bob should hear about the move.
        hub._voice_rooms["room"] = {"alice": "Town Square"}

        moved = asyncio.run(hub.gather_everyone_in_voice_room("room", "Town Square"))

        self.assertEqual(moved, ["bob"])
        self.assertEqual(sockets["alice"].sent, [])
        self.assertEqual(
            sockets["bob"].sent,
            [{"type": "voice.moved", "payload": {"voiceRoom": "Town Square"}}],
        )

    def test_unauthenticated_spectators_are_not_placed_in_voice(self) -> None:
        hub, _ = hub_with_connections([None])

        moved = asyncio.run(hub.gather_everyone_in_voice_room("room", "Town Square"))

        self.assertEqual(moved, [])
        self.assertEqual(hub._voice_rooms["room"], {})

    def test_a_room_without_connections_is_a_no_op(self) -> None:
        hub = RoomHub()

        self.assertEqual(asyncio.run(hub.gather_everyone_in_voice_room("room", "Town Square")), [])


if __name__ == "__main__":
    unittest.main()
