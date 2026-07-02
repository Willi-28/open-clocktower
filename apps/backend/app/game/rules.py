"""Pure game-rule helpers.

The functions here are intentionally small and side-effect free so the backend
and tests can validate seating and voting rules without touching the database.
"""

def claim_seat_index(
    seat_index: int | None,
    seat_count: int,
    occupied_seats: set[int],
) -> int | None:
    """Validate a requested seat and return the accepted seat index."""
    if seat_index is None:
        return None
    if seat_index >= seat_count:
        raise ValueError("seat_index exceeds room seat_count")
    if seat_index in occupied_seats:
        raise ValueError("seat_index is already occupied")
    return seat_index


def can_change_seats(phase: str, show_board: bool) -> bool:
    """Return whether players may take or leave seats in the current room state."""
    return phase == "lobby" or show_board


def required_execution_votes(living_player_count: int) -> int:
    """Calculate the yes votes required to execute a nominee."""
    return max(1, (living_player_count + 1) // 2)


def has_execution_votes(living_player_count: int, yes_vote_count: int) -> bool:
    """Return whether the current yes vote count reaches the execution threshold."""
    return yes_vote_count >= required_execution_votes(living_player_count)
