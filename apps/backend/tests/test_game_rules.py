import unittest

from app.game.rules import can_change_seats, claim_seat_index, has_execution_votes, required_execution_votes


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


if __name__ == "__main__":
    unittest.main()
