import { useEffect, useState } from 'react';

import type { RoomState } from '../../api/client';
import type { ReminderToken } from '../types';
import { guessKey, reminderKey } from '../sessionStorage';
import type { ReminderTokenOption } from '../reminderTokens';

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
      const savedGuesses = localStorage.getItem(guessKey(room.id, currentPlayerId));
      setGuesses(savedGuesses ? JSON.parse(savedGuesses) : {});
      const savedReminders = localStorage.getItem(reminderKey(room.id, currentPlayerId));
      setReminders(savedReminders ? JSON.parse(savedReminders) : []);
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
    guesses,
    moveReminder,
    placeReminder,
    placeSuspicionOnPlayer,
    reminders,
    removeReminder,
    setSuspectedCharacterId,
    suspectedCharacterId,
  };
}
