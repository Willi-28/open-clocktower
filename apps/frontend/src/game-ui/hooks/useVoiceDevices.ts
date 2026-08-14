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

export type VoiceStreamRequest = {
  /** The stream sent to peers (denoised when sound filters are on). */
  stream: MediaStream;
  cleanup?: () => void;
  /**
   * Raw pre-processing capture, used only for the LOCAL speaking indicator so
   * it reacts to the microphone instantly instead of after RNNoise's latency.
   */
  monitorStream?: MediaStream;
};

type UseVoiceDevicesOptions = {
  currentPlayerId: string;
  initialAudioInputId: string;
  initialAudioOutputId: string;
  isMuted: boolean;
  onSelectedAudioInputIdChange: (deviceId: string) => void;
  onSelectedAudioOutputIdChange: (deviceId: string) => void;
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
  initialAudioInputId,
  initialAudioOutputId,
  isMuted,
  onSelectedAudioInputIdChange,
  onSelectedAudioOutputIdChange,
  onLocalSpeakingStopped,
  onLocalTrackEnded,
  onStartVoiceLevelMonitor,
  soundFiltersEnabled,
}: UseVoiceDevicesOptions) {
  const localStreamRef = useRef<MediaStream | null>(null);
  const localVoiceCleanupRef = useRef<(() => void) | null>(null);
  // The pre-processing stream the speaking indicator listens to. Kept so a
  // retained microphone can re-arm its monitor without re-capturing.
  const localMonitorStreamRef = useRef<MediaStream | null>(null);
  // True while a retained stream is parked (night): the next handout has to
  // re-arm it. Without this flag every peer creation would restart the monitor.
  const localStreamSilencedRef = useRef(false);
  const [audioInputDevices, setAudioInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [audioOutputDevices, setAudioOutputDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedAudioInputId, setSelectedAudioInputId] = useState(initialAudioInputId);
  const [selectedAudioOutputId, setSelectedAudioOutputId] = useState(initialAudioOutputId);
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
    onSelectedAudioInputIdChange(selectedAudioInputId);
  }, [onSelectedAudioInputIdChange, selectedAudioInputId]);

  useEffect(() => {
    onSelectedAudioOutputIdChange(selectedAudioOutputId);
  }, [onSelectedAudioOutputIdChange, selectedAudioOutputId]);

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
        return current;
      }
      setAudioDeviceStatus('Selected microphone is no longer available. Using the default microphone.');
      return '';
    });
    setSelectedAudioOutputId((current) => {
      if (!current || speakers.some((device) => device.deviceId === current)) {
        return current;
      }
      setAudioDeviceStatus('Selected speaker is no longer available. Using the system default output.');
      return '';
    });
  }

  /**
   * Creates or reuses the local microphone stream for the active voice session.
   */
  async function getLocalVoiceStream(deviceId = selectedAudioInputId) {
    const retained = localStreamRef.current;
    if (retained) {
      if (localStreamSilencedRef.current) {
        // The stream was parked while the player was out of voice (night) and
        // its monitor was stopped. Re-arm both, so reusing it is equivalent to a
        // fresh capture without touching the microphone - which is what lets a
        // background tab rejoin without a user gesture.
        localStreamSilencedRef.current = false;
        retained.getAudioTracks().forEach((track) => {
          track.enabled = !isMuted;
        });
        if (currentPlayerId) {
          onStartVoiceLevelMonitor(currentPlayerId, localMonitorStreamRef.current ?? retained);
        }
      }
      return retained;
    }
    const { stream, cleanup, monitorStream } = await requestVoiceStream(deviceId, soundFiltersEnabled);
    stream.getAudioTracks().forEach((track) => {
      track.enabled = !isMuted;
    });
    localStreamRef.current = stream;
    localMonitorStreamRef.current = monitorStream ?? stream;
    localVoiceCleanupRef.current = cleanup ?? null;
    if (currentPlayerId) {
      onStartVoiceLevelMonitor(currentPlayerId, monitorStream ?? stream);
    }
    void refreshMediaDevices();
    return stream;
  }

  /**
   * Silences the microphone without releasing it.
   *
   * Used when the player leaves voice for the night: `track.enabled = false`
   * means nothing is captured or sent, but the capture pipeline (and its
   * permission/AudioContext state) survives, so returning at sunrise needs no
   * getUserMedia call - browsers defer or block that in a background tab.
   */
  function silenceLocalVoiceStream() {
    if (!localStreamRef.current) {
      return;
    }
    localStreamSilencedRef.current = true;
    localStreamRef.current.getAudioTracks().forEach((track) => {
      track.enabled = false;
    });
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
  async function requestVoiceStream(deviceId: string, filtersEnabled: boolean): Promise<VoiceStreamRequest> {
    try {
      if (!filtersEnabled) {
        const rawStream = await captureMicrophone(deviceId, {
          echoCancellation: false,
          autoGainControl: false,
          noiseSuppression: false,
        });
        watchLocalTracks(rawStream);
        setAudioDeviceStatus('Sound filters are off - raw microphone audio.');
        return { stream: rawStream, cleanup: undefined, monitorStream: rawStream };
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
          // The local speaking indicator watches the RAW capture, not the
          // suppressed output: RNNoise's buffer + noise gate add ~tens of ms of
          // latency, so lighting the green ring off the raw mic makes the own
          // client feel instantly responsive while the sent audio stays clean.
          return { ...suppressed, monitorStream: rawStream };
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
          return { stream: nativeStream, cleanup: undefined, monitorStream: nativeStream };
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
      return { stream: nativeStream, cleanup: undefined, monitorStream: nativeStream };
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
    localMonitorStreamRef.current = null;
    localStreamSilencedRef.current = false;
  }

  /**
   * Adopts a freshly requested stream after a microphone or processing restart.
   */
  function replaceLocalVoiceStream(stream: MediaStream, cleanup?: () => void, monitorStream?: MediaStream) {
    localVoiceCleanupRef.current = cleanup ?? null;
    localStreamRef.current = stream;
    localMonitorStreamRef.current = monitorStream ?? stream;
    if (currentPlayerId) {
      onStartVoiceLevelMonitor(currentPlayerId, monitorStream ?? stream);
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
    silenceLocalVoiceStream,
    stopLocalVoiceStream,
  };
}
