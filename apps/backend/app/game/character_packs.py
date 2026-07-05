"""Character-pack ZIP parser.

This module validates uploaded character packs, reads manifest and night-order
JSON, embeds safe icon files as data URLs, and returns room-local definitions.
"""

import base64
import json
from io import BytesIO
from zipfile import BadZipFile, ZipFile

from .room_state import Character, ReminderTokenDefinition

ALLOWED_ICON_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
}
ICON_TYPE_NAMES = {
    "image/png": "PNG",
    "image/jpeg": "JPG/JPEG",
    "image/webp": "WEBP",
}
MAX_PACK_BYTES = 15 * 1024 * 1024
MAX_ICON_BYTES = 512 * 1024
MAX_ARCHIVE_ENTRIES = 1000
MAX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024


def parse_character_pack(data: bytes) -> tuple[list[Character], list[ReminderTokenDefinition]]:
    """Parse uploaded ZIP bytes into character and reminder token definitions."""
    try:
        archive = ZipFile(BytesIO(data))
    except BadZipFile as error:
        raise ValueError("character pack must be a valid ZIP file") from error

    with archive:
        _validate_archive_shape(archive)
        names = set(archive.namelist())
        if "manifest.json" not in names:
            raise ValueError("character pack must contain manifest.json")

        manifest = _read_manifest(archive)
        if manifest.get("schemaVersion") != 1:
            raise ValueError("manifest schemaVersion must be 1")

        default_language = _default_language(manifest)
        supported_languages = _supported_languages(manifest, default_language)
        night_order = _read_night_order(archive, manifest)
        seen_ids: set[str] = set()
        characters: list[Character] = []
        raw_characters = manifest.get("characters", [])
        if not isinstance(raw_characters, list):
            raise ValueError("manifest characters must be a list")
        for raw_character in raw_characters:
            if not isinstance(raw_character, dict):
                raise ValueError("manifest characters must be objects")
            character_id = str(raw_character.get("id", "")).strip()
            if not character_id or character_id in seen_ids:
                raise ValueError("character ids must be present and unique")
            seen_ids.add(character_id)

            icon = _read_icon(archive, raw_character.get("icon"))
            characters.append(
                Character(
                    id=character_id,
                    name=str(raw_character.get("name", character_id)).strip(),
                    team=str(raw_character.get("team", "unknown")).strip(),
                    category=str(raw_character.get("category", "unknown")).strip(),
                    ability=str(raw_character.get("ability", "")).strip(),
                    icon=icon,
                    first_night=_pack_int(raw_character, "firstNight", "first_night") or night_order.get(character_id, {}).get("first_order", 0),
                    first_night_reminder=str(
                        raw_character.get(
                            "firstNightReminder",
                            raw_character.get("first_night_reminder", night_order.get(character_id, {}).get("first_note", "")),
                        )
                    ).strip(),
                    other_night=_pack_int(raw_character, "otherNight", "other_night") or night_order.get(character_id, {}).get("other_order", 0),
                    other_night_reminder=str(
                        raw_character.get(
                            "otherNightReminder",
                            raw_character.get("other_night_reminder", night_order.get(character_id, {}).get("other_note", "")),
                        )
                    ).strip(),
                    translations=_character_translations(raw_character, supported_languages),
                    default_language=default_language,
                    available_languages=supported_languages,
                )
            )
        if not characters:
            raise ValueError("manifest must contain at least one character")

        seen_token_ids: set[str] = set()
        seen_visible_tokens: set[tuple[str, str]] = set()
        reminder_tokens: list[ReminderTokenDefinition] = []
        raw_tokens = _raw_reminder_tokens(manifest)
        for raw_token in raw_tokens:
            token_id = str(raw_token.get("id", "")).strip()
            if not token_id or token_id in seen_token_ids:
                raise ValueError("reminder token ids must be present and unique")
            seen_token_ids.add(token_id)

            label = str(raw_token.get("reminder_token", raw_token.get("reminderToken", raw_token.get("label", token_id)))).strip()
            icon = _read_icon(
                archive,
                raw_token.get("icon")
                or raw_token.get("image")
                or raw_token.get("src")
                or raw_token.get("file")
                or raw_token.get("source_icon_file")
                or _guess_reminder_token_icon(archive, token_id, raw_token.get("character"), label),
            )
            visible_signature = _reminder_token_signature(label, icon)
            if visible_signature in seen_visible_tokens:
                continue
            seen_visible_tokens.add(visible_signature)
            reminder_tokens.append(
                ReminderTokenDefinition(
                    id=token_id,
                    label=label,
                    character=str(raw_token.get("character", "")).strip() or None,
                    icon=icon,
                    translations=_token_translations(raw_token, supported_languages),
                    default_language=default_language,
                    available_languages=supported_languages,
                )
            )
        if not raw_tokens:
            for discovered_token in _discover_reminder_tokens_from_files(archive, seen_token_ids):
                reminder_tokens.append(discovered_token)
        return characters, reminder_tokens


