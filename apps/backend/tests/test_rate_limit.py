import unittest

from app.rate_limit import SlidingWindowLimiter


class SlidingWindowLimiterTest(unittest.TestCase):
    def test_allows_up_to_the_limit_then_blocks(self) -> None:
        limiter = SlidingWindowLimiter(limit=3, window_seconds=60.0)

        self.assertEqual([limiter.allow("ip") for _ in range(4)], [True, True, True, False])

    def test_keys_are_independent(self) -> None:
        limiter = SlidingWindowLimiter(limit=1, window_seconds=60.0)

        self.assertTrue(limiter.allow("a"))
        self.assertTrue(limiter.allow("b"))
        self.assertFalse(limiter.allow("a"))

    def test_budget_returns_after_the_window(self) -> None:
        limiter = SlidingWindowLimiter(limit=1, window_seconds=0.0)

        self.assertTrue(limiter.allow("ip"))
        self.assertTrue(limiter.allow("ip"))

    def test_expired_keys_are_swept_so_the_map_cannot_grow_forever(self) -> None:
        # An attacker rotating the client IP must not be able to pin one map
        # entry per spoofed address for the lifetime of the process.
        limiter = SlidingWindowLimiter(limit=5, window_seconds=0.0)
        for index in range(50):
            limiter.allow(f"ip-{index}")

        self.assertLessEqual(limiter.tracked_keys(), 1)


if __name__ == "__main__":
    unittest.main()
