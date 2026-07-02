# Character Packs

Open Clocktower imports custom characters per room. The app does not ship protected game content.

## File Type

Upload a single `.zip` file.

Maximum pack size: 10 MB.

Required structure:

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
    { "code": "de", "name": "Deutsch" },
    { "code": "es", "name": "Español" }
  ],
  "characters": [
    {
      "id": "character-a",
      "name": "Character A",
      "team": "town",
      "category": "information",
      "ability": "Ability text shown on the character sheet.",
      "icon": "icons/character-a.png",
      "firstNight": 12,
      "firstNightReminder": "Wake on the first night and do the setup action.",
      "otherNight": 34,
      "otherNightReminder": "Wake on later nights and do the recurring action.",
      "translations": {
        "de": {
          "name": "Rolle A",
          "category": "Bürger",
          "ability": "Übersetzter Fähigkeitstext.",
          "firstNightReminder": "Übersetzte Erinnerung für die erste Nacht."
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
          "de": {
            "character": "Rolle A",
            "reminder_token": "MARKIERT"
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

Required character fields:

- `id`: unique inside the pack
- `name`
- `team`
- `category`
- `ability`

Optional character fields:

- `icon`
- `firstNight`: official first-night order number; use `0` or omit if the character does not wake
- `firstNightReminder`: text shown in the First Night section
- `otherNight`: official other-night order number; use `0` or omit if the character does not wake
- `otherNightReminder`: text shown in the Other Nights section
- `translations`: optional per-language overrides for `name`, `team`,
  `category`, `ability`, `firstNightReminder`, and `otherNightReminder`

Optional language fields:

- `defaultLocale`: base language of the un-translated character and token fields
- `supportedLocales`: languages offered in client settings; entries can be
  plain strings like `"de"` or objects like `{ "code": "de", "name": "Deutsch" }`

Optional reminder token fields:

- `reminderTokenPack`: grouped reminder token metadata
- `reminderTokenPack.name`: optional human-readable token pack name
- `reminderTokenPack.tokens`: list of reminder tokens available as private table tokens
- `reminderTokenPack.tokens[].id`: unique inside the pack
- `reminderTokenPack.tokens[].character`: character name used for the tooltip
- `reminderTokenPack.tokens[].reminder_token`: visible text rendered below the token icon
- `reminderTokenPack.tokens[].file`: PNG/JPG/JPEG/WEBP image path inside the ZIP
- `reminderTokenPack.tokens[].icon`: alternative image field name; use either `file` or `icon`
- `reminderTokenPack.tokens[].translations`: optional per-language overrides for
  `character`, `reminder_token`, or `label`

For compatibility, top-level `tokens`, `reminderTokens`, and `reminder_tokens`
are also accepted. New packs should prefer `reminderTokenPack.tokens`.

Reminder token PNGs should contain only the token artwork. The app renders
`reminder_token` as the white caption below the icon, so captions can be
translated and remain readable at different table sizes.

If `supportedLocales` is present, the frontend exposes those languages in
client settings under `Language` -> `Character Sheet Language`. Selecting a
language is local to each browser and does not change room state or character
assignments.

Night order can be provided in either of these formats:

- Recommended: put `firstNight`, `firstNightReminder`, `otherNight`, and `otherNightReminder` directly on each character in `manifest.json`.
- Compatible: set `nightOrder.file` to a JSON file inside the ZIP.

Example `night-order.json`:

```json
{
  "schemaVersion": 1,
  "scriptId": "trouble-brewing",
  "name": "Trouble Brewing Night Order",
  "nightOrder": {
    "firstNight": [
      { "character": "Poisoner", "note": "Chooses a player to poison." }
    ],
    "otherNights": [
      { "character": "Monk", "note": "Chooses a player to protect from the Demon." }
    ]
  }
}
```

## Icon Requirements

Allowed formats:

- PNG
- JPG/JPEG
- WEBP

Maximum icon size: 512 KB per file.

Recommended icon shape:

- square image
- 256x256 or 512x512 pixels
- transparent PNG or WEBP works best
- keep important details centered, because the UI renders icons as circles

SVG is intentionally not accepted yet, because it needs sanitizing before it is safe for uploads.