def _validate_archive_shape(archive: ZipFile) -> None:
    """Reject oversized archives and unsafe paths before reading pack content."""
    entries = archive.infolist()
    if len(entries) > MAX_ARCHIVE_ENTRIES:
        raise ValueError("character pack contains too many files")
    if sum(entry.file_size for entry in entries) > MAX_UNCOMPRESSED_BYTES:
        raise ValueError("character pack uncompressed content is too large")
    for entry in entries:
        path = _normalize_pack_path(entry.filename)
        if path.startswith("/") or ".." in path.split("/"):
            raise ValueError("character pack contains an unsafe path")


def _read_manifest(archive: ZipFile) -> dict[str, object]:
    """Read and validate the root manifest.json document."""
    try:
        manifest = json.loads(archive.read("manifest.json").decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError) as error:
        raise ValueError("manifest.json must be valid UTF-8 JSON") from error
    if not isinstance(manifest, dict):
        raise ValueError("manifest.json must contain a JSON object")
    return manifest


def _default_language(manifest: dict[str, object]) -> str:
    """Return the manifest default language, falling back to English."""
    return _language_code(manifest.get("defaultLocale", manifest.get("defaultLanguage", ""))) or "en"


def _supported_languages(manifest: dict[str, object], default_language: str) -> list[str]:
    """Collect translated languages from manifest metadata, characters, and tokens."""
    raw_languages = manifest.get("supportedLocales", manifest.get("supported_languages", manifest.get("languages", [])))
    languages = [_language_code(language) for language in raw_languages] if isinstance(raw_languages, list) else []
    for source in [manifest.get("translations"), *(character.get("translations") for character in manifest.get("characters", []) if isinstance(character, dict))]:
        if isinstance(source, dict):
            languages.extend(str(language).strip() for language in source)
    token_list = _raw_reminder_tokens(manifest)
    for token in token_list:
        translations = token.get("translations") if isinstance(token, dict) else None
        if isinstance(translations, dict):
            languages.extend(str(language).strip() for language in translations)
    return sorted({language for language in languages if language and language != default_language})


def _language_code(language: object) -> str:
    """Normalize a language entry into its locale code."""
    if isinstance(language, dict):
        return str(language.get("code", language.get("locale", language.get("id", "")))).strip()
    return str(language).strip()


def _raw_reminder_tokens(manifest: dict[str, object]) -> list[dict[str, object]]:
    """Return reminder token objects from any supported manifest location."""
    raw_tokens = manifest.get("tokens") or manifest.get("reminderTokens") or manifest.get("reminder_tokens")
    if isinstance(raw_tokens, list):
        return [token for token in raw_tokens if isinstance(token, dict)]
    token_pack = manifest.get("reminderTokenPack")
    if isinstance(token_pack, dict) and isinstance(token_pack.get("tokens"), list):
        return [token for token in token_pack["tokens"] if isinstance(token, dict)]
    return []


def _character_translations(raw_character: dict[str, object], supported_languages: list[str]) -> dict[str, dict[str, str]]:
    """Extract clean per-language character translations."""
    translations = raw_character.get("translations")
    if not isinstance(translations, dict):
        return {}
    result: dict[str, dict[str, str]] = {}
    for language in supported_languages:
        raw_translation = translations.get(language)
        if not isinstance(raw_translation, dict):
            continue
        translated = {
            "name": raw_translation.get("name"),
            "team": raw_translation.get("team"),
            "category": raw_translation.get("category"),
            "ability": raw_translation.get("ability"),
            "first_night_reminder": raw_translation.get("firstNightReminder", raw_translation.get("first_night_reminder")),
            "other_night_reminder": raw_translation.get("otherNightReminder", raw_translation.get("other_night_reminder")),
        }
        clean_translation = {key: str(value).strip() for key, value in translated.items() if value is not None and str(value).strip()}
        if clean_translation:
            result[language] = clean_translation
    return result


