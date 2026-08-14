/**
 * Voice session membership hook.
 *
 * This module tracks the current public/private voice room, handles private
 * call flows, and tears down/restarts local voice capture when membership changes.
 */

import { useEffect, useRef, useState } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';

import { playVoiceTone } from '../../audio/browserAudio';
import type { Player, RoomState } from '../../api/client';
import type { openRoomSocket } from '../../websocket/roomSocket';
import { privateVoiceRoomFor, type VoiceParticipant } from '../voiceRooms';
import type { VoiceStreamRequest } from './useVoiceDevices';

type RoomSocketRef = MutableRefObject<ReturnType<typeof openRoomSocket> | null>;

type RestartVoiceInputOptions = {
  deviceId?: string;
  soundFiltersEnabled?: boolean;
};

type UseVoiceSessionOptions = {
  canUseDefaultVoiceRoom: boolean;
  clientSoundFiltersEnabled: boolean;
  closeAllVoicePeers: () => void;
  currentPlayer: Player | undefined;
  currentPlayerId: string;
  defaultVoiceRoom: string;
  getLocalVoiceStream: (deviceId?: string) => Promise<MediaStream>;
  isMuted: boolean;
  playerName: (playerId: string | undefined) => string;
  replaceLocalVoiceStream: (stream: MediaStream, cleanup?: () => void, monitorStream?: MediaStream) => void;
  requestVoiceStream: (deviceId: string, soundFiltersEnabled: boolean) => Promise<VoiceStreamRequest>;
  room: RoomState | null;
  roomSocketRef: RoomSocketRef;
  selectedAudioInputId: string;
  setError: (message: string) => void;
  setSelectedAudioInputId: (deviceId: string) => void;
  setVoiceDiagnostics: Dispatch<SetStateAction<Record<string, string>>>;
  silenceLocalVoiceStream: () => void;
  stopAllVoiceLevelMonitors: () => void;
  stopLocalVoiceStream: () => void;
  storyteller: Player | undefined;
};

/**
 * Coordinates voice room membership, private calls, and local session lifecycle.
 */
