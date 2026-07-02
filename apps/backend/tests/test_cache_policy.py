import unittest

from app.main import cache_control_for_path


class CachePolicyTest(unittest.TestCase):
    def test_hashed_assets_are_cached_immutably(self) -> None:
        self.assertEqual(
            cache_control_for_path("/assets/index-a1b2c3.js"),
            "public, max-age=31536000, immutable",
        )

    def test_frontend_entry_points_are_never_stored(self) -> None:
        expected = "no-cache, no-store, must-revalidate"
        self.assertEqual(cache_control_for_path("/"), expected)
        self.assertEqual(cache_control_for_path("/index.html"), expected)
        self.assertEqual(cache_control_for_path("/rooms/example"), expected)

    def test_runtime_config_is_never_stored(self) -> None:
        self.assertEqual(cache_control_for_path("/api/client-config"), "no-store")

    def test_other_api_routes_keep_their_own_policy(self) -> None:
        self.assertIsNone(cache_control_for_path("/api/health"))


if __name__ == "__main__":
    unittest.main()
