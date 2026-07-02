/**
 * RNNoise microphone processing pipeline.
 *
 * This module wraps rnnoise-wasm in a MediaStream transform so live voice can
 * use client-side noise suppression before WebRTC sends audio to peers.
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

  const rnnoise = await loadRnnoise();
  const denoiseState = rnnoise.createDenoiseState();
  const audioContext = new AudioContextClass({ sampleRate: 48000 });
  const source = audioContext.createMediaStreamSource(inputStream);
  const highPass = audioContext.createBiquadFilter();
  const processor = audioContext.createScriptProcessor(1024, 1, 1);
  const compressor = audioContext.createDynamicsCompressor();
  const limiter = audioContext.createDynamicsCompressor();
  const destination = audioContext.createMediaStreamDestination();
  const frameSize = rnnoise.frameSize;
  const inputBuffer = new SampleRingBuffer(frameSize * 32);
  const outputBuffer = new SampleRingBuffer(frameSize * 32);
  const dryBuffer = new SampleRingBuffer(frameSize * 32);
  const frame = new Float32Array(frameSize);
  let isCleanedUp = false;

  highPass.type = 'highpass';
  highPass.frequency.value = 78;
  highPass.Q.value = 0.72;
  compressor.threshold.value = -24;
  compressor.knee.value = 18;
  compressor.ratio.value = 3;
  compressor.attack.value = 0.004;
  compressor.release.value = 0.16;
  limiter.threshold.value = -3;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.08;

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
      denoiseState.processFrame(frame);
      for (let index = 0; index < frame.length; index += 1) {
        outputBuffer.push(Math.max(-1, Math.min(1, frame[index] / 32768)));
      }
    }

    for (let index = 0; index < output.length; index += 1) {
      if (outputBuffer.available === 0) {
        output[index] = 0;
        continue;
      }
      const wet = outputBuffer.pop();
      const dry = dryBuffer.pop();
      output[index] = Math.max(-1, Math.min(1, wet * 0.96 + dry * 0.04));
    }
  };

  source.connect(highPass);
  highPass.connect(processor);
  processor.connect(compressor);
  compressor.connect(limiter);
  limiter.connect(destination);
  void audioContext.resume();

  /** Release RNNoise, audio graph nodes, and all media tracks created for the stream. */
  const cleanup = () => {
    if (isCleanedUp) {
      return;
    }
    isCleanedUp = true;
    processor.onaudioprocess = null;
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