export function useVoiceSession({
  canUseDefaultVoiceRoom,
  clientSoundFiltersEnabled,
  closeAllVoicePeers,
  currentPlayer,
  currentPlayerId,
  defaultVoiceRoom,
  getLocalVoiceStream,
  isMuted,
  playerName,
  replaceLocalVoiceStream,
  requestVoiceStream,
  room,
  roomSocketRef,
  selectedAudioInputId,
  setError,
  setSelectedAudioInputId,
  setVoiceDiagnostics,
  silenceLocalVoiceStream,
  stopAllVoiceLevelMonitors,
  stopLocalVoiceStream,
  storyteller,
}: UseVoiceSessionOptions) {
  const joinedVoiceRoomRef = useRef<string | null>(null);
  const voiceActionIdRef = useRef(0);
  const voiceSwitchInFlightRef = useRef(false);
  const optimisticVoiceRoomRef = useRef<string | null>(null);
  const [selectedVoiceRoom, setSelectedVoiceRoom] = useState(defaultVoiceRoom);
  const [joinedVoiceRoom, setJoinedVoiceRoom] = useState<string | null>(null);
  const [voiceParticipants, setVoiceParticipants] = useState<VoiceParticipant[]>([]);
  const [incomingVoiceCall, setIncomingVoiceCall] = useState<{ fromPlayerId: string; voiceRoom: string } | null>(null);
  const [isVoiceSwitching, setIsVoiceSwitching] = useState(false);

  useEffect(() => {
    joinedVoiceRoomRef.current = joinedVoiceRoom;
  }, [joinedVoiceRoom]);

  useEffect(() => {
    const isStorytellerCall =
      Boolean(joinedVoiceRoom?.includes(':private:') && storyteller && joinedVoiceRoom.includes(storyteller.id));
    if (
      room?.phase === 'night' &&
      !room.allow_public_voice_during_night &&
      currentPlayer &&
      !currentPlayer.is_storyteller &&
      joinedVoiceRoom &&
      !isStorytellerCall
    ) {
      // Night takes players out of voice, but the microphone stays captured
      // (silenced). Re-acquiring it at sunrise would need getUserMedia, which
      // browsers defer or refuse while the tab is in the background - the
      // player would then stay silent until they clicked back into the window.
      endVoiceSession({ notifyServer: true, playTone: true, keepMicrophone: true });
    }
  }, [room?.phase, room?.allow_public_voice_during_night, currentPlayer?.id, currentPlayer?.is_storyteller, joinedVoiceRoom, storyteller?.id]);

  useEffect(() => {
    if (!canUseDefaultVoiceRoom || joinedVoiceRoom) {
      return;
    }
    void joinSelectedVoiceRoom(defaultVoiceRoom);
  }, [canUseDefaultVoiceRoom, joinedVoiceRoom, room?.id, currentPlayer?.id]);

  /**
   * Applies server voice presence while preserving an optimistic local room switch.
   */
  function applyVoiceParticipants(participants: VoiceParticipant[]) {
    const optimisticVoiceRoom = optimisticVoiceRoomRef.current;
    const confirmedOptimisticRoom = participants.some(
      (participant) => participant.playerId === currentPlayerId && participant.voiceRoom === optimisticVoiceRoom,
    );
    if (confirmedOptimisticRoom) {
      optimisticVoiceRoomRef.current = null;
    }
    setVoiceParticipants(
      optimisticVoiceRoom && currentPlayerId && !confirmedOptimisticRoom
        ? [
            ...participants.filter((participant) => participant.playerId !== currentPlayerId),
            { playerId: currentPlayerId, voiceRoom: optimisticVoiceRoom },
          ]
        : participants,
    );
  }

  /**
   * Joins a public or private voice room and starts local capture if needed.
   */
  async function joinSelectedVoiceRoom(voiceRoom = selectedVoiceRoom) {
    if (voiceSwitchInFlightRef.current && joinedVoiceRoomRef.current !== voiceRoom) {
      return;
    }
    const actionId = voiceActionIdRef.current + 1;
    voiceActionIdRef.current = actionId;
    voiceSwitchInFlightRef.current = true;
    setIsVoiceSwitching(true);
    optimisticVoiceRoomRef.current = voiceRoom;
    setError('');
    try {
      if (joinedVoiceRoom && joinedVoiceRoom !== voiceRoom) {
        // Switching rooms must NOT send an explicit `voice.leave`: the server
        // clears a player's mute/deafen presence whenever their voice room
        // becomes null, so a leave-then-join round-trip silently dropped the
        // deafen/mute badge on every switch. Joining the new room moves the
        // player server-side while preserving that presence; the old room's
        // peer connections are still torn down locally here.
        closeAllVoicePeers();
      }
      await getLocalVoiceStream();
      if (voiceActionIdRef.current !== actionId) {
        return;
      }
      setVoiceParticipants((current) => {
        if (!currentPlayerId) {
          return current;
        }
        return [
          ...current.filter((participant) => participant.playerId !== currentPlayerId),
          { playerId: currentPlayerId, voiceRoom },
        ];
      });
      setSelectedVoiceRoom(voiceRoom);
      setJoinedVoiceRoom(voiceRoom);
      roomSocketRef.current?.joinVoiceRoom(voiceRoom);
      playVoiceTone('join');
    } catch (caught) {
      if (voiceActionIdRef.current === actionId) {
        setError(caught instanceof Error ? caught.message : 'Could not access microphone');
      }
    } finally {
      if (voiceActionIdRef.current === actionId) {
        voiceSwitchInFlightRef.current = false;
        setIsVoiceSwitching(false);
      }
    }
  }

  /**
   * Requests a private voice room with another player.
   */
  async function startPrivateCall(targetPlayerId: string) {
    const voiceRoom = privateVoiceRoomFor(currentPlayerId, targetPlayerId);
    setError(`Calling ${playerName(targetPlayerId)}...`);
    try {
      await getLocalVoiceStream();
      roomSocketRef.current?.requestVoiceCall(targetPlayerId, voiceRoom);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not access microphone');
    }
  }

  /**
   * Accepts the pending private call and joins its private room.
   */
  async function acceptPrivateCall() {
    if (!incomingVoiceCall) {
      return;
    }
    const call = incomingVoiceCall;
    setIncomingVoiceCall(null);
    roomSocketRef.current?.respondVoiceCall(call.fromPlayerId, call.voiceRoom, true);
    await joinSelectedVoiceRoom(call.voiceRoom);
  }

  /**
   * Rejects the pending private call without changing voice rooms.
   */
  function rejectPrivateCall() {
    if (!incomingVoiceCall) {
      return;
    }
    roomSocketRef.current?.respondVoiceCall(incomingVoiceCall.fromPlayerId, incomingVoiceCall.voiceRoom, false);
    setIncomingVoiceCall(null);
  }

  /**
   * Leaves the current voice room and optionally schedules the public fallback.
   */
  function leaveVoiceRoom(returnToDefault = true) {
    const shouldReturnToDefault = endVoiceSession({ notifyServer: true, playTone: true, returnToDefault });
    if (shouldReturnToDefault) {
      window.setTimeout(() => {
        void joinSelectedVoiceRoom(defaultVoiceRoom);
      }, 0);
    }
  }

  /**
   * Tears down local voice state and returns whether the public fallback should be joined.
   *
   * `keepMicrophone` retains the capture pipeline (silenced) instead of
   * releasing it, so rejoining later needs no getUserMedia call.
   */
  function endVoiceSession(options: {
    notifyServer: boolean;
    playTone?: boolean;
    returnToDefault?: boolean;
    keepMicrophone?: boolean;
  }) {
    voiceActionIdRef.current += 1;
    voiceSwitchInFlightRef.current = false;
    optimisticVoiceRoomRef.current = null;
    setIsVoiceSwitching(false);
    const wasInVoiceRoom = joinedVoiceRoom !== null;
    const shouldReturnToDefault =
      Boolean(options.returnToDefault) &&
      joinedVoiceRoom !== null &&
      joinedVoiceRoom !== defaultVoiceRoom &&
      canUseDefaultVoiceRoom;

    if (options.playTone && wasInVoiceRoom) {
      playVoiceTone('leave');
    }
    if (options.notifyServer) {
      roomSocketRef.current?.leaveVoiceRoom();
    }
    setJoinedVoiceRoom(null);
    setSelectedVoiceRoom(defaultVoiceRoom);
    setIncomingVoiceCall(null);
    setVoiceParticipants((current) => current.filter((participant) => participant.playerId !== currentPlayerId));
    closeAllVoicePeers();
    if (options.keepMicrophone) {
      silenceLocalVoiceStream();
    } else {
      stopLocalVoiceStream();
    }
    stopAllVoiceLevelMonitors();
    setVoiceDiagnostics({});
    return shouldReturnToDefault;
  }

  /**
   * Switches microphone input and rejoins the active room with a new local stream.
   */
  async function switchMicrophone(deviceId: string) {
    setSelectedAudioInputId(deviceId);
    await restartVoiceInput({ deviceId });
  }

  /**
   * Restarts local capture while preserving the currently joined voice room.
   */
  async function restartVoiceInput(options: RestartVoiceInputOptions = {}) {
    const roomToRejoin = joinedVoiceRoom;
    if (!roomToRejoin) {
      return;
    }
    const actionId = voiceActionIdRef.current + 1;
    voiceActionIdRef.current = actionId;
    voiceSwitchInFlightRef.current = true;
    setIsVoiceSwitching(true);
    roomSocketRef.current?.leaveVoiceRoom();
    closeAllVoicePeers();
    stopLocalVoiceStream();
    try {
      const nextDeviceId = options.deviceId ?? selectedAudioInputId;
      const nextSoundFiltersEnabled = options.soundFiltersEnabled ?? clientSoundFiltersEnabled;
      const { stream, cleanup, monitorStream } = await requestVoiceStream(nextDeviceId, nextSoundFiltersEnabled);
      stream.getAudioTracks().forEach((track) => {
        track.enabled = !isMuted;
      });
      if (voiceActionIdRef.current !== actionId) {
        cleanup?.();
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      replaceLocalVoiceStream(stream, cleanup, monitorStream);
      roomSocketRef.current?.joinVoiceRoom(roomToRejoin);
    } catch (caught) {
      if (voiceActionIdRef.current === actionId) {
        setError(caught instanceof Error ? caught.message : 'Could not switch voice processing');
        setJoinedVoiceRoom(null);
      }
    } finally {
      if (voiceActionIdRef.current === actionId) {
        voiceSwitchInFlightRef.current = false;
        setIsVoiceSwitching(false);
      }
    }
  }

  return {
    acceptPrivateCall,
    applyVoiceParticipants,
    endVoiceSession,
    incomingVoiceCall,
    isVoiceSwitching,
    joinSelectedVoiceRoom,
    joinedVoiceRoom,
    leaveVoiceRoom,
    rejectPrivateCall,
    restartVoiceInput,
    setIncomingVoiceCall,
    setVoiceParticipants,
    startPrivateCall,
    switchMicrophone,
    voiceParticipants,
  };
}
