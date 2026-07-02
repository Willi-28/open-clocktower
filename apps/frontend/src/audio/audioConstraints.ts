type BrowserAudioTrackConstraints = MediaTrackConstraints & {
  latency?: ConstrainDouble;
};

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
