"""Profile image validation helpers.

The upload API uses this module to check file size, extension, MIME type,
magic bytes, and image dimensions before storing room-local avatar images.
"""

import struct
from pathlib import Path

ALLOWED_PROFILE_IMAGE_TYPES = {"image/png": {"png"}, "image/jpeg": {"jpg", "jpeg"}, "image/gif": {"gif"}}
MAX_PROFILE_IMAGE_BYTES = 2 * 1024 * 1024
PROFILE_TYPE_NAMES = {
    "image/png": "PNG",
    "image/jpeg": "JPG/JPEG",
    "image/gif": "GIF",
}


def validate_profile_image(filename: str, media_type: str, data: bytes) -> None:
    """Validate one uploaded avatar image and raise ValueError when it is unsafe."""
    suffix = Path(filename).suffix.lower().lstrip(".")
    allowed_suffixes = ALLOWED_PROFILE_IMAGE_TYPES.get(media_type)
    if allowed_suffixes is None:
        raise ValueError("Profile image must be PNG, JPG, JPEG, or GIF")
    if suffix not in allowed_suffixes:
        raise ValueError("Profile image extension does not match its MIME type")
    if not data:
        raise ValueError("Profile image is empty")
    if len(data) > MAX_PROFILE_IMAGE_BYTES:
        raise ValueError("Profile image must be 2 MB or smaller")
    detected_media_type = detect_profile_image_media_type(data)
    if detected_media_type is None:
        raise ValueError("Profile image bytes are not a valid PNG, JPG, JPEG, or GIF")
    if detected_media_type != media_type:
        expected_name = PROFILE_TYPE_NAMES.get(media_type, media_type)
        detected_name = PROFILE_TYPE_NAMES.get(detected_media_type, detected_media_type)
        raise ValueError(
            f"Profile image file extension does not match its content: expected {expected_name}, but the bytes look like {detected_name}"
        )
    width, height = image_dimensions(media_type, data)
    if width < 1 or height < 1 or width > 8000 or height > 8000:
        raise ValueError("Profile image dimensions are invalid")


def image_dimensions(media_type: str, data: bytes) -> tuple[int, int]:
    """Read image dimensions from PNG, GIF, or JPG bytes without decoding pixels."""
    if media_type == "image/png":
        if len(data) < 33 or not data.startswith(b"\x89PNG\r\n\x1a\n") or data[12:16] != b"IHDR":
            raise ValueError("Profile image is not a valid PNG")
        return struct.unpack(">II", data[16:24])
    if media_type == "image/gif":
        if len(data) < 10 or data[:6] not in {b"GIF87a", b"GIF89a"}:
            raise ValueError("Profile image is not a valid GIF")
        return struct.unpack("<HH", data[6:10])
    if media_type == "image/jpeg":
        if len(data) < 4 or not data.startswith(b"\xff\xd8") or not data.endswith(b"\xff\xd9"):
            raise ValueError("Profile image is not a valid JPG")
        index = 2
        while index < len(data) - 9:
            if data[index] != 0xFF:
                index += 1
                continue
            marker = data[index + 1]
            index += 2
            if marker in {0xD8, 0xD9}:
                continue
            if index + 2 > len(data):
                break
            segment_length = int.from_bytes(data[index:index + 2], "big")
            if segment_length < 2 or index + segment_length > len(data):
                break
            if marker in {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}:
                height = int.from_bytes(data[index + 3:index + 5], "big")
                width = int.from_bytes(data[index + 5:index + 7], "big")
                return width, height
            index += segment_length
        raise ValueError("Profile image is not a valid JPG")
    raise ValueError("Unsupported profile image type")


def detect_profile_image_media_type(data: bytes) -> str | None:
    """Detect the likely profile image MIME type from its magic bytes."""
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8"):
        return "image/jpeg"
    if len(data) >= 6 and data[:6] in {b"GIF87a", b"GIF89a"}:
        return "image/gif"
    return None
