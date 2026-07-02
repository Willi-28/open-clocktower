/**
 * Microphone constraint builder.
 *
 * The frontend keeps WebRTC capture settings in one place so tests, live voice,
 * and the settings preview request the microphone consistently.
 */

type BrowserAudioTrackConstraints = MediaTrackConstraints & {
  latency?: ConstrainDouble;
};

/** Build low-latency microphone constraints for a selected input device. */
export function microphoneConstraints(deviceId: string, soundFiltersEnabled = false): MediaTrackConstraints {
  return {
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    autoGainControl: soundFiltersEnabled,
    channelCount: { ideal: 1 },
    echoCancellation: soundFiltersEnabled,
    latency: { ideal: 0.02 },
    noiseSuppression: false,
    sampleRate: { ideal: 48000 },
    sampleSize: { ideal: 16 },
  } as BrowserAudioTrackConstraints;
}
