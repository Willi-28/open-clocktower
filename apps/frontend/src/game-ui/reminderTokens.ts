import type { ReminderTokenDefinition } from '../api/client';
import type { ReminderToken } from './types';

export type ReminderTokenOption = {
  id: string;
  label: string;
  title: string;
  icon: string;
};

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
