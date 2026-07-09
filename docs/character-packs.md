# Character Packs

Open Clocktower imports custom character packs per room. The app does not ship protected game content, so each server operator or storyteller provides their own content.

## File Type And Limits

Upload one `.zip` file.

Limits:

- maximum ZIP upload size: 15 MB
- maximum uncompressed archive content: 50 MB
- maximum archive entries: 1000
- maximum icon size: 512 KB per icon

Archive paths must be relative and safe. Absolute paths and `..` path traversal are rejected.

Required root file:

```text
manifest.json
```

Recommended layout:

```text
my-pack.zip
|-- manifest.json
|-- icons/
|   |-- character-a.png
|   `-- character-b.webp
`-- reminder_tokens/
    |-- character-a_marked.png
    `-- character-a_wrong.webp
```

## Manifest Format

`manifest.json` must be UTF-8 JSON:

```json
{
  "schemaVersion": 1,
  "name": "My Custom Pack",
  "defaultLocale": "en",
  "supportedLocales": [
    { "code": "en", "name": "English" },
    { "code": "es", "name": "Spanish" }
  ],
  "characters": [
    {
      "id": "character-a",
      "name": "Character A",
      "team": "town",
      "category": "townsfolk",
      "ability": "Ability text shown on the character sheet.",
      "icon": "icons/character-a.png",
      "firstNight": 12,
      "firstNightReminder": "Wake on the first night and do the setup action.",
      "otherNight": 34,
      "otherNightReminder": "Wake on later nights and do the recurring action.",
      "translations": {
        "es": {
          "name": "Translated Character A",
          "category": "Translated Category",
          "ability": "Translated ability text.",
          "firstNightReminder": "Translated first-night reminder."
        }
      }
    }
  ],
  "reminderTokenPack": {
    "name": "My Custom Reminder Tokens",
    "tokens": [
      {
        "id": "character-a_marked",
        "character": "Character A",
        "reminder_token": "MARKED",
        "file": "reminder_tokens/character-a_marked.png",
        "translations": {
          "es": {
            "character": "Translated Character A",
            "reminder_token": "TRANSLATED MARKED"
          }
        }
      }
    ]
  },
  "nightOrder": {
    "file": "night-order.json"
  }
}
```

## Characters

Required character fields:

- `id`: unique inside the pack
- `name`
- `team`
- `category`
- `ability`

Optional character fields:

- `icon`
- `firstNight`: first-night order number; use `0` or omit if the character does not wake
- `firstNightReminder`
- `otherNight`: other-night order number; use `0` or omit if the character does not wake
- `otherNightReminder`
- `translations`: per-language overrides for `name`, `team`, `category`, `ability`, `firstNightReminder`, and `otherNightReminder`

The character sheet groups roles by `category`. Keep category values consistent inside a pack so the dashboard stays readable.

## Languages

Optional language fields:

- `defaultLocale`: base language of the untranslated fields
- `supportedLocales`: languages offered in client settings

Each supported locale may be a string such as `"es"` or an object such as:

```json
{ "code": "es", "name": "Spanish" }
```

When languages are present, the browser settings show a `Language` section with a character sheet language selector. This is local to each browser and does not change room state or assignments.

## Reminder Tokens

Recommended token location:

```json
{
  "reminderTokenPack": {
    "tokens": []
  }
}
```

Supported token fields:

- `id`: unique inside the pack
- `character`: character name used in tooltips
- `reminder_token`, `reminderToken`, or `label`: visible text rendered under the icon
- `file`, `icon`, `image`, `src`, or `source_icon_file`: image path inside the ZIP
- `translations`: optional per-language overrides for `character`, `reminder_token`, or `label`

For compatibility, top-level `tokens`, `reminderTokens`, and `reminder_tokens` are also accepted. New packs should prefer `reminderTokenPack.tokens`.

If the manifest provides a token list, that list is authoritative. Automatic discovery from `reminder_tokens/` is only used when no token list exists.

The UI shows each visible token once. If a pack contains multiple token IDs with the same icon and the same visible label, only the first one is shown in the token dashboard. For example, five copies of the same `CORRECT` token render as one selectable token.

Reminder token images should contain only the artwork. The app renders the text caption under the icon so labels can be translated and kept readable at different sizes.

## Night Order

Night order can be provided in either format:

- Recommended: set `firstNight`, `firstNightReminder`, `otherNight`, and `otherNightReminder` directly on each character.
- Compatible: set `nightOrder.file` to a JSON file inside the ZIP.

Example `night-order.json`:

```json
{
  "schemaVersion": 1,
  "name": "Example Night Order",
  "nightOrder": {
    "firstNight": [
      { "character": "Character A", "note": "First-night action." }
    ],
    "otherNights": [
      { "character": "Character A", "note": "Later-night action." }
    ]
  }
}
```

## Icon Requirements

Allowed icon formats:

- PNG
- JPG/JPEG
- WEBP

Recommended icon shape:

- square image
- transparent PNG or WEBP when possible
- important details centered, because character icons are rendered as circles

SVG is intentionally not accepted for uploaded icons because it requires sanitization before it is safe to serve.

## Safety Notes

- Do not include protected or unlicensed content unless you have the right to use it.
- Keep ZIPs small and avoid unused assets.
- Prefer explicit token lists over relying on filename discovery.
- Use stable IDs; changing IDs can break saved assignments or placed local reminders after a pack is replaced.
