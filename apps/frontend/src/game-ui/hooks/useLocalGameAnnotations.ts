/**
 * Local table annotations hook.
 *
 * Guesses and reminder tokens are private browser state, persisted per
 * room/player pair so they survive reloads without leaking to other users.
 */

import { useEffect, useState } from 'react';

import type { RoomState } from '../../api/client';
import type { ReminderToken } from '../types';
import { guessKey, reminderKey } from '../sessionStorage';
import type { ReminderTokenOption } from '../reminderTokens';

/** Read and validate one JSON localStorage entry, returning a fallback on any error. */
function readStoredJson<T>(key: string, isValid: (value: unknown) => boolean, fallback: T): T {
  const raw = localStorage.getItem(key);
  if (!raw) {
    return fallback;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return isValid(parsed) ? (parsed as T) : fallback;
  } catch {
    return fallback;
  }
}

/** Return whether a parsed value is a plain object usable as the guesses map. */
function isGuessMap(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

type UseLocalGameAnnotationsOptions = {
  currentPlayerId: string;
  reminderTokenOptions: ReminderTokenOption[];
  room: RoomState | null;
  selectedReminderLabel: string;
  setError: (message: string) => void;
  setSelectedReminderLabel: (label: string) => void;
};

/**
 * Manages player-local guesses and table reminders that are persisted in localStorage.
 */
export function useLocalGameAnnotations({
  currentPlayerId,
  reminderTokenOptions,
  room,
  selectedReminderLabel,
  setError,
  setSelectedReminderLabel,
}: UseLocalGameAnnotationsOptions) {
  const [guesses, setGuesses] = useState<Record<string, string>>({});
  const [reminders, setReminders] = useState<ReminderToken[]>([]);
  const [suspectedCharacterId, setSuspectedCharacterId] = useState('');

  useEffect(() => {
    if (room && currentPlayerId) {
      // A single corrupted localStorage entry must not throw and crash the app
      // on room load, so parsing falls back to empty defaults on any error.
      setGuesses(readStoredJson<Record<string, string>>(guessKey(room.id, currentPlayerId), isGuessMap, {}));
      setReminders(readStoredJson<ReminderToken[]>(reminderKey(room.id, currentPlayerId), Array.isArray, []));
    }
  }, [room?.id, currentPlayerId]);

  useEffect(() => {
    if (room && currentPlayerId) {
      localStorage.setItem(guessKey(room.id, currentPlayerId), JSON.stringify(guesses));
    }
  }, [room?.id, currentPlayerId, guesses]);

  useEffect(() => {
    if (room && currentPlayerId) {
      try {
        const storedReminders = reminders.map(({ id, tokenId, label, x, y }) => ({ id, tokenId, label, x, y }));
        localStorage.setItem(reminderKey(room.id, currentPlayerId), JSON.stringify(storedReminders));
      } catch {
        setError('Reminder tokens could not be saved locally. Existing tokens stay on the table for this session.');
      }
    }
  }, [room?.id, currentPlayerId, reminders]);

  useEffect(() => {
    if (selectedReminderLabel && !reminderTokenOptions.some((token) => token.id === selectedReminderLabel)) {
      setSelectedReminderLabel('');
    }
  }, [reminderTokenOptions, selectedReminderLabel, setSelectedReminderLabel]);

  /**
   * Places the selected reminder token at a normalized table position.
   */
  function placeReminder(x: number, y: number) {
    if (!selectedReminderLabel) {
      return;
    }
    const selectedReminder = reminderTokenOptions.find((token) => token.id === selectedReminderLabel) ?? reminderTokenOptions[0];
    setReminders((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        tokenId: selectedReminder?.id ?? selectedReminderLabel,
        label: selectedReminder?.label ?? selectedReminderLabel,
        x,
        y,
      },
    ]);
  }

  /**
   * Places one specific reminder token at a position, regardless of selection.
   * Used by the table right-click token menu.
   */
  function placeReminderToken(tokenId: string, x: number, y: number) {
    const token = reminderTokenOptions.find((option) => option.id === tokenId);
    if (!token) {
      return;
    }
    setReminders((current) => [
      ...current,
      { id: crypto.randomUUID(), tokenId: token.id, label: token.label, x, y },
    ]);
  }

  /**
   * Moves an existing reminder token without touching its identity or label.
   */
  function moveReminder(reminderId: string, x: number, y: number) {
    setReminders((current) =>
      current.map((reminder) =>
        reminder.id === reminderId
          ? { ...reminder, x, y }
          : reminder,
      ),
    );
  }

  /**
   * Removes a reminder token when the table is in reminder-edit mode.
   */
  function removeReminder(reminderId: string) {
    if (selectedReminderLabel) {
      setReminders((current) => current.filter((reminder) => reminder.id !== reminderId));
    }
  }

  /**
   * Removes a reminder token unconditionally (used by right-click on the token).
   */
  function deleteReminder(reminderId: string) {
    setReminders((current) => current.filter((reminder) => reminder.id !== reminderId));
  }

  /**
   * Records a private character suspicion for one player.
   */
  function placeSuspicionOnPlayer(playerId: string) {
    if (!suspectedCharacterId) {
      setError('Choose a suspicion character first.');
      return false;
    }
    setGuesses((current) => ({ ...current, [playerId]: suspectedCharacterId }));
    setError('');
    return true;
  }

  return {
    deleteReminder,
    guesses,
    moveReminder,
    placeReminder,
    placeReminderToken,
    placeSuspicionOnPlayer,
    reminders,
    removeReminder,
    setSuspectedCharacterId,
    suspectedCharacterId,
  };
}
