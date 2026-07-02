/**
 * Settings panel data adapter.
 *
 * This container connects the presentational settings dialog to room state,
 * avatar uploads, saved client settings, and the composed voice controller.
 */

import type { Dispatch, SetStateAction } from 'react';

import { uploadProfileImage, type RoomState } from '../../api/client';
import { MediaDevicesWithOutputPicker } from '../../audio/browserAudio';
import type { ClientSettings } from '../clientSettings';
import type { useVoiceController } from '../hooks/useVoiceController';
import { SettingsPanel } from './SettingsPanel';

type SettingsPanelContainerProps = {
  availableCharacterLanguages: string[];
  clientSettings: ClientSettings;
  currentPlayerId: string;
  defaultCharacterLanguage: string;
  isMuted: boolean;
  onClose: () => void;
  onToggleMuted: () => void;
  onUpdateClientSettings: Dispatch<SetStateAction<ClientSettings>>;
  playerName: (playerId: string | undefined) => string;
  room: RoomState | null;
  setRoom: (room: RoomState) => void;
  voice: ReturnType<typeof useVoiceController>;
};

/**
 * Adapts the composed voice/settings hooks to the dense settings panel props.
 */
export function SettingsPanelContainer({
  availableCharacterLanguages,
  clientSettings,
  currentPlayerId,
  defaultCharacterLanguage,
  isMuted,
  onClose,
  onToggleMuted,
  onUpdateClientSettings,
  playerName,
  room,
  setRoom,
  voice,
}: SettingsPanelContainerProps) {
  const { devices, peers, session } = voice;

  /**
   * Uploads the current player's avatar through the room API.
   */
  async function uploadCurrentPlayerImage(file: File) {
    if (!room || !currentPlayerId) {
      return;
    }
    setRoom(await uploadProfileImage(room.id, currentPlayerId, currentPlayerId, file));
  }

  /**
   * Keeps persisted settings and active voice processing in sync.
   */
  function updateClientSettings(settings: Partial<Parameters<typeof SettingsPanel>[0]['clientSettings']>) {
    onUpdateClientSettings((current) => ({ ...current, ...settings } as ClientSettings));
    if (typeof settings.soundFiltersEnabled === 'boolean') {
      void session.restartVoiceInput({ soundFiltersEnabled: settings.soundFiltersEnabled });
    }
  }

  return (
    <SettingsPanel
      audioInputDevices={devices.audioInputDevices}
      audioOutputDevices={devices.audioOutputDevices}
      audioDeviceStatus={devices.audioDeviceStatus}
      availableCharacterLanguages={availableCharacterLanguages}
      currentPlayerId={currentPlayerId}
      defaultCharacterLanguage={defaultCharacterLanguage}
      hasOutputDevicePicker={Boolean((navigator.mediaDevices as MediaDevicesWithOutputPicker | undefined)?.selectAudioOutput)}
      isMuted={isMuted}
      joinedVoiceRoom={session.joinedVoiceRoom}
      onChooseOutputDevice={() => void devices.chooseOutputDevice()}
      onClose={onClose}
      onRefreshDevices={() => void devices.refreshMediaDevices({ requestPermission: true })}
      onRequestVoiceStream={devices.requestVoiceStream}
      onSelectOutputDevice={devices.setSelectedAudioOutputId}
      onSwitchMicrophone={(deviceId) => void session.switchMicrophone(deviceId)}
      onToggleMuted={onToggleMuted}
      onUploadProfileImage={uploadCurrentPlayerImage}
      clientSettings={clientSettings}
      onUpdateClientSettings={updateClientSettings}
      playerName={playerName}
      volumePlayerIds={room?.players.map((player) => player.id) ?? []}
      remoteVolumes={peers.remoteVolumes}
      selectedAudioInputId={devices.selectedAudioInputId}
      selectedAudioOutputId={devices.selectedAudioOutputId}
      setRemoteVolumes={peers.setRemoteVolumes}
      voiceDiagnostics={peers.voiceDiagnostics}
      voiceParticipants={session.voiceParticipants}
    />
  );
}
