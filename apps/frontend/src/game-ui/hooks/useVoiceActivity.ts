/**
 * Voice activity detection hook.
 *
 * The hook samples local and remote audio streams, detects likely speech, and
 * exposes speaking player ids for visual table highlights.
 */

import { useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';

import { getSharedAudioContext } from '../../audio/browserAudio';

type UseVoiceActivityOptions = {
  currentPlayerId: string;
  isMutedRef: MutableRefObject<boolean>;
};

/**
 * Detects local and remote speech levels for table speaking indicators.
 */
export function useVoiceActivity({ currentPlayerId, isMutedRef }: UseVoiceActivityOptions) {
  const voiceLevelCleanupRef = useRef<Record<string, () => void>>({});
  const [speakingPlayerIds, setSpeakingPlayerIds] = useState<string[]>([]);

  useEffect(() => {
    return () => stopAllVoiceLevelMonitors();
  }, []);

  /**
   * Marks a player as speaking only when the computed activity state changes.
   */
  function setPlayerSpeaking(playerId: string, isSpeaking: boolean) {
    setSpeakingPlayerIds((current) => {
      const alreadySpeaking = current.includes(playerId);
      if (isSpeaking === alreadySpeaking) {
        return current;
      }
      return isSpeaking ? [...current, playerId] : current.filter((id) => id !== playerId);
    });
  }

  /**
   * Stops one audio analyser and clears any speaking glow it owns.
   */
  function stopVoiceLevelMonitor(playerId: string) {
    voiceLevelCleanupRef.current[playerId]?.();
    delete voiceLevelCleanupRef.current[playerId];
    setPlayerSpeaking(playerId, false);
  }

  /**
   * Stops every active analyser when a voice session fully ends.
   */
  function stopAllVoiceLevelMonitors() {
    Object.keys(voiceLevelCleanupRef.current).forEach(stopVoiceLevelMonitor);
  }

  /**
   * Samples a media stream and classifies likely speech against an adaptive noise floor.
   *
   * All monitors share one AudioContext: browsers cap the number of contexts a
   * page may open (~6 in Chrome), so per-player contexts silently broke the
   * speaking indicators and volume boosts in fuller voice rooms.
   */
  function startVoiceLevelMonitor(playerId: string, stream: MediaStream) {
    stopVoiceLevelMonitor(playerId);

    const audioContext = getSharedAudioContext();
    if (!audioContext) {
      return;
    }
    let source: MediaStreamAudioSourceNode;
    try {
      source = audioContext.createMediaStreamSource(stream);
    } catch {
      // A stream whose tracks already ended cannot be monitored.
      return;
    }
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    const samples = new Uint8Array(analyser.fftSize);
    let timeoutId = 0;
    let lastSpokenAt = 0;
    let noiseFloor = 1.4;

    source.connect(analyser);

    /** Re-sample the analyser and update speaking state on a short interval. */
    const readLevel = () => {
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      let peak = 0;
      for (const sample of samples) {
        const value = sample - 128;
        peak = Math.max(peak, Math.abs(value));
        sum += value * value;
      }
      const rms = Math.sqrt(sum / samples.length);
      const isLocalMuted = playerId === currentPlayerId && isMutedRef.current;
      const now = performance.now();
      const isLikelySpeech = rms > Math.max(1.55, noiseFloor + 0.72) || peak > Math.max(6.5, noiseFloor * 2.15);
      noiseFloor = isLikelySpeech
        ? noiseFloor * 0.992 + Math.min(rms, 18) * 0.008
        : noiseFloor * 0.92 + Math.min(rms, 18) * 0.08;
      if (isLikelySpeech) {
        lastSpokenAt = now;
      }
      setPlayerSpeaking(playerId, now - lastSpokenAt < 500 && !isLocalMuted);
      // 30 Hz is imperceptible for a speaking glow but ~40% less continuous CPU
      // per monitored stream than 50 Hz (one loop runs for every voice member).
      timeoutId = window.setTimeout(readLevel, 33);
    };

    readLevel();
    voiceLevelCleanupRef.current[playerId] = () => {
      window.clearTimeout(timeoutId);
      source.disconnect();
      analyser.disconnect();
      // The shared AudioContext stays open for tones and other monitors.
    };
  }

  return {
    setPlayerSpeaking,
    speakingPlayerIds,
    startVoiceLevelMonitor,
    stopAllVoiceLevelMonitors,
    stopVoiceLevelMonitor,
  };
}
