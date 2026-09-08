/**
 * Client settings dialog.
 *
 * This panel owns local preferences such as profile image upload, output test,
 * microphone test/monitoring, board theme, language, and per-player volume.
 */

import { useEffect, useRef, useState } from 'react';

import type { PackCredits } from '../../api/client';
import { uiLanguages, useUiText, type UiLanguage } from '../../i18n';
import type { VoiceStreamRequest } from '../hooks/useVoiceDevices';
import { CreditsView, type CreditsStatus } from './CreditsView';
import { VoiceMuteIcon } from './VoiceMuteIcon';

type SettingsPanelProps = {
  audioInputDevices: MediaDeviceInfo[];
  audioOutputDevices: MediaDeviceInfo[];
  audioDeviceStatus: string;
  availableCharacterLanguages: string[];
  currentPlayerId: string;
  defaultCharacterLanguage: string;
  hasOutputDevicePicker: boolean;
  hideVoicePresence: boolean;
  isMuted: boolean;
  joinedVoiceRoom: string | null;
  onChooseOutputDevice: () => void;
  onClose: () => void;
  onMicTestActiveChange: (isActive: boolean) => void;
  onRefreshDevices: () => void;
  onRequestVoiceStream: (deviceId: string, soundFiltersEnabled: boolean) => Promise<VoiceStreamRequest>;
  onSelectOutputDevice: (deviceId: string) => void;
  onSwitchMicrophone: (deviceId: string) => void;
  onToggleMuted: () => void;
  onUploadProfileImage: (file: File) => Promise<void>;
  packCredits: PackCredits | null;
  packCreditsStatus: CreditsStatus;
  playerName: (playerId: string | undefined) => string;
  volumePlayerIds: string[];
  remoteVolumes: Record<string, number>;
  selectedAudioInputId: string;
  selectedAudioOutputId: string;
  setRemoteVolumes: (updater: (current: Record<string, number>) => Record<string, number>) => void;
  voiceDiagnostics: Record<string, string>;
  clientSettings: {
    showTable: boolean;
    appTheme: string;
    nightEffect: string;
    soundVolume: number;
    soundFiltersEnabled: boolean;
    characterLanguage: string;
    uiLanguage: UiLanguage;
  };
  onUpdateClientSettings: (settings: Partial<SettingsPanelProps['clientSettings']>) => void;
};