def _token_translations(raw_token: dict[str, object], supported_languages: list[str]) -> dict[str, dict[str, str]]:
    """Extract clean per-language reminder token translations."""
    translations = raw_token.get("translations")
    if not isinstance(translations, dict):
        return {}
    result: dict[str, dict[str, str]] = {}
    for language in supported_languages:
        raw_translation = translations.get(language)
        if not isinstance(raw_translation, dict):
            continue
        translated = {
            "label": raw_translation.get("label", raw_translation.get("reminderToken", raw_translation.get("reminder_token"))),
            "character": raw_translation.get("character"),
        }
        clean_translation = {key: str(value).strip() for key, value in translated.items() if value is not None and str(value).strip()}
        if clean_translation:
            result[language] = clean_translation
    return result


def _reminder_token_signature(label: str, icon: str | None) -> tuple[str, str]:
    """Return the visible identity used to collapse duplicate token copies."""
    return (_slug(label), icon or "")


def _read_night_order(archive: ZipFile, manifest: dict[str, object]) -> dict[str, dict[str, int | str]]:
    """Read optional night-order data and map it back to manifest character ids."""
    raw_night_order = manifest.get("nightOrder")
    order_file = raw_night_order.get("file") if isinstance(raw_night_order, dict) else None
    if not order_file:
        order_file = _discover_night_order_file(archive)
    if not order_file:
        return {}
    path = _normalize_pack_path(str(order_file))
    if path.startswith("/") or ".." in path.split("/"):
        raise ValueError("night order path is unsafe")
    try:
        document = json.loads(archive.read(path).decode("utf-8"))
    except KeyError as error:
        raise ValueError(f"night order file not found: {path}") from error
    if document.get("schemaVersion") not in {None, 1}:
        raise ValueError("night order schemaVersion must be 1")

    character_lookup = {
        _slug(str(character.get("id", ""))): str(character.get("id", "")).strip()
        for character in manifest.get("characters", [])
        if isinstance(character, dict)
    }
    character_lookup.update(
        {
            _slug(str(character.get("name", ""))): str(character.get("id", "")).strip()
            for character in manifest.get("characters", [])
            if isinstance(character, dict)
        }
    )
    result: dict[str, dict[str, int | str]] = {}
    raw_order = document.get("nightOrder", document)
    if not isinstance(raw_order, dict):
        return result
    for phase_key, order_key, note_key in [
        ("firstNight", "first_order", "first_note"),
        ("otherNights", "other_order", "other_note"),
    ]:
        entries = raw_order.get(phase_key, [])
        if not isinstance(entries, list):
            continue
        for index, entry in enumerate(entries, start=1):
            if not isinstance(entry, dict):
                continue
            character_ref = str(entry.get("character", entry.get("id", ""))).strip()
            character_id = character_lookup.get(_slug(character_ref))
            if not character_id:
                continue
            result.setdefault(character_id, {})
            result[character_id][order_key] = _pack_int(entry, "order", "index") or index
            result[character_id][note_key] = str(entry.get("note", entry.get("reminder", ""))).strip()
    return result


def _discover_night_order_file(archive: ZipFile) -> str | None:
    """Find a likely night-order JSON file when the manifest omits its path."""
    for archive_name in archive.namelist():
        path = _normalize_pack_path(archive_name)
        filename = path.rsplit("/", 1)[-1].lower()
        if filename.endswith(".json") and "night" in filename and "order" in filename:
            return path
    return None


def _pack_int(source: dict[str, object], *keys: str) -> int:
    """Read the first integer value found under the provided keys."""
    for key in keys:
        value = source.get(key)
        if value is None or value == "":
            continue
        try:
            return int(value)
        except (TypeError, ValueError):
            return 0
    return 0


def _read_icon(archive: ZipFile, icon_path: object) -> str | None:
    """Validate an icon file and return it as a browser-ready data URL."""
    if not icon_path:
        return None
    path = _normalize_pack_path(str(icon_path))
    if path.startswith("/") or ".." in path.split("/"):
        raise ValueError("icon path is unsafe")
    suffix = "." + path.rsplit(".", 1)[-1].lower() if "." in path else ""
    media_type = ALLOWED_ICON_TYPES.get(suffix)
    if media_type is None:
        raise ValueError("icons must be PNG, JPG, JPEG, or WEBP")
    try:
        icon_bytes = archive.read(path)
    except KeyError as error:
        resolved_path = _find_pack_path(archive, path)
        if resolved_path is None:
            raise ValueError(f"icon not found: {path}") from error
        icon_bytes = archive.read(resolved_path)
    if len(icon_bytes) > MAX_ICON_BYTES:
        raise ValueError("each icon must be 512 KB or smaller")
    detected_media_type = _detect_icon_media_type(icon_bytes)
    if detected_media_type is None:
        raise ValueError(f"icon file is not a valid PNG, JPG, JPEG, or WEBP: {path}")
    if detected_media_type != media_type:
        expected_name = ICON_TYPE_NAMES.get(media_type, media_type)
        detected_name = ICON_TYPE_NAMES.get(detected_media_type, detected_media_type)
        raise ValueError(
            f"icon file extension does not match its content: {path} uses {suffix} "
            f"but the file bytes look like {detected_name}; expected {expected_name}"
        )
    encoded = base64.b64encode(icon_bytes).decode("ascii")
    return f"data:{media_type};base64,{encoded}"


