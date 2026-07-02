import json
import unittest
from io import BytesIO
from zipfile import ZIP_DEFLATED, ZipFile

from app.game.character_packs import parse_character_pack


def pack_bytes(files: dict[str, bytes | str]) -> bytes:
    buffer = BytesIO()
    with ZipFile(buffer, "w", ZIP_DEFLATED) as archive:
        for name, content in files.items():
            archive.writestr(name, content if isinstance(content, bytes) else content.encode("utf-8"))
    return buffer.getvalue()


class CharacterPackTest(unittest.TestCase):
    def test_valid_minimal_pack_loads_character(self) -> None:
        manifest = {
            "schemaVersion": 1,
            "characters": [
                {
                    "id": "washerwoman",
                    "name": "Washerwoman",
                    "team": "townsfolk",
                    "ability": "You start knowing that 1 of 2 players is a particular Townsfolk.",
                }
            ],
        }

        characters, reminder_tokens = parse_character_pack(pack_bytes({"manifest.json": json.dumps(manifest)}))

        self.assertEqual(len(characters), 1)
        self.assertEqual(characters[0].id, "washerwoman")
        self.assertEqual(reminder_tokens, [])

    def test_manifest_must_be_valid_json_object(self) -> None:
        with self.assertRaisesRegex(ValueError, "valid UTF-8 JSON"):
            parse_character_pack(pack_bytes({"manifest.json": "{not-json"}))
        with self.assertRaisesRegex(ValueError, "JSON object"):
            parse_character_pack(pack_bytes({"manifest.json": "[]"}))

    def test_characters_must_be_list_of_objects(self) -> None:
        with self.assertRaisesRegex(ValueError, "characters must be a list"):
            parse_character_pack(pack_bytes({"manifest.json": json.dumps({"schemaVersion": 1, "characters": "bad"})}))
        with self.assertRaisesRegex(ValueError, "characters must be objects"):
            parse_character_pack(pack_bytes({"manifest.json": json.dumps({"schemaVersion": 1, "characters": ["bad"]})}))

    def test_unsafe_archive_paths_are_rejected(self) -> None:
        manifest = {"schemaVersion": 1, "characters": [{"id": "a"}]}

        with self.assertRaisesRegex(ValueError, "unsafe path"):
            parse_character_pack(pack_bytes({"manifest.json": json.dumps(manifest), "../evil.txt": "bad"}))


if __name__ == "__main__":
    unittest.main()