/** Render and manage all client-local settings tabs. */
export function SettingsPanel({
  audioInputDevices,
  audioOutputDevices,
  audioDeviceStatus,
  availableCharacterLanguages,
  currentPlayerId,
  defaultCharacterLanguage,
  hasOutputDevicePicker,
  hideVoicePresence,
  isMuted,
  joinedVoiceRoom,
  onChooseOutputDevice,
  onClose,
  onMicTestActiveChange,
  onRefreshDevices,
  onRequestVoiceStream,
  onSelectOutputDevice,
  onSwitchMicrophone,
  onToggleMuted,
  onUploadProfileImage,
  packCredits,
  packCreditsStatus,
  playerName,
  volumePlayerIds,
  remoteVolumes,
  selectedAudioInputId,
  selectedAudioOutputId,
  setRemoteVolumes,
  voiceDiagnostics,
  clientSettings,
  onUpdateClientSettings,
}: SettingsPanelProps) {
  const remoteParticipantIds = volumePlayerIds.filter((playerId) => playerId !== currentPlayerId);
  const audioTestRef = useRef<HTMLAudioElement | null>(null);
  const monitorAudioRef = useRef<HTMLAudioElement | null>(null);
  const micCleanupRef = useRef<(() => void) | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const micContextRef = useRef<AudioContext | null>(null);
  const micAnimationRef = useRef<number | null>(null);
  const micMeterRef = useRef<HTMLSpanElement | null>(null);
  // Tracks the last mic-test state we reported to the parent, so we only signal
  // real start/stop transitions (never a spurious "stopped" on mount).
  const micTestReportedRef = useRef(false);
  const [isTestingMic, setIsTestingMic] = useState(false);
  const [testStatus, setTestStatus] = useState('');
  const [profileStatus, setProfileStatus] = useState('');
  const t = useUiText();
  const [activeTab, setActiveTab] = useState<'general' | 'sound' | 'board' | 'characters' | 'voice' | 'credits'>('general');

  useEffect(() => {
    return () => {
      stopMicTest();
      // Closing the panel mid-test must restore the pre-test mute state. Unmount
      // won't re-run the transition effect below, so report the stop here.
      if (micTestReportedRef.current) {
        micTestReportedRef.current = false;
        onMicTestActiveChange(false);
      }
    };
  }, []);

  // The live microphone must not broadcast the test into the voice room, so the
  // app mutes it while the input test runs and restores it afterwards. Report
  // only real transitions: firing on mount (isTestingMic starts false) would
  // spuriously "stop" a test that never ran and unmute an already-muted or
  // deafened mic.
  useEffect(() => {
    if (micTestReportedRef.current === isTestingMic) {
      return;
    }
    micTestReportedRef.current = isTestingMic;
    onMicTestActiveChange(isTestingMic);
  }, [isTestingMic]);

  useEffect(() => {
    if (!isTestingMic) {
      return;
    }
    let isCancelled = false;

    void startMicTest().then((stream) => {
      if (isCancelled || !stream) {
        return;
      }
    });

    return () => {
      isCancelled = true;
    };
  }, [clientSettings.soundFiltersEnabled, selectedAudioInputId]);

  useEffect(() => {
    const audio = monitorAudioRef.current as (HTMLAudioElement & { setSinkId?: (sinkId: string) => Promise<void> }) | null;
    if (audio && selectedAudioOutputId && audio.setSinkId) {
      void audio.setSinkId(selectedAudioOutputId).catch(() => setTestStatus('Could not monitor through the selected output device.'));
    }
  }, [selectedAudioOutputId]);

  /** Play a short generated tone through the selected output device. */
  async function testOutputDevice() {
    setTestStatus('');
    const AudioContextClass = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) {
      setTestStatus('Audio test is not supported by this browser.');
      return;
    }

    const audioContext = new AudioContextClass();
    const destination = audioContext.createMediaStreamDestination();
    const gain = audioContext.createGain();
    const masterGain = audioContext.createGain();
    gain.gain.setValueAtTime(0.001, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.2, audioContext.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.7);
    masterGain.gain.value = clientSettings.soundVolume;
    gain.connect(masterGain);
    masterGain.connect(destination);

    [520, 780].forEach((frequency, index) => {
      const oscillator = audioContext.createOscillator();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime + index * 0.12);
      oscillator.connect(gain);
      oscillator.start(audioContext.currentTime + index * 0.12);
      oscillator.stop(audioContext.currentTime + 0.72 + index * 0.12);
    });

    const audio = audioTestRef.current ?? new Audio();
    audioTestRef.current = audio;
    audio.srcObject = destination.stream;
    const audioWithSink = audio as HTMLAudioElement & { setSinkId?: (sinkId: string) => Promise<void> };
    if (selectedAudioOutputId && audioWithSink.setSinkId) {
      await audioWithSink.setSinkId(selectedAudioOutputId).catch(() => setTestStatus('Could not switch to the selected output device.'));
    }
    await audio.play().catch(() => setTestStatus('Browser blocked the output test. Try clicking again.'));
    window.setTimeout(() => {
      audio.pause();
      audio.srcObject = null;
      void audioContext.close();
    }, 1200);
  }

  /** Start microphone capture, level metering, RNNoise if enabled, and self-monitoring. */
  async function startMicTest() {
    setTestStatus('');
    stopMicTest();
    try {
      const { stream, cleanup } = await onRequestVoiceStream(selectedAudioInputId, clientSettings.soundFiltersEnabled);
      micStreamRef.current = stream;
      micCleanupRef.current = cleanup ?? null;
      setIsTestingMic(true);

      const audioContext = new AudioContext();
      micContextRef.current = audioContext;
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 128;
      source.connect(analyser);
      const values = new Uint8Array(analyser.frequencyBinCount);
      let lastUpdate = 0;

      /** Update the visible input meter from analyser data. */
      const updateLevel = (timestamp: number) => {
        analyser.getByteFrequencyData(values);
        if (timestamp - lastUpdate > 120) {
          const average = values.reduce((sum, value) => sum + value, 0) / values.length;
          const level = Math.min(100, Math.round((average / 128) * 100));
          if (micMeterRef.current) {
            micMeterRef.current.style.width = `${level}%`;
          }
          lastUpdate = timestamp;
        }
        micAnimationRef.current = window.requestAnimationFrame(updateLevel);
      };
      micAnimationRef.current = window.requestAnimationFrame(updateLevel);
      await startSelfMonitor(stream);
      return stream;
    } catch (caught) {
      setTestStatus(caught instanceof Error ? caught.message : 'Could not access microphone.');
      setIsTestingMic(false);
      return null;
    }
  }

  /** Route the tested microphone stream back to the selected output device. */
  async function startSelfMonitor(stream: MediaStream) {
    const audio = monitorAudioRef.current ?? new Audio();
    monitorAudioRef.current = audio;
    audio.autoplay = true;
    audio.controls = false;
    audio.muted = false;
    audio.volume = 0.8;
    audio.srcObject = stream;

    const audioWithSink = audio as HTMLAudioElement & { setSinkId?: (sinkId: string) => Promise<void> };
    if (selectedAudioOutputId && audioWithSink.setSinkId) {
      await audioWithSink.setSinkId(selectedAudioOutputId).catch(() => setTestStatus('Could not monitor through the selected output device.'));
    }
    if (!audio.parentElement) {
      audio.style.display = 'none';
      document.body.appendChild(audio);
    }

    await audio
      .play()
      .then(() => setTestStatus('Input test is playing through your selected output. Use headphones to avoid feedback.'))
      .catch(() => setTestStatus('Browser blocked microphone monitoring. Try clicking again.'));
  }

  /** Stop the hidden audio element used for local microphone monitoring. */
  function stopSelfMonitor() {
    const audio = monitorAudioRef.current;
    if (audio) {
      audio.pause();
      audio.srcObject = null;
      audio.remove();
    }
    monitorAudioRef.current = null;
  }

  /** Stop microphone testing, cleanup media tracks, and reset the level meter. */
  function stopMicTest() {
    stopSelfMonitor();
    if (micAnimationRef.current !== null) {
      window.cancelAnimationFrame(micAnimationRef.current);
      micAnimationRef.current = null;
    }
    micCleanupRef.current?.();
    micCleanupRef.current = null;
    micStreamRef.current?.getTracks().forEach((track) => track.stop());
    micStreamRef.current = null;
    void micContextRef.current?.close();
    micContextRef.current = null;
    setIsTestingMic(false);
    if (micMeterRef.current) {
      micMeterRef.current.style.width = '0%';
    }
  }

  return (
    <div className="settings-backdrop" role="presentation" onClick={onClose}>
      <section className="settings-panel" role="dialog" aria-modal="true" aria-label={t('Client settings')} onClick={(event) => event.stopPropagation()}>
        <div className="settings-header">
          <div>
            <h2>{t('Client Settings')}</h2>
            <p className="helper-text">{t('Voice and local playback preferences.')}</p>
          </div>
          <button className="secondary" onClick={onClose} type="button">{t('Close')}</button>
        </div>

        <div className="settings-tabs">
          {[
            ['general', 'General'],
            ['sound', 'Sound'],
            ['board', 'Board'],
            ['characters', 'Language'],
            ['voice', 'Voicechat'],
            ['credits', 'Credits'],
          ].map(([tabId, label]) => (
            <button className={activeTab === tabId ? 'active' : 'secondary'} key={tabId} onClick={() => setActiveTab(tabId as typeof activeTab)} type="button">
              {t(label)}
            </button>
          ))}
        </div>

        {activeTab === 'general' ? (
          <div className="settings-tab-panel">
            <label>{t('Profile Image')}<input
                accept="image/png,image/jpeg,image/gif"
                type="file"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) {
                    return;
                  }
                  setProfileStatus('');
                  void onUploadProfileImage(file)
                    .then(() => setProfileStatus('Profile image updated.'))
                    .catch((error) => setProfileStatus(error instanceof Error ? error.message : 'Upload failed.'));
                  event.currentTarget.value = '';
                }}
              />
            </label>
            {profileStatus ? <p className="helper-text">{t(profileStatus)}</p> : null}
          </div>
        ) : null}

        {activeTab === 'sound' ? (
          <div className="settings-tab-panel">
            <label className="volume-row">
              <span>{t('Sound Volume')}</span>
              <input
                aria-label={t('Sound volume')}
                max="2"
                min="0"
                step="0.05"
                type="range"
                value={clientSettings.soundVolume}
                onChange={(event) => onUpdateClientSettings({ soundVolume: Number(event.target.value) })}
              />
              <strong>{Math.round(clientSettings.soundVolume * 100)}%</strong>
            </label>
            <label>{t('Output Device')}<select value={selectedAudioOutputId} onChange={(event) => onSelectOutputDevice(event.target.value)}>
                <option value="">{t('System default')}</option>
                {audioOutputDevices.map((device, index) => (
                  <option key={device.deviceId || index} value={device.deviceId}>
                    {device.label || t('Output {index}', { index: index + 1 })}
                  </option>
                ))}
              </select>
            </label>
            {audioDeviceStatus ? <p className="helper-text">{t(audioDeviceStatus)}</p> : null}
            {hasOutputDevicePicker ? (
              <button className="secondary" onClick={onChooseOutputDevice} type="button">{t('Choose Output Device')}</button>
            ) : audioOutputDevices.length === 0 ? (
              <p className="helper-text">{t('This browser only exposes the system default output.')}</p>
            ) : null}
            <button className="secondary" onClick={() => void testOutputDevice()} type="button">{t('Test Output')}</button>
            {testStatus ? <p className="helper-text">{t(testStatus)}</p> : null}
          </div>
        ) : null}

        {activeTab === 'board' ? (
          <div className="settings-tab-panel">
            <label>{t('Theme')}<select value={clientSettings.appTheme} onChange={(event) => onUpdateClientSettings({ appTheme: event.target.value })}>
                <option value="classic">{t('Classic')}</option>
                <option value="dark">{t('Dark')}</option>
                <option value="light">{t('Light')}</option>
                <option value="universe">{t('Universe')}</option>
                <option value="magic">{t('Magic')}</option>
                <option value="island">{t('Island')}</option>
                <option value="retro-rpg">{t('Retro RPG')}</option>
                <option value="flog-in">{t('Moon')}</option>
              </select>
            </label>
            <label>{t('Night Vision')}<select value={clientSettings.nightEffect} onChange={(event) => onUpdateClientSettings({ nightEffect: event.target.value })}>
                <option value="subtle">{t('Subtle moonlight')}</option>
                <option value="fog">{t('Soft fog')}</option>
                <option value="none">{t('No effect')}</option>
              </select>
            </label>
            <label className="checkbox-row">
              <input checked={clientSettings.showTable} type="checkbox" onChange={(event) => onUpdateClientSettings({ showTable: event.target.checked })} />{t('Show table')}</label>
          </div>
        ) : null}

        {activeTab === 'characters' ? (
          <div className="settings-tab-panel">
            <label>
              {t('Interface Language')}
              <select
                value={clientSettings.uiLanguage}
                onChange={(event) => onUpdateClientSettings({ uiLanguage: event.target.value as UiLanguage })}
              >
                {uiLanguages.map((language) => (
                  <option key={language.code} value={language.code}>
                    {language.label}
                  </option>
                ))}
              </select>
            </label>
            <p className="helper-text">{t('Changes the app text on this device. Character packs are translated separately below.')}</p>
            <label>
              {t('Character Sheet Language')}
              <select
                value={clientSettings.characterLanguage}
                onChange={(event) => onUpdateClientSettings({ characterLanguage: event.target.value })}
              >
                <option value="">{languageLabel(defaultCharacterLanguage)}</option>
                {availableCharacterLanguages.map((language) => (
                  <option key={language} value={language}>
                    {languageLabel(language)}
                  </option>
                ))}
              </select>
            </label>
            {availableCharacterLanguages.length === 0 ? (
              <p className="helper-text">{t('The loaded character pack does not provide additional languages.')}</p>
            ) : (
              <p className="helper-text">{t('This only changes role, reminder token, and night-order text on this device.')}</p>
            )}
          </div>
        ) : null}

        {activeTab === 'voice' ? (
          <div className="settings-tab-panel">
            <label>{t('Microphone')}<select value={selectedAudioInputId} onChange={(event) => onSwitchMicrophone(event.target.value)}>
                <option value="">{t('Default microphone')}</option>
                {audioInputDevices.map((device, index) => (
                  <option key={device.deviceId || index} value={device.deviceId}>
                    {device.label || t('Microphone {index}', { index: index + 1 })}
                  </option>
                ))}
              </select>
            </label>
            {audioDeviceStatus ? <p className="helper-text">{t(audioDeviceStatus)}</p> : null}
            <label className="checkbox-row">
              <input checked={clientSettings.soundFiltersEnabled} type="checkbox" onChange={(event) => onUpdateClientSettings({ soundFiltersEnabled: event.target.checked })} />{t('Use RNNoise suppression')}</label>
            <div className="device-test">
              <div className="mic-meter" aria-label={t('Microphone level')}>
                <span ref={micMeterRef} />
              </div>
              <button className="secondary" onClick={() => void (isTestingMic ? stopMicTest() : startMicTest())} type="button">
                {t(isTestingMic ? 'Stop Input Test' : 'Test Input')}
              </button>
            </div>
            <div className="voice-controls">
              <button className={isMuted ? 'voice-toggle-button hand-button raised' : 'voice-toggle-button secondary'} disabled={!joinedVoiceRoom} onClick={onToggleMuted} type="button">
                <VoiceMuteIcon isMuted={isMuted} />
                <span>{t(isMuted ? 'Muted Microphone' : 'Unmuted Microphone')}</span>
              </button>
              <button className="secondary" onClick={onRefreshDevices} type="button">{t('Refresh Devices')}</button>
            </div>
            <div className="voice-participants">
              <strong>{t('Player Volume')}</strong>
              {remoteParticipantIds.length === 0 ? <p className="helper-text">{t('No remote players available.')}</p> : null}
              {remoteParticipantIds.map((playerId) => (
                <label className="volume-row" key={playerId}>
                  <span>{playerName(playerId)}</span>
                  {!hideVoicePresence ? <small>{t(voiceDiagnostics[playerId] ?? 'not connected')}</small> : null}
                  <input
                    max="2"
                    min="0"
                    step="0.05"
                    type="range"
                    value={remoteVolumes[playerId] ?? 1}
                    onChange={(event) =>
                      setRemoteVolumes((current) => ({
                        ...current,
                        [playerId]: Number(event.target.value),
                      }))
                    }
                  />
                  <strong>{Math.round((remoteVolumes[playerId] ?? 1) * 100)}%</strong>
                </label>
              ))}
            </div>
          </div>
        ) : null}

        {activeTab === 'credits' ? (
          <div className="settings-tab-panel">
            <CreditsView packCredits={packCredits} status={packCreditsStatus} />
          </div>
        ) : null}
      </section>
    </div>
  );
}

/** Convert a locale code into the label shown in the language dropdown. */
function languageLabel(language: string) {
  const labels: Record<string, string> = {
    de: 'Deutsch',
    en: 'English',
    es: 'Español',
  };
  return labels[language] ?? language.toUpperCase();
}
