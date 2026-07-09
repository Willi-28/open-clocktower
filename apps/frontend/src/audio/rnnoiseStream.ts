/**
 * RNNoise microphone processing pipeline.
 *
 * This module wraps rnnoise-wasm in a MediaStream transform so live voice can
 * use client-side noise suppression before WebRTC sends audio to peers.
 *
 * The pipeline intentionally runs on a ScriptProcessorNode rather than an
 * AudioWorklet: the rnnoise-wasm build refuses to load outside window/Worker
 * scopes and worklet module imports are still unreliable in Firefox/Safari.
 * The 1024-sample buffer (~21 ms) keeps latency low while riding out main
 * thread jank; callers must treat any construction failure as "fall back to
 * the browser's native noise suppression".
 */

import type { Rnnoise } from '@shiguredo/rnnoise-wasm';

type NoiseSuppressedStream = {
  stream: MediaStream;
  cleanup: () => void;
};

let rnnoisePromise: Promise<Rnnoise> | null = null;

/**
 * Buffers PCM samples without the repeated allocations and copies caused by Array.shift().
 */
class SampleRingBuffer {
  private readonly samples: Float32Array;
  private readIndex = 0;
  private writeIndex = 0;
  private length = 0;

  /** Allocate a fixed-size sample buffer for audio frames. */
  constructor(capacity: number) {
    this.samples = new Float32Array(capacity);
  }

  /** Return how many samples can currently be read. */
  get available() {
    return this.length;
  }

  /** Add one sample, dropping the oldest sample if the ring is full. */
  push(value: number) {
    if (this.length === this.samples.length) {
      this.readIndex = (this.readIndex + 1) % this.samples.length;
      this.length -= 1;
    }
    this.samples[this.writeIndex] = value;
    this.writeIndex = (this.writeIndex + 1) % this.samples.length;
    this.length += 1;
  }

  /** Remove one sample, returning silence when the buffer is empty. */
  pop() {
    if (this.length === 0) {
      return 0;
    }
    const value = this.samples[this.readIndex];
    this.readIndex = (this.readIndex + 1) % this.samples.length;
    this.length -= 1;
    return value;
  }

  /** Fill a frame-sized target array with samples from the ring. */
  readInto(target: Float32Array) {
    for (let index = 0; index < target.length; index += 1) {
      target[index] = this.pop();
    }
  }
}

/** Load rnnoise-wasm once and reuse the promise for later microphone restarts. */
function loadRnnoise() {
  rnnoisePromise ??= import('@shiguredo/rnnoise-wasm').then(({ Rnnoise }) => Rnnoise.load());
  return rnnoisePromise;
}

