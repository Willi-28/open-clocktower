import unittest

from app.game.media_validation import validate_profile_image


def png_bytes(width: int = 16, height: int = 16) -> bytes:
    return (
        b"\x89PNG\r\n\x1a\n"
        b"\x00\x00\x00\r"
        b"IHDR"
        + width.to_bytes(4, "big")
        + height.to_bytes(4, "big")
        + b"\x08\x06\x00\x00\x00"
        + b"\x00" * 8
    )


class MediaValidationTest(unittest.TestCase):
    def test_valid_png_profile_image_passes(self) -> None:
        validate_profile_image("avatar.png", "image/png", png_bytes())

    def test_extension_and_magic_bytes_must_match(self) -> None:
        with self.assertRaisesRegex(ValueError, "extension does not match"):
            validate_profile_image("avatar.jpg", "image/jpeg", png_bytes())


if __name__ == "__main__":
    unittest.main()
