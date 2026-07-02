/**
 * Character-pack night order builder.
 *
 * Uploaded packs can include first-night and other-night ordering data, and
 * this helper turns that character metadata into sorted panel rows.
 */

import type { Character } from '../api/client';
import { characterRole } from './gameText';

export type NightOrderStep = {
  character: string;
  note: string;
  order: number;
};

export type PackNightOrder = {
  firstNight: NightOrderStep[];
  otherNights: NightOrderStep[];
};

/** Build sorted first-night and other-night steps from imported characters. */
export function buildPackNightOrder(characters: Character[]): PackNightOrder {
  /** Convert one character into the row shape used by the night order panel. */
  const toNightStep = (character: Character, phase: 'first' | 'other') => ({
    character: character.name,
    note:
      phase === 'first'
        ? character.first_night_reminder || character.ability || `${characterRole(character)} from the loaded character pack.`
        : character.other_night_reminder || character.ability || `${characterRole(character)} from the loaded character pack.`,
    order: phase === 'first' ? character.first_night : character.other_night,
  });

  return {
    firstNight: characters
      .filter((character) => character.first_night > 0)
      .map((character) => toNightStep(character, 'first'))
      .sort((left, right) => left.order - right.order || left.character.localeCompare(right.character)),
    otherNights: characters
      .filter((character) => character.other_night > 0)
      .map((character) => toNightStep(character, 'other'))
      .sort((left, right) => left.order - right.order || left.character.localeCompare(right.character)),
  };
}