def _detect_icon_media_type(data: bytes) -> str | None:
    """Detect supported image media types from file signatures."""
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8"):
        return "image/jpeg"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def _guess_reminder_token_icon(archive: ZipFile, token_id: str, character: object, label: str) -> str | None:
    """Guess a reminder token icon path from common archive naming patterns."""
    candidates = {
        _slug(token_id),
        _slug(f"{character}_{label}"),
        _slug(f"{character}_{token_id}"),
        _slug(label),
    }
    for archive_name in archive.namelist():
        path = _normalize_pack_path(archive_name)
        suffix = "." + path.rsplit(".", 1)[-1].lower() if "." in path else ""
        if ALLOWED_ICON_TYPES.get(suffix) is None:
            continue
        folder_hint = path.lower().replace("-", "_")
        if "reminder" not in folder_hint and "token" not in folder_hint:
            continue
        file_stem = _slug(path.rsplit("/", 1)[-1].rsplit(".", 1)[0])
        if file_stem in candidates:
            return archive_name
    return None


def _discover_reminder_tokens_from_files(archive: ZipFile, seen_token_ids: set[str]) -> list[ReminderTokenDefinition]:
    """Create reminder token definitions for token icons not listed in the manifest."""
    discovered: list[ReminderTokenDefinition] = []
    for archive_name in archive.namelist():
        path = _normalize_pack_path(archive_name)
        suffix = "." + path.rsplit(".", 1)[-1].lower() if "." in path else ""
        if ALLOWED_ICON_TYPES.get(suffix) is None:
            continue
        folder_hint = path.lower().replace("-", "_")
        if "reminder" not in folder_hint and "token" not in folder_hint:
            continue
        stem = path.rsplit("/", 1)[-1].rsplit(".", 1)[0]
        token_id = _slug(stem)
        if not token_id or token_id in seen_token_ids:
            continue
        seen_token_ids.add(token_id)
        character, label = _split_reminder_file_name(stem)
        discovered.append(
            ReminderTokenDefinition(
                id=token_id,
                label=label,
                character=character,
                icon=_read_icon(archive, archive_name),
            )
        )
    return discovered


def _split_reminder_file_name(stem: str) -> tuple[str | None, str]:
    """Split a reminder token filename into an optional character and label."""
    parts = [part for part in stem.replace("-", "_").split("_") if part]
    if len(parts) <= 1:
        return None, stem.replace("_", " ").title()
    character = parts[0].replace("_", " ").title()
    label = " ".join(parts[1:]).upper()
    return character, label


def _slug(value: object) -> str:
    """Convert arbitrary text to a lowercase underscore identifier."""
    text = str(value or "").lower()
    result = []
    previous_was_separator = False
    for character in text:
        if character.isalnum():
            result.append(character)
            previous_was_separator = False
        elif not previous_was_separator:
            result.append("_")
            previous_was_separator = True
    return "".join(result).strip("_")


def _normalize_pack_path(path: str) -> str:
    """Normalize archive paths to a consistent forward-slash form."""
    return path.replace("\\", "/").removeprefix("./").strip()


def _find_pack_path(archive: ZipFile, requested_path: str) -> str | None:
    """Resolve a requested pack path even if it appears nested or case-shifted."""
    normalized_request = _normalize_pack_path(requested_path).lower()
    request_name = normalized_request.rsplit("/", 1)[-1]
    for candidate in archive.namelist():
        normalized_candidate = _normalize_pack_path(candidate).lower()
        if normalized_candidate == normalized_request:
            return candidate
        if normalized_candidate.endswith("/" + normalized_request):
            return candidate
        if normalized_candidate.rsplit("/", 1)[-1] == request_name:
            return candidate
    return None
