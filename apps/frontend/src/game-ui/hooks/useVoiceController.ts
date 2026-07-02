import { useEffect, useRef } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';

import type { Player, RoomState } from '../../api/client';
import type { openRoomSocket } from '../../websocket/roomSocket';
import { useVoiceActivity } from './useVoiceActivity';
import { useVoiceDevices } from './useVoiceDevices';
import { useVoicePeers } from './useVoicePeers';
import { useVoiceSession } from './useVoiceSession';

type UseVoiceControllerOptions = {
  canUseDefaultVoiceRoom: boolean;
  currentPlayer: Player | undefined;
  currentPlayerId: string;
  defaultVoiceRoom: string;
  isMuted: boolean;
  playerName: (playerId: string | undefined) => string;
  room: RoomState | null;
  roomSocketRef: MutableRefObject<ReturnType<typeof openRoomSocket> | null>;
  setError: (message: string) => void;
  soundFiltersEnabled: boolean;
  storyteller: Player | undefined;
};

/**
 * Coordinates voice devices, presence, peer connections, and activity detection.
 */
export function useVoiceController({
  canUseDefaultVoiceRoom,
  currentPlayer,
  currentPlayerId,
  defaultVoiceRoom,
  isMuted,
  playerName,
  room,
  roomSocketRef,
  setError,
  soundFiltersEnabled,
  storyteller,
}: UseVoiceControllerOptions) {
  const isMutedRef = useRef(false);
  // Session cleanup can happen before the peer hook is initialized in this render.
  const voicePeersRef = useRef<{
    closeAllVoicePeers: () => void;
    setVoiceDiagnostics: Dispatch<SetStateAction<Record<string, string>>>;
  } | null>(null);

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  const activity = useVoiceActivity({ currentPlayerId, isMutedRef });
  const devices = useVoiceDevices({
    currentPlayerId,
    isMuted,
    onLocalSpeakingStopped: activity.setPlayerSpeaking,
    onStartVoiceLevelMonitor: activity.startVoiceLevelMonitor,
    soundFiltersEnabled,
  });

  const session = useVoiceSession({
    canUseDefaultVoiceRoom,
    clientSoundFiltersEnabled: soundFiltersEnabled,
    closeAllVoicePeers: () => voicePeersRef.current?.closeAllVoicePeers(),
    currentPlayer,
    currentPlayerId,
    defaultVoiceRoom,
    getLocalVoiceStream: devices.getLocalVoiceStream,
    isMuted,
    playerName,
    replaceLocalVoiceStream: devices.replaceLocalVoiceStream,
    requestVoiceStream: devices.requestVoiceStream,
    room,
    roomSocketRef,
    selectedAudioInputId: devices.selectedAudioInputId,
    setError,
    setSelectedAudioInputId: devices.setSelectedAudioInputId,
    setVoiceDiagnostics: (action) => voicePeersRef.current?.setVoiceDiagnostics(action),
    stopAllVoiceLevelMonitors: activity.stopAllVoiceLevelMonitors,
    stopLocalVoiceStream: devices.stopLocalVoiceStream,
    storyteller,
  });

  const peers = useVoicePeers({
    applyAudioSink: devices.applyAudioSink,
    currentPlayerId,
    getLocalVoiceStream: devices.getLocalVoiceStream,
    iceServers: devices.iceServers,
    joinedVoiceRoom: session.joinedVoiceRoom,
    roomSocketRef,
    selectedAudioOutputId: devices.selectedAudioOutputId,
    startVoiceLevelMonitor: activity.startVoiceLevelMonitor,
    stopVoiceLevelMonitor: activity.stopVoiceLevelMonitor,
    voiceParticipants: session.voiceParticipants,
  });

  voicePeersRef.current = {
    closeAllVoicePeers: peers.closeAllVoicePeers,
    setVoiceDiagnostics: peers.setVoiceDiagnostics,
  };

  return {
    activity,
    devices,
    peers,
    session,
  };
}
