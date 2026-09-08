/**
 * User interface language.
 *
 * Translations are keyed by their English source text rather than by invented
 * ids. That keeps call sites readable (`t('Start Game')`), needs no key
 * bookkeeping, and makes an untranslated string fall back to English on its own.
 * Because the key is the English text, a message produced deep in a hook can be
 * stored in English and translated where it is finally displayed.
 *
 * Character pack content is deliberately not covered here: packs carry their
 * own translations and keep their own selector in client settings.
 *
 * Adding a language: see README.md.
 */

import { createContext, useContext, useMemo } from 'react';

import { de } from './de';

export type UiLanguage = 'en' | 'de';

/** Every selectable language, in the order the settings dropdown shows them. */
export const uiLanguages: { code: UiLanguage; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'de', label: 'Deutsch' },
];

/** English is the source language, so it needs no table of its own. */
const dictionaries: Partial<Record<UiLanguage, Record<string, string>>> = { de };

type TemplateMatcher = {
  placeholders: string[];
  pattern: RegExp;
  translation: string;
};

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Build matchers for messages that reached the UI with placeholders already filled. */
function buildTemplateMatchers(dictionary: Record<string, string>): TemplateMatcher[] {
  return Object.entries(dictionary).flatMap(([source, translation]) => {
    const placeholders: string[] = [];
    let pattern = '^';
    let offset = 0;
    for (const match of source.matchAll(/\{(\w+)\}/g)) {
      pattern += escapeRegExp(source.slice(offset, match.index));
      pattern += '(.*?)';
      placeholders.push(match[1]);
      offset = match.index + match[0].length;
    }
    if (placeholders.length === 0) {
      return [];
    }
    pattern += `${escapeRegExp(source.slice(offset))}$`;
    return [{ placeholders, pattern: new RegExp(pattern), translation }];
  });
}

const templateMatchers: Partial<Record<UiLanguage, TemplateMatcher[]>> = {
  de: buildTemplateMatchers(de),
};

function fillPlaceholders(template: string, values?: Record<string, string | number>) {
  if (!values) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (placeholder, key: string) => (key in values ? String(values[key]) : placeholder));
}

/**
 * Translate one string and fill any {placeholders}.
 *
 * Placeholders survive translation because both sides use the same names, so a
 * translator can reorder them freely. An unknown placeholder is left visible
 * rather than becoming "undefined".
 */
export function translateUiText(language: UiLanguage, text: string, values?: Record<string, string | number>): string {
  const dictionary = dictionaries[language];
  const exactTranslation = dictionary?.[text];
  if (exactTranslation !== undefined) {
    return fillPlaceholders(exactTranslation, values);
  }

  // Hooks deliberately keep UI errors in the English source language. If one
  // has already interpolated its runtime value, recover those values from a
  // known dictionary key such as "Calling {player}..." before translating it.
  if (!values) {
    for (const matcher of templateMatchers[language] ?? []) {
      const match = matcher.pattern.exec(text);
      if (!match) {
        continue;
      }
      const recoveredValues = Object.fromEntries(
        matcher.placeholders.map((placeholder, index) => [placeholder, match[index + 1]]),
      );
      return fillPlaceholders(matcher.translation, recoveredValues);
    }
  }

  return fillPlaceholders(text, values);
}

export const UiLanguageContext = createContext<UiLanguage>('en');

/** Translator bound to the language the user picked in client settings. */
export function useUiText() {
  const language = useContext(UiLanguageContext);
  return useMemo(
    () => (text: string, values?: Record<string, string | number>) => translateUiText(language, text, values),
    [language],
  );
}

/** The active UI language, for the few places that need the code itself. */
export function useUiLanguage() {
  return useContext(UiLanguageContext);
}
