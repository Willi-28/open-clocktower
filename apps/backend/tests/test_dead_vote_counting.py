import unittest

from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.models import NominationModel, PlayerModel, RoomModel, VoteModel
from app.db.session import Base
from app.game.room_state import VoteRequest
import app.game.store as store_module
from app.game.store import RoomStore


class DeadVoteCountingTest(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.session_factory = sessionmaker(bind=self.engine, autoflush=False, expire_on_commit=False)
        self.original_session_factory = store_module.SessionLocal
        store_module.SessionLocal = self.session_factory
        self.store = RoomStore()
        with self.session_factory() as session:
            session.add(RoomModel(id="room", name="Test", seat_count=5, phase="day"))
            session.add_all(
                [
                    PlayerModel(id="nominee", room_id="room", display_name="Nominee", seat_index=0, secret="n"),
                    PlayerModel(
                        id="dead",
                        room_id="room",
                        display_name="Dead",
                        seat_index=1,
                        status="dead",
                        has_dead_vote=True,
                        secret="d",
                    ),
                    PlayerModel(id="alive", room_id="room", display_name="Alive", seat_index=2, secret="a"),
                    PlayerModel(
                        id="storyteller",
                        room_id="room",
                        display_name="Storyteller",
                        seat_index=None,
                        is_storyteller=True,
                        secret="s",
                    ),
                ]
            )
            session.add(
                NominationModel(
                    id="nomination",
                    room_id="room",
                    nominator_id="alive",
                    nominee_id="nominee",
                )
            )
            session.commit()

    def tearDown(self) -> None:
        store_module.SessionLocal = self.original_session_factory
        self.engine.dispose()

    def dead_vote_available(self) -> bool:
        with self.session_factory() as session:
            return bool(session.get(PlayerModel, "dead").has_dead_vote)

    def test_dead_player_can_toggle_until_vote_is_counted(self) -> None:
        self.store.cast_vote("room", VoteRequest(player_id="dead", value=True), "d")
        self.assertTrue(self.dead_vote_available())

        self.store.cast_vote("room", VoteRequest(player_id="dead", value=False), "d")
        self.store.cast_vote("room", VoteRequest(player_id="dead", value=True), "d")
        self.assertIsNone(self.store.consume_counted_dead_votes("room", 0))
        self.assertTrue(self.dead_vote_available())

        self.assertIsNotNone(self.store.consume_counted_dead_votes("room", 1))
        self.assertFalse(self.dead_vote_available())

        self.store.cast_vote("room", VoteRequest(player_id="dead", value=False), "d")
        with self.assertRaisesRegex(ValueError, "no vote remaining"):
            self.store.cast_vote("room", VoteRequest(player_id="dead", value=True), "d")

    def test_lowered_dead_hand_is_not_consumed_by_count(self) -> None:
        self.store.cast_vote("room", VoteRequest(player_id="dead", value=True), "d")
        self.store.cast_vote("room", VoteRequest(player_id="dead", value=False), "d")

        self.assertIsNone(self.store.consume_counted_dead_votes("room", 1))
        self.assertTrue(self.dead_vote_available())
        with self.session_factory() as session:
            vote = session.scalar(select(VoteModel).where(VoteModel.player_id == "dead"))
            self.assertIsNotNone(vote)
            self.assertFalse(vote.value)


if __name__ == "__main__":
    unittest.main()
