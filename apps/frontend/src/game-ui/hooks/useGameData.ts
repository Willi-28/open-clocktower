/**
 * Character and assignment data hook.
 *
 * Room state does not embed large script data, so this hook loads characters,
 * reminder tokens, assignments, and storyteller-only demon bluffs on demand.
 */

import { useEffect, useState } from 'react';

import {
  assignRandomCharacters,
  Character,
  CharacterAssignment,
  getRoom,
  listCharacterAssignments,
  listCharacters,
  listDemonBluffs,
  listReminderTokens,
  ReminderTokenDefinition,
  RoomState,
  setDemonBluffs,
} from '../../api/client';

type UseGameDataOptions = {
  characterLanguage: string;
  currentPlayerId: string;
  isStoryteller: boolean;
  room: RoomState | null;
  setError: (message: string) => void;
  setRoom: (room: RoomState) => void;
};

/**
 * Loads script data and storyteller-only character state for the active room.
 */
export function useGameData({ characterLanguage, currentPlayerId, isStoryteller, room, setError, setRoom }: UseGameDataOptions) {
  const [characters, setCharacters] = useState<Character[]>([]);
  const [reminderTokenDefinitions, setReminderTokenDefinitions] = useState<ReminderTokenDefinition[]>([]);
  const [assignments, setAssignments] = useState<CharacterAssignment[]>([]);
  const [demonBluffIds, setDemonBluffIds] = useState<string[]>([]);
  const [randomCharacterIds, setRandomCharacterIds] = useState<string[]>([]);

  useEffect(() => {
    if (!room) {
      setCharacters([]);
      setReminderTokenDefinitions([]);
      return;
    }
    void listCharacters(room.id, characterLanguage).then(setCharacters).catch(() => setCharacters([]));
    void listReminderTokens(room.id, characterLanguage).then(setReminderTokenDefinitions).catch(() => setReminderTokenDefinitions([]));
  }, [characterLanguage, room?.id]);

  useEffect(() => {
    if (!room || !currentPlayerId) {
      setAssignments([]);
      return;
    }
    void refreshAssignments(room.id, currentPlayerId);
  }, [room?.id, room?.updated_at, currentPlayerId]);

  useEffect(() => {
    if (!room || !currentPlayerId || !isStoryteller) {
      setDemonBluffIds([]);
      return;
    }
    void refreshDemonBluffs(room.id, currentPlayerId);
  }, [room?.id, currentPlayerId, isStoryteller]);

  /**
   * Refreshes role assignments from the viewer's perspective after room changes.
   */
  async function refreshAssignments(roomIdToLoad = room?.id, viewerPlayerId = currentPlayerId) {
    if (!roomIdToLoad || !viewerPlayerId) {
      setAssignments([]);
      return;
    }
    try {
      setAssignments(await listCharacterAssignments(roomIdToLoad, viewerPlayerId));
    } catch {
      setAssignments([]);
    }
  }

  /**
   * Refreshes demon bluffs, which are only visible to the active storyteller.
   */
  async function refreshDemonBluffs(roomIdToLoad = room?.id, viewerPlayerId = currentPlayerId) {
    if (!roomIdToLoad || !viewerPlayerId) {
      setDemonBluffIds([]);
      return;
    }
    try {
      setDemonBluffIds(await listDemonBluffs(roomIdToLoad, viewerPlayerId));
    } catch {
      setDemonBluffIds([]);
    }
  }

  /**
   * Assigns the selected script characters and reloads the room after backend side effects.
   */
  async function assignSelectedCharactersRandomly() {
    if (!room) {
      return;
    }
    setError('');
    try {
      setAssignments(await assignRandomCharacters(room.id, currentPlayerId, randomCharacterIds));
      setRoom(await getRoom(room.id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Action failed');
    }
  }

  /**
   * Tracks which script characters are eligible for random assignment.
   */
  function toggleRandomCharacter(characterId: string) {
    setRandomCharacterIds((current) =>
      current.includes(characterId)
        ? current.filter((id) => id !== characterId)
        : [...current, characterId],
    );
  }

  /**
   * Persists storyteller demon bluffs and hydrates the room timestamp afterward.
   */
  async function saveDemonBluffs(nextBluffIds = demonBluffIds) {
    if (!room) {
      return;
    }
    setError('');
    try {
      setDemonBluffIds(await setDemonBluffs(room.id, currentPlayerId, nextBluffIds));
      setRoom(await getRoom(room.id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Action failed');
    }
  }

  /**
   * Updates one of the three demon bluff slots while keeping selections unique.
   */
  function setDemonBluffSlot(slotIndex: number, characterId: string) {
    const nextBluffIds = [...demonBluffIds];
    if (!characterId) {
      nextBluffIds.splice(slotIndex, 1);
    } else {
      nextBluffIds[slotIndex] = characterId;
    }
    const uniqueBluffs = nextBluffIds.filter((id, index, list) => id && list.indexOf(id) === index).slice(0, 3);
    void saveDemonBluffs(uniqueBluffs);
  }

  return {
    assignSelectedCharactersRandomly,
    assignments,
    characters,
    demonBluffIds,
    randomCharacterIds,
    refreshAssignments,
    reminderTokenDefinitions,
    setCharacters,
    setDemonBluffSlot,
    setReminderTokenDefinitions,
    toggleRandomCharacter,
  };
}
