import unittest

from app.game.room_state import Player, RoomState
from app.game.chat_rules import can_chat


def player(player_id: str, seat_index: int | None, is_storyteller: bool = False) -> Player:
    return Player(
        id=player_id,
        display_name=player_id,
        seat_index=seat_index,
        is_storyteller=is_storyteller,
    )


def room(players: list[Player], seat_count: int = 7) -> RoomState:
    return RoomState(
        id="room",
        name="Room",
        seat_count=seat_count,
        players=players,
        created_at="",
        updated_at="",
    )


class ChatRulesTest(unittest.TestCase):
    def test_direct_adjacent_players_can_chat(self) -> None:
        state = room([player("left", 1), player("sender", 2), player("right", 3)])

        self.assertTrue(can_chat(state, "sender", "left"))
        self.assertTrue(can_chat(state, "sender", "right"))

    def test_empty_seats_are_not_skipped(self) -> None:
        state = room([player("far-left", 0), player("sender", 2), player("far-right", 4)])

        self.assertFalse(can_chat(state, "sender", "far-left"))
        self.assertFalse(can_chat(state, "sender", "far-right"))

    def test_storyteller_can_chat_with_players(self) -> None:
        state = room([player("st", None, True), player("sender", 2), player("far", 5)])

        self.assertTrue(can_chat(state, "sender", "st"))
        self.assertTrue(can_chat(state, "st", "far"))


if __name__ == "__main__":
    unittest.main()
