/**
 * Voice feature composition hook.
 *
 * It wires together device capture, room membership, peer connections, and
 * speech activity so App.tsx can consume one coherent voice controller.
 */

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
  initialRemoteVolumes: Record<string, number>;
  isMuted: boolean;
  onRemoteVolumesChange: (remoteVolumes: Record<string, number>) => void;
  onSelectedAudioInputIdChange: (deviceId: string) => void;
  onSelectedAudioOutputIdChange: (deviceId: string) => void;
  playerName: (playerId: string | undefined) => string;
  room: RoomState | null;
  roomSocketRef: MutableRefObject<ReturnType<typeof openRoomSocket> | null>;
  selectedAudioInputId: string;
  selectedAudioOutputId: string;
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
  initialRemoteVolumes,
  isMuted,
  onRemoteVolumesChange,
  onSelectedAudioInputIdChange,
  onSelectedAudioOutputIdChange,
  playerName,
  room,
  roomSocketRef,
  selectedAudioInputId,
  selectedAudioOutputId,
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
  // The devices hook needs to trigger a session restart (mic unplugged) but the
  // session hook is created after it, so the call goes through a ref.
  const restartVoiceInputRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  const activity = useVoiceActivity({ currentPlayerId, isMutedRef });
  const devices = useVoiceDevices({
    currentPlayerId,
    initialAudioInputId: selectedAudioInputId,
    initialAudioOutputId: selectedAudioOutputId,
    isMuted,
    onSelectedAudioInputIdChange,
    onSelectedAudioOutputIdChange,
    onLocalSpeakingStopped: activity.setPlayerSpeaking,
    onLocalTrackEnded: () => restartVoiceInputRef.current?.(),
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
    silenceLocalVoiceStream: devices.silenceLocalVoiceStream,
    stopAllVoiceLevelMonitors: activity.stopAllVoiceLevelMonitors,
    stopLocalVoiceStream: devices.stopLocalVoiceStream,
    storyteller,
  });

  const peers = useVoicePeers({
    applyAudioSink: devices.applyAudioSink,
    currentPlayerId,
    getLocalVoiceStream: devices.getLocalVoiceStream,
    iceServers: devices.iceServers,
    initialRemoteVolumes,
    joinedVoiceRoom: session.joinedVoiceRoom,
    onRemoteVolumesChange,
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
  // The dead device id was already dropped by the devices hook, so the restart
  // captures whatever microphone is the current selection/default.
  restartVoiceInputRef.current = () => void session.restartVoiceInput({});

  return {
    activity,
    devices,
    peers,
    session,
  };
}
