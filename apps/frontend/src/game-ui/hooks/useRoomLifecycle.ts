/**
 * Room lifecycle hook.
 *
 * This hook handles saved-session restoration, creating rooms, joining rooms,
 * leaving, kicking, deleting, and local cleanup around those room transitions.
 */

import { useEffect } from 'react';
import type { Dispatch, SetStateAction } from 'react';

import {
  createRoom,
  deleteRoom,
  getRoom,
  joinRoom,
  leaveRoom,
  RoomState,
  uploadCharacterPack,
} from '../../api/client';
import type { VoiceParticipant } from '../voiceRooms';
import { defaultSeatCount } from '../gameConfig';
import { lastSessionKey, sessionKey } from '../sessionStorage';

type UseRoomLifecycleOptions = {
  characterPackFile: File | null;
  currentPlayerId: string;
  displayName: string;
  endVoiceSession: (options: { notifyServer: boolean; playTone?: boolean; returnToDefault?: boolean }) => boolean;
  isStoryteller: boolean;
  room: RoomState | null;
  roomId: string;
  roomName: string;
  setCurrentPlayerId: (playerId: string) => void;
  setError: Dispatch<SetStateAction<string>>;
  setSelectedPlayerId: (playerId: string) => void;
  setSelectedSeatActionPlayerId: (playerId: string) => void;
  setRoom: (room: RoomState | null) => void;
  setVoiceParticipants: Dispatch<SetStateAction<VoiceParticipant[]>>;
  resetRealtimeUi: () => void;
};

/**
 * Owns room creation, joining, leaving, deletion, and common API error handling.
 */
export function useRoomLifecycle({
  characterPackFile,
  currentPlayerId,
  displayName,
  endVoiceSession,
  isStoryteller,
  room,
  roomId,
  roomName,
  resetRealtimeUi,
  setCurrentPlayerId,
  setError,
  setRoom,
  setSelectedPlayerId,
  setSelectedSeatActionPlayerId,
  setVoiceParticipants,
}: UseRoomLifecycleOptions) {
  useEffect(() => {
    const savedSession = localStorage.getItem(lastSessionKey());
    if (!savedSession) {
      return;
    }
    try {
      const parsed = JSON.parse(savedSession) as { roomId?: string; playerId?: string };
      if (!parsed.roomId || !parsed.playerId) {
        return;
      }
      void getRoom(parsed.roomId).then((savedRoom) => {
        if (!savedRoom.players.some((player) => player.id === parsed.playerId)) {
          localStorage.removeItem(lastSessionKey());
          return;
        }
        setRoom(savedRoom);
        setCurrentPlayerId(parsed.playerId ?? '');
        setSelectedPlayerId(parsed.playerId ?? '');
      }).catch(() => localStorage.removeItem(lastSessionKey()));
    } catch {
      localStorage.removeItem(lastSessionKey());
    }
  }, []);

  useEffect(() => {
    if (room && currentPlayerId) {
      localStorage.setItem(sessionKey(room.id), currentPlayerId);
      localStorage.setItem(lastSessionKey(), JSON.stringify({ roomId: room.id, playerId: currentPlayerId }));
    }
  }, [room?.id, currentPlayerId]);

  /**
   * Runs a room-changing API call and displays backend errors consistently.
   */
  async function run(action: () => Promise<RoomState>) {
    setError('');
    try {
      setRoom(await action());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Action failed');
    }
  }

  /**
   * Creates a new room and uploads the selected character pack for the founder.
   */
  async function createNewRoom() {
    setError('');
    if (!displayName.trim()) {
      setError('Enter your name first.');
      return;
    }
    if (!characterPackFile) {
      setError('Choose a character pack before creating a room.');
      return;
    }
    try {
      const nextRoom = await createRoom(roomName, displayName, defaultSeatCount);
      const founder = nextRoom.players.find((player) => player.is_storyteller);
      if (founder) {
        await uploadCharacterPack(nextRoom.id, founder.id, characterPackFile);
        const hydratedRoom = await getRoom(nextRoom.id);
        setRoom(hydratedRoom);
        setCurrentPlayerId(founder.id);
        setSelectedPlayerId(founder.id);
      } else {
        setRoom(nextRoom);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Action failed');
    }
  }

  /**
   * Opens an existing room or joins it as a new lobby player.
   */
  async function openOrJoinRoom() {
    setError('');
    if (!displayName.trim()) {
      setError('Enter your name first.');
      return;
    }
    try {
      const openedRoom = await getRoom(roomId);
      const rememberedPlayerId = localStorage.getItem(sessionKey(openedRoom.id));
      if (rememberedPlayerId && openedRoom.players.some((player) => player.id === rememberedPlayerId)) {
        setRoom(openedRoom);
        setCurrentPlayerId(rememberedPlayerId);
        setSelectedPlayerId(rememberedPlayerId);
        return;
      }

      const previousIds = new Set(openedRoom.players.map((player) => player.id));
      const nextRoom = await joinRoom(openedRoom.id, displayName, null);
      const hydratedRoom = await getRoom(openedRoom.id);
      const joined = nextRoom.players.find((player) => !previousIds.has(player.id));
      setRoom(hydratedRoom);
      if (joined) {
        setCurrentPlayerId(joined.id);
        setSelectedPlayerId(joined.id);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Action failed');
    }
  }

  /**
   * Lets a non-storyteller leave the lobby and clears local session state.
   */
  async function leaveCurrentLobby() {
    const currentPlayer = room?.players.find((player) => player.id === currentPlayerId);
    if (!room || !currentPlayer || currentPlayer.is_storyteller) {
      return;
    }
    setError('');
    try {
      await leaveRoom(room.id, currentPlayer.id, currentPlayer.id);
      endVoiceSession({ notifyServer: true, playTone: true, returnToDefault: false });
      localStorage.removeItem(sessionKey(room.id));
      localStorage.removeItem(lastSessionKey());
      setRoom(null);
      setCurrentPlayerId('');
      setSelectedPlayerId('');
      setSelectedSeatActionPlayerId('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Action failed');
    }
  }

  /**
   * Removes a lobby player at the storyteller's request.
   */
  async function kickPlayer(playerId: string) {
    if (!room || !isStoryteller || playerId === currentPlayerId) {
      return;
    }
    setError('');
    try {
      setRoom(await leaveRoom(room.id, playerId, currentPlayerId));
      setSelectedSeatActionPlayerId('');
      setSelectedPlayerId(currentPlayerId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Action failed');
    }
  }

  /**
   * Deletes the room and clears all local realtime state for the current client.
   */
  async function deleteCurrentRoom() {
    if (!room || !isStoryteller) {
      return;
    }
    setError('');
    try {
      await deleteRoom(room.id, currentPlayerId);
      endVoiceSession({ notifyServer: false, playTone: true });
      localStorage.removeItem(sessionKey(room.id));
      localStorage.removeItem(lastSessionKey());
      setVoiceParticipants([]);
      resetRealtimeUi();
      setRoom(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Action failed');
    }
  }

  return {
    createNewRoom,
    deleteCurrentRoom,
    kickPlayer,
    leaveCurrentLobby,
    openOrJoinRoom,
    run,
  };
}
