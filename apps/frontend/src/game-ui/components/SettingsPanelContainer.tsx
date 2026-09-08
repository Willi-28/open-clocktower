/**
 * Settings panel data adapter.
 *
 * This container connects the presentational settings dialog to room state,
 * avatar uploads, saved client settings, and the composed voice controller.
 */

import { useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';

import { getPackCredits, uploadProfileImage, type PackCredits, type RoomState } from '../../api/client';
import { MediaDevicesWithOutputPicker } from '../../audio/browserAudio';
import type { ClientSettings } from '../clientSettings';
import type { useVoiceController } from '../hooks/useVoiceController';
import type { CreditsStatus } from './CreditsView';
import { SettingsPanel } from './SettingsPanel';

type SettingsPanelContainerProps = {
  availableCharacterLanguages: string[];
  clientSettings: ClientSettings;
  currentPlayerId: string;
  defaultCharacterLanguage: string;
  hideVoicePresence: boolean;
  isMuted: boolean;
  onClose: () => void;
  onMicTestActiveChange: (isActive: boolean) => void;
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
  hideVoicePresence,
  isMuted,
  onClose,
  onMicTestActiveChange,
  onToggleMuted,
  onUpdateClientSettings,
  playerName,
  room,
  setRoom,
  voice,
}: SettingsPanelContainerProps) {
  const { devices, peers, session } = voice;
  const [packCredits, setPackCredits] = useState<PackCredits | null>(null);
  const [packCreditsStatus, setPackCreditsStatus] = useState<CreditsStatus>('loading');
  const roomId = room?.id ?? null;

  // The container only exists while the dialog is open, so the credits are
  // fetched on open rather than kept in the room snapshot broadcast to everyone.
  useEffect(() => {
    if (!roomId) {
      setPackCredits(null);
      setPackCreditsStatus('error');
      return;
    }
    let isCurrent = true;
    setPackCreditsStatus('loading');
    void getPackCredits(roomId)
      .then((credits) => {
        if (isCurrent) {
          setPackCredits(credits);
          setPackCreditsStatus('ready');
        }
      })
      .catch(() => {
        if (isCurrent) {
          setPackCreditsStatus('error');
        }
      });
    return () => {
      isCurrent = false;
    };
  }, [roomId]);

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
      hideVoicePresence={hideVoicePresence}
      isMuted={isMuted}
      joinedVoiceRoom={session.joinedVoiceRoom}
      onChooseOutputDevice={() => void devices.chooseOutputDevice()}
      onClose={onClose}
      onMicTestActiveChange={onMicTestActiveChange}
      onRefreshDevices={() => void devices.refreshMediaDevices({ requestPermission: true })}
      onRequestVoiceStream={devices.requestVoiceStream}
      onSelectOutputDevice={devices.setSelectedAudioOutputId}
      onSwitchMicrophone={(deviceId) => void session.switchMicrophone(deviceId)}
      onToggleMuted={onToggleMuted}
      onUploadProfileImage={uploadCurrentPlayerImage}
      packCredits={packCredits}
      packCreditsStatus={packCreditsStatus}
      clientSettings={clientSettings}
      onUpdateClientSettings={updateClientSettings}
      playerName={playerName}
      volumePlayerIds={room?.players.map((player) => player.id) ?? []}
      remoteVolumes={peers.remoteVolumes}
      selectedAudioInputId={devices.selectedAudioInputId}
      selectedAudioOutputId={devices.selectedAudioOutputId}
      setRemoteVolumes={peers.setRemoteVolumes}
      voiceDiagnostics={peers.voiceDiagnostics}
    />
  );
}
