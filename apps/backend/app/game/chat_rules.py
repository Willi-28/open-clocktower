"""Private chat permission rules.

This module decides who can message whom: storytellers can talk to everyone,
while normal players are limited to adjacent seated neighbors.
"""

from .room_state import Player, RoomState


def find_player(players: list[Player], player_id: str) -> Player | None:
    """Find one player snapshot by id in a room player list."""
    return next((player for player in players if player.id == player_id), None)


def can_chat(room: RoomState, from_player_id: str, to_player_id: str) -> bool:
    """Return whether one player is allowed to send a private chat message to another."""
    sender = find_player(room.players, from_player_id)
    recipient = find_player(room.players, to_player_id)
    if sender is None or recipient is None or sender.id == recipient.id:
        return False
    if sender.is_storyteller or recipient.is_storyteller:
        return True
    if sender.seat_index is None or recipient.seat_index is None:
        return False
    left_seat_index = (sender.seat_index - 1 + room.seat_count) % room.seat_count
    right_seat_index = (sender.seat_index + 1) % room.seat_count
    return recipient.seat_index in {left_seat_index, right_seat_index}