/** Create a denoised MediaStream and cleanup callback from a raw microphone stream. */
export async function createNoiseSuppressedStream(inputStream: MediaStream): Promise<NoiseSuppressedStream> {
  const AudioContextClass = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) {
    throw new Error('RNNoise suppression is not supported by this browser.');
  }

  // RNNoise strictly needs a 48 kHz context. Create it first and bail out if the
  // browser/OS cannot honour that or refuses to start the engine; the caller then
  // falls back to the raw microphone. This is the difference between "no noise
  // suppression" (fine) and a silently empty outgoing track (the user is heard as
  // silence) on Windows setups whose audio device runs at 44.1 kHz or in exclusive
  // mode, and on browsers where a MediaStream-only graph never leaves 'suspended'.
  const audioContext = new AudioContextClass({ sampleRate: 48000, latencyHint: 'interactive' });
  if (audioContext.sampleRate !== 48000) {
    await audioContext.close();
    throw new Error(
      `Noise suppression needs a 48 kHz audio engine but this device reported ${audioContext.sampleRate} Hz.`,
    );
  }
  try {
    await audioContext.resume();
  } catch {
    // resume() can reject when the call is outside a user gesture; the running
    // check below decides whether the pipeline is actually usable.
  }
  if (audioContext.state !== 'running') {
    await audioContext.close();
    throw new Error('The audio engine for noise suppression could not start on this device.');
  }

  const rnnoise = await loadRnnoise();
  const denoiseState = rnnoise.createDenoiseState();
  const source = audioContext.createMediaStreamSource(inputStream);
  const highPass = audioContext.createBiquadFilter();
  const processor = audioContext.createScriptProcessor(1024, 1, 1);
  const compressor = audioContext.createDynamicsCompressor();
  const limiter = audioContext.createDynamicsCompressor();
  const destination = audioContext.createMediaStreamDestination();
  // A ScriptProcessorNode only keeps firing while its graph reaches a real output
  // on some browsers. Tapping a muted gain node to the speakers keeps processing
  // alive (so the WebRTC destination stream is never silently empty) without echo.
  const keepAlive = audioContext.createGain();
  keepAlive.gain.value = 0;
  const frameSize = rnnoise.frameSize;
  const inputBuffer = new SampleRingBuffer(frameSize * 32);
  const outputBuffer = new SampleRingBuffer(frameSize * 32);
  const dryBuffer = new SampleRingBuffer(frameSize * 32);
  const gateBuffer = new SampleRingBuffer(frameSize * 32);
  const frame = new Float32Array(frameSize);
  let isCleanedUp = false;

  // Residual-noise expander driven by RNNoise's own per-frame voice detection:
  // while nobody is talking the output is eased down another ~10 dB, which
  // removes the residual hiss/hum RNNoise leaves behind. Speech opens the gate
  // instantly (the decision is made on the same 10 ms frame, so onsets are
  // never clipped) and a generous hangover plus a slow ramp-down keep pauses
  // between words untouched - it never sounds like a walkie-talkie.
  const voiceProbabilityThreshold = 0.5;
  const gateHoldFrames = 40; // 40 frames x 10 ms = 400 ms hangover after speech.
  const gateFloor = 0.3; // Attenuate silence by ~10 dB instead of hard-muting.
  const gateOpenRate = 0.007; // Per-sample smoothing: fully open in ~3 ms.
  const gateCloseRate = 0.00018; // Per-sample smoothing: closes over ~120 ms.
  let gateHoldRemaining = gateHoldFrames;
  let gateGain = 1;

  // Filter chain tuning. The high-pass only removes sub-voice rumble (desk
  // thumps, wind) without touching voice fundamentals. The compressor evens
  // out quiet/loud talkers with a slow release so it never audibly pumps, and
  // the limiter is a pure safety ceiling against clipping - both leave the
  // spectrum alone so the voice stays bright, not muffled.
  highPass.type = 'highpass';
  highPass.frequency.value = 78;
  highPass.Q.value = 0.72;
  compressor.threshold.value = -24;
  compressor.knee.value = 18;
  compressor.ratio.value = 3;
  compressor.attack.value = 0.004;
  compressor.release.value = 0.24;
  limiter.threshold.value = -2;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.12;

  processor.onaudioprocess = (event) => {
    if (isCleanedUp) {
      return;
    }

    const input = event.inputBuffer.getChannelData(0);
    const output = event.outputBuffer.getChannelData(0);
    for (let index = 0; index < input.length; index += 1) {
      inputBuffer.push(Math.max(-1, Math.min(1, input[index])) * 32768);
    }

    while (inputBuffer.available >= frameSize) {
      inputBuffer.readInto(frame);
      for (let index = 0; index < frame.length; index += 1) {
        dryBuffer.push(frame[index] / 32768);
      }
      const voiceProbability = denoiseState.processFrame(frame);
      if (voiceProbability > voiceProbabilityThreshold) {
        gateHoldRemaining = gateHoldFrames;
      } else if (gateHoldRemaining > 0) {
        gateHoldRemaining -= 1;
      }
      const gateTarget = gateHoldRemaining > 0 ? 1 : gateFloor;
      for (let index = 0; index < frame.length; index += 1) {
        outputBuffer.push(Math.max(-1, Math.min(1, frame[index] / 32768)));
        gateBuffer.push(gateTarget);
      }
    }

    for (let index = 0; index < output.length; index += 1) {
      if (outputBuffer.available === 0) {
        output[index] = 0;
        continue;
      }
      const wet = outputBuffer.pop();
      const dry = dryBuffer.pop();
      const gateTarget = gateBuffer.pop();
      gateGain += (gateTarget - gateGain) * (gateTarget > gateGain ? gateOpenRate : gateCloseRate);
      // A 2% dry bleed keeps sibilants natural without re-admitting noise.
      output[index] = Math.max(-1, Math.min(1, (wet * 0.98 + dry * 0.02) * gateGain));
    }
  };

  source.connect(highPass);
  highPass.connect(processor);
  processor.connect(compressor);
  compressor.connect(limiter);
  limiter.connect(destination);
  limiter.connect(keepAlive);
  keepAlive.connect(audioContext.destination);
  void audioContext.resume();

  // OS output-device switches and mobile audio interruptions can suspend the
  // context mid-session, which would silently kill the outgoing voice track.
  audioContext.onstatechange = () => {
    if (!isCleanedUp && audioContext.state === 'suspended') {
      void audioContext.resume().catch(() => undefined);
    }
  };

  /** Release RNNoise, audio graph nodes, and all media tracks created for the stream. */
  const cleanup = () => {
    if (isCleanedUp) {
      return;
    }
    isCleanedUp = true;
    audioContext.onstatechange = null;
    processor.onaudioprocess = null;
    keepAlive.disconnect();
    limiter.disconnect();
    compressor.disconnect();
    processor.disconnect();
    highPass.disconnect();
    source.disconnect();
    denoiseState.destroy();
    inputStream.getTracks().forEach((track) => track.stop());
    destination.stream.getTracks().forEach((track) => track.stop());
    void audioContext.close();
  };

  return { stream: destination.stream, cleanup };
}
