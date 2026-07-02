import { useEffect, useRef, useState } from 'react';

import { getClientConfig } from '../../api/client';
import { MediaDevicesWithOutputPicker, setAudioSink } from '../../audio/browserAudio';
import { microphoneConstraints } from '../../audio/audioConstraints';
import { createNoiseSuppressedStream } from '../../audio/rnnoiseStream';

type UseVoiceDevicesOptions = {
  currentPlayerId: string;
  isMuted: boolean;
  onLocalSpeakingStopped: (playerId: string, isSpeaking: boolean) => void;
  onStartVoiceLevelMonitor: (playerId: string, stream: MediaStream) => void;
  soundFiltersEnabled: boolean;
};

/**
 * Owns browser audio device discovery, microphone capture, and output routing.
 */
export function useVoiceDevices({
  currentPlayerId,
  isMuted,
  onLocalSpeakingStopped,
  onStartVoiceLevelMonitor,
  soundFiltersEnabled,
}: UseVoiceDevicesOptions) {
  const localStreamRef = useRef<MediaStream | null>(null);
  const localVoiceCleanupRef = useRef<(() => void) | null>(null);
  const [audioInputDevices, setAudioInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [audioOutputDevices, setAudioOutputDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedAudioInputId, setSelectedAudioInputId] = useState('');
  const [selectedAudioOutputId, setSelectedAudioOutputId] = useState('');
  const [audioDeviceStatus, setAudioDeviceStatus] = useState('');
  const [iceServers, setIceServers] = useState<RTCIceServer[]>([{ urls: 'stun:stun.l.google.com:19302' }]);

  useEffect(() => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      return;
    }
    void refreshMediaDevices();
    const handleDeviceChange = () => {
      void refreshMediaDevices();
    };
    navigator.mediaDevices.addEventListener?.('devicechange', handleDeviceChange);
    return () => navigator.mediaDevices.removeEventListener?.('devicechange', handleDeviceChange);
  }, []);

  useEffect(() => {
    void getClientConfig()
      .then((config) => {
        if (config.iceServers.length > 0) {
          setIceServers(config.iceServers);
        }
      })
      .catch(() => setIceServers([{ urls: 'stun:stun.l.google.com:19302' }]));
  }, []);

  useEffect(() => {
    return () => stopLocalVoiceStream();
  }, []);

  useEffect(() => {
    localStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !isMuted;
    });
    if (isMuted && currentPlayerId) {
      onLocalSpeakingStopped(currentPlayerId, false);
    }
  }, [isMuted, currentPlayerId, onLocalSpeakingStopped]);

  /**
   * Refreshes microphone and speaker lists, optionally prompting for microphone permission first.
   */
  async function refreshMediaDevices(options: { requestPermission?: boolean } = {}) {
    if (!navigator.mediaDevices?.enumerateDevices) {
      setAudioDeviceStatus('This browser does not expose audio device lists.');
      return;
    }
    if (options.requestPermission) {
      if (!navigator.mediaDevices.getUserMedia) {
        setAudioDeviceStatus('This browser cannot request microphone access.');
        return;
      }
      try {
        const permissionStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        permissionStream.getTracks().forEach((track) => track.stop());
        setAudioDeviceStatus('Microphone access granted. Device list refreshed.');
      } catch (caught) {
        const errorName = caught instanceof DOMException ? caught.name : '';
        if (errorName === 'NotAllowedError' || errorName === 'SecurityError') {
          setAudioDeviceStatus('Microphone access was blocked. Allow microphone access in the browser site settings, then refresh devices again.');
          return;
        }
        setAudioDeviceStatus(caught instanceof Error ? caught.message : 'Could not request microphone access.');
      }
    }
    const devices = await navigator.mediaDevices.enumerateDevices();
    const microphones = devices.filter((device) => device.kind === 'audioinput');
    const speakers = devices.filter((device) => device.kind === 'audiooutput');
    setAudioInputDevices(microphones);
    setAudioOutputDevices(speakers);
    setSelectedAudioInputId((current) => {
      if (!current || microphones.some((device) => device.deviceId === current)) {
        return current || microphones[0]?.deviceId || '';
      }
      setAudioDeviceStatus('Selected microphone is no longer available. Using the default microphone.');
      return microphones[0]?.deviceId || '';
    });
    setSelectedAudioOutputId((current) => {
      if (!current || speakers.some((device) => device.deviceId === current)) {
        return current || speakers[0]?.deviceId || '';
      }
      setAudioDeviceStatus('Selected speaker is no longer available. Using the system default output.');
      return speakers[0]?.deviceId || '';
    });
  }

  /**
   * Creates or reuses the local microphone stream for the active voice session.
   */
  async function getLocalVoiceStream(deviceId = selectedAudioInputId) {
    if (localStreamRef.current) {
      return localStreamRef.current;
    }
    const { stream, cleanup } = await requestVoiceStream(deviceId, soundFiltersEnabled);
    stream.getAudioTracks().forEach((track) => {
      track.enabled = !isMuted;
    });
    localStreamRef.current = stream;
    localVoiceCleanupRef.current = cleanup ?? null;
    if (currentPlayerId) {
      onStartVoiceLevelMonitor(currentPlayerId, stream);
    }
    void refreshMediaDevices();
    return stream;
  }

  /**
   * Requests raw or RNNoise-processed microphone audio with default-device fallback.
   */
  async function requestVoiceStream(deviceId: string, filtersEnabled: boolean) {
    try {
      const rawStream = await navigator.mediaDevices.getUserMedia({
        audio: microphoneConstraints(deviceId, filtersEnabled),
        video: false,
      });
      if (!filtersEnabled) {
        return { stream: rawStream, cleanup: undefined };
      }
      try {
        const suppressed = await createNoiseSuppressedStream(rawStream);
        setAudioDeviceStatus('RNNoise suppression is active.');
        return suppressed;
      } catch (caught) {
        setAudioDeviceStatus(caught instanceof Error ? `${caught.message} Using normal microphone audio.` : 'RNNoise suppression could not start. Using normal microphone audio.');
        return { stream: rawStream, cleanup: undefined };
      }
    } catch (caught) {
      const errorName = caught instanceof DOMException ? caught.name : '';
      if (deviceId && ['NotFoundError', 'OverconstrainedError', 'NotReadableError'].includes(errorName)) {
        setSelectedAudioInputId('');
        setAudioDeviceStatus('Could not use the selected microphone. Falling back to the browser default.');
        const fallbackStream = await navigator.mediaDevices.getUserMedia({
          audio: microphoneConstraints('', filtersEnabled),
          video: false,
        });
        if (!filtersEnabled) {
          return { stream: fallbackStream, cleanup: undefined };
        }
        try {
          const suppressed = await createNoiseSuppressedStream(fallbackStream);
          setAudioDeviceStatus('RNNoise suppression is active on the default microphone.');
          return suppressed;
        } catch (fallbackCaught) {
          setAudioDeviceStatus(
            fallbackCaught instanceof Error
              ? `${fallbackCaught.message} Using normal default microphone audio.`
              : 'RNNoise suppression could not start. Using normal default microphone audio.',
          );
          return { stream: fallbackStream, cleanup: undefined };
        }
      }
      if (errorName === 'NotAllowedError') {
        setAudioDeviceStatus('Microphone permission is blocked. Allow microphone access in the browser and try again.');
      }
      throw caught;
    }
  }

  /**
   * Stops local capture and any audio processing resources attached to it.
   */
  function stopLocalVoiceStream() {
    localVoiceCleanupRef.current?.();
    localVoiceCleanupRef.current = null;
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
  }

  /**
   * Adopts a freshly requested stream after a microphone or processing restart.
   */
  function replaceLocalVoiceStream(stream: MediaStream, cleanup?: () => void) {
    localVoiceCleanupRef.current = cleanup ?? null;
    localStreamRef.current = stream;
    if (currentPlayerId) {
      onStartVoiceLevelMonitor(currentPlayerId, stream);
    }
  }

  /**
   * Applies the selected speaker output to one remote audio element when supported.
   */
  async function applyAudioSink(audio: HTMLAudioElement) {
    try {
      const applied = await setAudioSink(audio, selectedAudioOutputId);
      if (!applied && selectedAudioOutputId) {
        setAudioDeviceStatus('This browser uses the system default output for voice playback.');
      }
    } catch {
      setSelectedAudioOutputId('');
      setAudioDeviceStatus('Could not switch speaker output. Using the system default output.');
    }
  }

  /**
   * Opens the browser speaker picker where available.
   */
  async function chooseOutputDevice() {
    const mediaDevices = navigator.mediaDevices as MediaDevicesWithOutputPicker | undefined;
    if (!mediaDevices?.selectAudioOutput) {
      setAudioDeviceStatus('This browser does not support choosing a speaker. It will use the system default output.');
      return;
    }
    try {
      const device = await mediaDevices.selectAudioOutput();
      setSelectedAudioOutputId(device.deviceId);
      await refreshMediaDevices();
      setAudioDeviceStatus(`Speaker set to ${device.label || 'selected output'}.`);
    } catch (caught) {
      setAudioDeviceStatus(caught instanceof Error ? caught.message : 'Could not choose output device');
    }
  }

  return {
    applyAudioSink,
    audioDeviceStatus,
    audioInputDevices,
    audioOutputDevices,
    chooseOutputDevice,
    getLocalVoiceStream,
    iceServers,
    refreshMediaDevices,
    replaceLocalVoiceStream,
    requestVoiceStream,
    selectedAudioInputId,
    selectedAudioOutputId,
    setSelectedAudioInputId,
    setSelectedAudioOutputId,
    stopLocalVoiceStream,
  };
}
