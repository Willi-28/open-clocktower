import unittest

from app.db.models import PlayerModel
from app.game.rules import can_change_seats, claim_seat_index, has_execution_votes, required_execution_votes
from app.game.store import RoomStore


class FlushRecorder:
    """Tiny session stand-in that records whether seat compaction flushed temps."""

    def __init__(self) -> None:
        self.flushed = False

    def flush(self) -> None:
        """Record a flush without touching a real database."""
        self.flushed = True


def seated_player(player_id: str, seat_index: int) -> PlayerModel:
    """Build a minimal player row for seat-compaction unit tests."""
    return PlayerModel(id=player_id, room_id="room", display_name=player_id, seat_index=seat_index, secret="secret")


class GameRulesTest(unittest.TestCase):
    def test_claim_seat_allows_empty_seat(self) -> None:
        self.assertEqual(claim_seat_index(2, 5, {0, 1}), 2)

    def test_claim_seat_rejects_occupied_or_out_of_range_seat(self) -> None:
        with self.assertRaisesRegex(ValueError, "already occupied"):
            claim_seat_index(1, 5, {1})
        with self.assertRaisesRegex(ValueError, "exceeds"):
            claim_seat_index(5, 5, set())

    def test_execution_vote_threshold_uses_half_rounded_up(self) -> None:
        self.assertEqual(required_execution_votes(5), 3)
        self.assertEqual(required_execution_votes(6), 3)
        self.assertTrue(has_execution_votes(5, 3))
        self.assertFalse(has_execution_votes(5, 2))

    def test_seats_reopen_after_board_is_shown(self) -> None:
        self.assertTrue(can_change_seats("lobby", False))
        self.assertFalse(can_change_seats("day", False))
        self.assertTrue(can_change_seats("day", True))

    def test_seat_compaction_removes_free_seat_before_occupied_tail(self) -> None:
        players = [seated_player("a", 0), seated_player("b", 2), seated_player("c", 4)]
        session = FlushRecorder()

        RoomStore()._compact_seats(session, players, old_count=5, new_count=4)

        self.assertTrue(session.flushed)
        self.assertEqual([player.seat_index for player in players], [0, 2, 3])

    def test_seat_compaction_reports_when_no_free_seat_exists(self) -> None:
        players = [seated_player(str(index), index) for index in range(5)]

        with self.assertRaisesRegex(ValueError, "No free seats available"):
            RoomStore()._compact_seats(FlushRecorder(), players, old_count=5, new_count=4)


if __name__ == "__main__":
    unittest.main()
