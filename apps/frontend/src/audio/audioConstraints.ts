/**
 * Microphone constraint builder.
 *
 * The frontend keeps WebRTC capture settings in one place so tests, live voice,
 * and the settings preview request the microphone consistently.
 */

import { voiceConfig } from './voiceConfig';

type BrowserAudioTrackConstraints = MediaTrackConstraints & {
  latency?: ConstrainDouble;
};

export type MicrophoneProcessingOptions = {
  /** Browser echo cancellation - required whenever playback can reach the mic. */
  echoCancellation: boolean;
  /** Browser automatic gain control - keeps quiet/loud voices at a usable level. */
  autoGainControl: boolean;
  /**
   * Browser noise suppression. Must stay OFF while RNNoise processes the same
   * stream: two suppressors in series eat consonants and make voices muffled.
   */
  noiseSuppression: boolean;
};

/** Build low-latency microphone constraints for a selected input device. */
export function microphoneConstraints(deviceId: string, processing: MicrophoneProcessingOptions): MediaTrackConstraints {
  return {
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    autoGainControl: processing.autoGainControl,
    channelCount: { ideal: 1 },
    echoCancellation: processing.echoCancellation,
    latency: { ideal: 0.02 },
    noiseSuppression: processing.noiseSuppression,
    sampleRate: { ideal: voiceConfig.captureSampleRate },
    sampleSize: { ideal: 16 },
  } as BrowserAudioTrackConstraints;
}
