/**
 * Voice audio configuration.
 *
 * All tunable audio parameters live here and can be overridden per deployment
 * through Vite environment variables (see docs/voice-audio.md). Values are
 * read once at module load; invalid values fall back to the defaults.
 */

export type NoiseSuppressionEngine = 'rnnoise' | 'native' | 'off';

type VoiceEnv = {
  VITE_VOICE_MAX_BITRATE?: string;
  VITE_VOICE_FEC?: string;
  VITE_VOICE_DTX?: string;
  VITE_VOICE_NOISE_SUPPRESSION?: string;
};

const env = import.meta.env as VoiceEnv;

/** Parse an integer env value, clamped to a sane range, with a default. */
function intFromEnv(raw: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
}

/** Parse a boolean env value ("true"/"false"/"1"/"0"), with a default. */
function boolFromEnv(raw: string | undefined, fallback: boolean) {
  if (raw === undefined || raw === '') {
    return fallback;
  }
  return raw === 'true' || raw === '1';
}

/** Parse the noise suppression engine choice, with RNNoise as the default. */
function noiseEngineFromEnv(raw: string | undefined): NoiseSuppressionEngine {
  return raw === 'native' || raw === 'off' ? raw : 'rnnoise';
}

export const voiceConfig = {
  /**
   * Opus target/maximum bitrate in bits per second for outgoing speech.
   * 64 kbps mono Opus is transparent for voice; raise for very good networks,
   * lower (32000) for constrained ones. Applied both as the RTP sender's
   * maxBitrate and as `maxaveragebitrate` in the negotiated SDP.
   */
  maxBitrate: intFromEnv(env.VITE_VOICE_MAX_BITRATE, 64_000, 16_000, 256_000),

  /**
   * Opus in-band forward error correction: the encoder embeds a low-quality
   * copy of the previous packet so single packet loss is inaudible. Costs a
   * little bitrate, dramatically smooths bad connections. Default on.
   */
  forwardErrorCorrection: boolFromEnv(env.VITE_VOICE_FEC, true),

  /**
   * Opus discontinuous transmission (send almost nothing during silence).
   * Saves bandwidth but can clip word onsets and make the noise floor pump,
   * which players hear as static/crackle. Default off for quality.
   */
  discontinuousTransmission: boolFromEnv(env.VITE_VOICE_DTX, false),

  /**
   * Which noise suppression engine to use when the player has sound filters
   * enabled: 'rnnoise' (WASM model, best quality, falls back to 'native'
   * automatically when it cannot start), 'native' (the browser's built-in
   * suppression), or 'off'.
   */
  noiseSuppressionEngine: noiseEngineFromEnv(env.VITE_VOICE_NOISE_SUPPRESSION),

  /** Capture sample rate; Opus and RNNoise both operate at 48 kHz. */
  captureSampleRate: 48_000,
} as const;
