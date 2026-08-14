import unittest

from app.game.room_state import GamePhase, Player, RoomState
from app.game.voice_rules import can_join_voice_room, private_voice_room_for


def player(player_id: str, is_storyteller: bool = False) -> Player:
    return Player(id=player_id, display_name=player_id, seat_index=None, is_storyteller=is_storyteller)


def room(
    players: list[Player],
    phase: GamePhase = GamePhase.DAY,
    allow_public_voice_during_night: bool = False,
) -> RoomState:
    return RoomState(
        id="room",
        name="Room",
        seat_count=7,
        phase=phase,
        allow_public_voice_during_night=allow_public_voice_during_night,
        players=players,
        created_at="",
        updated_at="",
    )


class VoiceRulesTest(unittest.TestCase):
    def test_private_room_id_is_order_independent(self) -> None:
        self.assertEqual(private_voice_room_for("b", "a"), private_voice_room_for("a", "b"))

    def test_call_parties_may_join_their_own_private_room(self) -> None:
        state = room([player("st", True), player("a"), player("b")])
        call = private_voice_room_for("a", "b")

        self.assertTrue(can_join_voice_room(state, player("a"), call))
        self.assertTrue(can_join_voice_room(state, player("b"), call))

    def test_outsider_cannot_join_someone_elses_private_call(self) -> None:
        state = room([player("st", True), player("a"), player("b"), player("eavesdropper")])
        call = private_voice_room_for("a", "b")

        self.assertFalse(can_join_voice_room(state, player("eavesdropper"), call))

    def test_storyteller_cannot_join_a_call_they_are_not_part_of(self) -> None:
        state = room([player("st", True), player("a"), player("b")])
        call = private_voice_room_for("a", "b")

        self.assertFalse(can_join_voice_room(state, player("st", True), call))

    def test_outsider_cannot_join_a_storyteller_call_at_night(self) -> None:
        state = room([player("st", True), player("a"), player("spy")], phase=GamePhase.NIGHT)
        call = private_voice_room_for("st", "a")

        self.assertTrue(can_join_voice_room(state, player("a"), call))
        self.assertFalse(can_join_voice_room(state, player("spy"), call))

    def test_players_cannot_pair_up_privately_at_night(self) -> None:
        state = room([player("st", True), player("a"), player("b")], phase=GamePhase.NIGHT)
        call = private_voice_room_for("a", "b")

        self.assertFalse(can_join_voice_room(state, player("a"), call))

    def test_malformed_private_room_names_are_rejected(self) -> None:
        state = room([player("st", True), player("a"), player("b")])

        self.assertFalse(can_join_voice_room(state, player("a"), "a:private:b:private:a"))
        self.assertFalse(can_join_voice_room(state, player("a"), ":private:"))

    def test_public_rooms_follow_the_night_setting(self) -> None:
        day = room([player("st", True), player("a")])
        night = room([player("st", True), player("a")], phase=GamePhase.NIGHT)
        open_night = room([player("st", True), player("a")], phase=GamePhase.NIGHT, allow_public_voice_during_night=True)

        self.assertTrue(can_join_voice_room(day, player("a"), "Town Square"))
        self.assertFalse(can_join_voice_room(night, player("a"), "Town Square"))
        self.assertTrue(can_join_voice_room(open_night, player("a"), "Town Square"))
        self.assertTrue(can_join_voice_room(night, player("st", True), "Town Square"))


if __name__ == "__main__":
    unittest.main()
