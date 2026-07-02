/**
 * Reminder token display helpers.
 *
 * Token definitions come from uploaded character packs, while placed reminders
 * are local table annotations; this module joins those two shapes for display.
 */

import type { ReminderTokenDefinition } from '../api/client';
import type { ReminderToken } from './types';

export type ReminderTokenOption = {
  id: string;
  label: string;
  title: string;
  icon: string;
};

/** Convert imported reminder token definitions into selectable UI options. */
export function buildReminderTokenOptions(tokens: ReminderTokenDefinition[]): ReminderTokenOption[] {
  return tokens
    .filter((token) => token.icon)
    .map((token) => ({
      id: token.id,
      label: token.label,
      title: token.character ? `${token.character}: ${token.label}` : token.label,
      icon: token.icon ?? '',
    }));
}

/** Enrich placed reminders with the latest label and icon from token options. */
export function renderReminders(reminders: ReminderToken[], tokenOptions: ReminderTokenOption[]): ReminderToken[] {
  return reminders.map((reminder) => {
    const token = reminder.tokenId ? tokenOptions.find((option) => option.id === reminder.tokenId) : null;
    return {
      ...reminder,
      label: token?.label ?? reminder.label,
      icon: token?.icon ?? reminder.icon ?? null,
    };
  });
}
