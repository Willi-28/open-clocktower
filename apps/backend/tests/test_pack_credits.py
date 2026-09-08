import json
import unittest

from app.game.character_packs import parse_character_pack

from test_character_packs import pack_bytes


def credits_for(manifest: dict[str, object]):
    _, _, credits = parse_character_pack(pack_bytes({"manifest.json": json.dumps(manifest)}))
    return credits


def manifest_with(credits: object = None, characters: list[dict[str, object]] | None = None) -> dict[str, object]:
    manifest: dict[str, object] = {
        "schemaVersion": 1,
        "name": "Community Pack",
        "characters": characters
        or [{"id": "seer", "name": "Seer", "team": "townsfolk", "category": "townsfolk", "ability": "See things."}],
    }
    if credits is not None:
        manifest["credits"] = credits
    return manifest


class PackCreditsTest(unittest.TestCase):
    def test_pack_without_credits_is_empty_but_keeps_the_name(self) -> None:
        credits = credits_for(manifest_with())

        self.assertEqual(credits.pack_name, "Community Pack")
        self.assertEqual(credits.entries, [])
        self.assertEqual(credits.author, "")

    def test_full_credits_block_is_read(self) -> None:
        credits = credits_for(
            manifest_with(
                {
                    "author": "Alice",
                    "url": "https://example.test/pack",
                    "license": "CC BY-SA 4.0",
                    "licenseUrl": "https://creativecommons.org/licenses/by-sa/4.0/",
                    "notice": "Please keep the attribution.",
                    "entries": [{"name": "Bob", "role": "Artwork", "url": "https://bob.example.test"}],
                }
            )
        )

        self.assertEqual(credits.author, "Alice")
        self.assertEqual(credits.license, "CC BY-SA 4.0")
        self.assertEqual(credits.notice, "Please keep the attribution.")
        self.assertEqual(len(credits.entries), 1)
        self.assertEqual(credits.entries[0].name, "Bob")
        self.assertEqual(credits.entries[0].role, "Artwork")

    def test_a_bare_string_becomes_a_verbatim_notice(self) -> None:
        credits = credits_for(manifest_with("Made by the community."))

        self.assertEqual(credits.notice, "Made by the community.")

    def test_non_http_credit_urls_are_dropped(self) -> None:
        # Pack ZIPs are user uploads and these URLs are rendered as links.
        credits = credits_for(
            manifest_with(
                {
                    "author": "Mallory",
                    "url": "javascript:alert(1)",
                    "licenseUrl": "data:text/html,<script>alert(1)</script>",
                    "entries": [{"name": "Eve", "url": "file:///etc/passwd"}],
                }
            )
        )

        self.assertIsNone(credits.url)
        self.assertIsNone(credits.license_url)
        self.assertIsNone(credits.entries[0].url)

    def test_per_character_credits_collapse_into_one_entry_per_person(self) -> None:
        credits = credits_for(
            manifest_with(
                characters=[
                    {"id": "a", "name": "Seer", "team": "townsfolk", "ability": "x", "credits": {"name": "Bob", "role": "Artwork"}},
                    {"id": "b", "name": "Fool", "team": "townsfolk", "ability": "x", "credits": {"name": "Bob", "role": "Artwork"}},
                    {"id": "c", "name": "Imp", "team": "demon", "ability": "x", "credits": "Carol"},
                ]
            )
        )

        by_name = {entry.name: entry for entry in credits.entries}
        self.assertEqual(sorted(by_name), ["Bob", "Carol"])
        self.assertEqual(by_name["Bob"].works, ["Seer", "Fool"])
        self.assertEqual(by_name["Carol"].works, ["Imp"])

    def test_character_credits_merge_into_a_matching_pack_entry(self) -> None:
        credits = credits_for(
            manifest_with(
                credits={"entries": [{"name": "Bob", "role": "Artwork", "url": "https://bob.example.test"}]},
                characters=[
                    {"id": "a", "name": "Seer", "team": "townsfolk", "ability": "x", "credits": {"name": "bob", "role": "artwork"}}
                ],
            )
        )

        self.assertEqual(len(credits.entries), 1)
        self.assertEqual(credits.entries[0].url, "https://bob.example.test")
        self.assertEqual(credits.entries[0].works, ["Seer"])

    def test_a_junk_credits_value_is_ignored_instead_of_failing_the_upload(self) -> None:
        # Credits are optional, so a malformed block must never cost a storyteller
        # their pack upload.
        for junk in [12345, ["nope"], True]:
            with self.subTest(junk=junk):
                credits = credits_for(manifest_with(junk))

                self.assertEqual(credits.author, "")
                self.assertEqual(credits.notice, "")
                self.assertEqual(credits.entries, [])

    def test_long_credit_text_is_truncated_rather_than_rejected(self) -> None:
        credits = credits_for(manifest_with({"author": "A" * 500, "notice": "N" * 5000}))

        self.assertEqual(len(credits.author), 120)
        self.assertEqual(len(credits.notice), 2000)


if __name__ == "__main__":
    unittest.main()
