"""In-process sliding-window rate limiting.

Used for the abuse limits that do not need a shared store: room create/join
attempts per client IP and chat bursts per player. Keys that fall out of their
window are swept, so a limiter keyed by something attacker-influenced (a client
IP) cannot grow the map without bound.
"""

from collections.abc import Hashable
from time import monotonic


class SlidingWindowLimiter:
    """Allow at most `limit` events per key within a rolling time window."""

    def __init__(self, limit: int, window_seconds: float) -> None:
        """Configure how many events one key may record per window."""
        self._limit = limit
        self._window_seconds = window_seconds
        self._events: dict[Hashable, list[float]] = {}
        self._next_sweep_at = 0.0

    def allow(self, key: Hashable) -> bool:
        """Record one event for `key` and return whether it stays within budget."""
        now = monotonic()
        self._sweep(now)
        recent = [stamp for stamp in self._events.get(key, ()) if now - stamp < self._window_seconds]
        if len(recent) >= self._limit:
            # Keep the pruned list so a blocked caller still ages out normally.
            self._events[key] = recent
            return False
        recent.append(now)
        self._events[key] = recent
        return True

    def _sweep(self, now: float) -> None:
        """Drop keys whose most recent event is older than the window."""
        if now < self._next_sweep_at:
            return
        self._next_sweep_at = now + self._window_seconds
        for key, stamps in list(self._events.items()):
            if not stamps or now - stamps[-1] >= self._window_seconds:
                del self._events[key]

    def tracked_keys(self) -> int:
        """Return how many keys are currently held (used by tests)."""
        return len(self._events)
