# Interface languages

The app text is translated here. Character packs are **not**: those carry their
own translations and keep a separate selector in client settings.

## How it works

Keys are the English source string, not invented ids:

```tsx
const t = useUiText();
t('Start Game')          // "Spiel starten" in German
```

Two things follow from that. A string with no translation stays English instead
of showing a key, so a half-finished language is still usable. And a message
created somewhere without React context - a hook, an error handler - can be kept
in English and translated at the point where it is displayed (`t(error)`).

Placeholders are named and survive translation, so word order can differ:

```tsx
t('Preparing {pack}...', { pack: 'HBLX' })
```

Known placeholder messages are also recognized after a hook has already filled
the English value. For example, `t('Calling Willi...')` can match the dictionary
entry `Calling {player}...`. Prefer passing the key and values directly whenever
the call site has access to `t(...)`.

## Adding a language

1. Copy `de.ts` to the new code, e.g. `fr.ts`, and export it under that name.
2. Translate the values. Delete any line you have not translated yet rather
   than leaving the English in place - a missing key falls back to English
   anyway, and an empty one would show a blank label.
3. Register it in `index.ts`: add the code to `UiLanguage`, add an entry to
   `uiLanguages` (this is what the settings dropdown lists), and add it to
   `dictionaries`.

Nothing else changes. The settings dropdown, persistence and all call sites are
driven by that registry.

## Finding untranslated text

`tests/uiLanguage.test.mjs` checks that the dictionary is populated, placeholders
match, every literal `t(...)` key has a German entry, and visible JSX text is not
left hard-coded. To run it directly:

```bash
npm run test:unit
```

Only proper names should remain.
