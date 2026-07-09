/**
 * Voice device management hook.
 *
 * This hook discovers microphones/speakers, requests microphone streams,
 * applies noise suppression (RNNoise with native fallback), and routes
 * playback to selected outputs.
 */

import { useEffect, useRef, useState } from 'react';

import { getClientConfig } from '../../api/client';
import { MediaDevicesWithOutputPicker, setAudioSink } from '../../audio/browserAudio';
import { microphoneConstraints } from '../../audio/audioConstraints';
import type { MicrophoneProcessingOptions } from '../../audio/audioConstraints';
import { createNoiseSuppressedStream } from '../../audio/rnnoiseStream';
import { voiceConfig } from '../../audio/voiceConfig';

type UseVoiceDevicesOptions = {
  currentPlayerId: string;
  isMuted: boolean;
  onLocalSpeakingStopped: (playerId: string, isSpeaking: boolean) => void;
  onLocalTrackEnded: () => void;
  onStartVoiceLevelMonitor: (playerId: string, stream: MediaStream) => void;
  soundFiltersEnabled: boolean;
};

/** Translate getUserMedia failures into instructions a player can act on. */
function microphoneErrorMessage(caught: unknown) {
  const errorName = caught instanceof DOMException ? caught.name : '';
  switch (errorName) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Microphone access is blocked. Allow the microphone for this site in the browser settings, then try again.';
    case 'NotFoundError':
      return 'No microphone was found. Connect one (or enable it in the system settings) and try again.';
    case 'NotReadableError':
      return 'The microphone is in use by another application or blocked by the operating system.';
    case 'OverconstrainedError':
      return 'The selected microphone does not support the requested audio settings.';
    default:
      return caught instanceof Error ? caught.message : 'Could not access the microphone.';
  }
}

/**
 * Owns browser audio device discovery, microphone capture, and output routing.
 */
export function useVoiceDevices({
  currentPlayerId,
  isMuted,
  onLocalSpeakingStopped,
  onLocalTrackEnded,
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
    /** Refresh device lists when the browser reports hardware changes. */
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
        setAudioDeviceStatus(microphoneErrorMessage(caught));
        const errorName = caught instanceof DOMException ? caught.name : '';
        if (errorName === 'NotAllowedError' || errorName === 'SecurityError') {
          return;
        }
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
   * Captures the microphone with a device fallback: when the selected device
   * fails (unplugged, claimed by another app, unsupported constraints) the
   * browser default microphone is used instead of failing the voice join.
   */
  async function captureMicrophone(deviceId: string, processing: MicrophoneProcessingOptions) {
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: microphoneConstraints(deviceId, processing),
        video: false,
      });
    } catch (caught) {
      const errorName = caught instanceof DOMException ? caught.name : '';
      if (deviceId && ['NotFoundError', 'OverconstrainedError', 'NotReadableError'].includes(errorName)) {
        setSelectedAudioInputId('');
        setAudioDeviceStatus('Could not use the selected microphone. Falling back to the browser default.');
        return navigator.mediaDevices.getUserMedia({
          audio: microphoneConstraints('', processing),
          video: false,
        });
      }
      throw caught;
    }
  }

  /**
   * Requests processed microphone audio for the given filter setting.
   *
   * Sound filters ON runs echo cancellation + auto gain natively and the
   * configured noise suppression engine on top: RNNoise (native suppression
   * OFF so the voice is not muffled by two suppressors in series), falling
   * back to the browser's native suppression when RNNoise cannot start.
   * Sound filters OFF captures the microphone completely raw for players who
   * use headphones and want the unprocessed signal.
   */
  async function requestVoiceStream(deviceId: string, filtersEnabled: boolean) {
    try {
      if (!filtersEnabled) {
        const rawStream = await captureMicrophone(deviceId, {
          echoCancellation: false,
          autoGainControl: false,
          noiseSuppression: false,
        });
        watchLocalTracks(rawStream);
        setAudioDeviceStatus('Sound filters are off - raw microphone audio.');
        return { stream: rawStream, cleanup: undefined };
      }

      const engine = voiceConfig.noiseSuppressionEngine;
      if (engine === 'rnnoise') {
        const rawStream = await captureMicrophone(deviceId, {
          echoCancellation: true,
          autoGainControl: true,
          noiseSuppression: false,
        });
        try {
          const suppressed = await createNoiseSuppressedStream(rawStream);
          watchLocalTracks(rawStream);
          setAudioDeviceStatus('RNNoise suppression is active.');
          return suppressed;
        } catch (caught) {
          // RNNoise needs a running 48 kHz engine; when the device cannot
          // provide one, degrade to the browser's own suppression instead of
          // sending unsuppressed audio.
          rawStream.getTracks().forEach((track) => track.stop());
          const nativeStream = await captureMicrophone(deviceId, {
            echoCancellation: true,
            autoGainControl: true,
            noiseSuppression: true,
          });
          watchLocalTracks(nativeStream);
          setAudioDeviceStatus(
            caught instanceof Error
              ? `${caught.message} Using the browser's built-in noise suppression.`
              : "RNNoise could not start. Using the browser's built-in noise suppression.",
          );
          return { stream: nativeStream, cleanup: undefined };
        }
      }

      const nativeStream = await captureMicrophone(deviceId, {
        echoCancellation: true,
        autoGainControl: true,
        noiseSuppression: engine === 'native',
      });
      watchLocalTracks(nativeStream);
      setAudioDeviceStatus(
        engine === 'native' ? "The browser's built-in noise suppression is active." : 'Noise suppression is disabled by configuration.',
      );
      return { stream: nativeStream, cleanup: undefined };
    } catch (caught) {
      setAudioDeviceStatus(microphoneErrorMessage(caught));
      throw new Error(microphoneErrorMessage(caught));
    }
  }

  /**
   * Detects the capture device dying mid-session (USB microphone unplugged,
   * OS revoking the device) so the session can restart on the default mic.
   */
  function watchLocalTracks(stream: MediaStream) {
    stream.getAudioTracks().forEach((track) => {
      track.onended = () => {
        setAudioDeviceStatus('The microphone stopped (device removed?). Reconnecting with the default microphone...');
        onLocalTrackEnded();
      };
    });
  }

  /**
   * Stops local capture and any audio processing resources attached to it.
   */
  function stopLocalVoiceStream() {
    localVoiceCleanupRef.current?.();
    localVoiceCleanupRef.current = null;
    localStreamRef.current?.getTracks().forEach((track) => {
      track.onended = null;
      track.stop();
    });
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
