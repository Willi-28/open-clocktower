/**
 * Browser audio effects and output routing helpers.
 *
 * This file owns short UI sounds, bell playback, and the optional setSinkId
 * bridge that lets supported browsers route audio to a chosen output device.
 */

import clockTickUrl from './clock-tick.m4a';
import churchBellUrl from './church_bell.mp3';
import nominateKillUrl from './nominate_kill.mp3';

let soundEffectsVolume = 1;
let sharedAudioContext: AudioContext | null = null;

export type AudioElementWithSink = HTMLAudioElement & {
  setSinkId?: (sinkId: string) => Promise<void>;
};

export type MediaDevicesWithOutputPicker = MediaDevices & {
  selectAudioOutput?: () => Promise<MediaDeviceInfo>;
};

/** Store the global sound-effects volume after clamping it to a safe range. */
export function setSoundEffectsVolume(volume: number) {
  soundEffectsVolume = Math.max(0, Math.min(2, volume));
}

/**
 * Return a single lazily-created AudioContext, resumed on demand.
 *
 * Browsers cap how many AudioContexts a page may open, so every short tone
 * and the per-player voice volume boost reuse this one instead of creating
 * (and leaking) a fresh context each time.
 */
export function getSharedAudioContext(): AudioContext | null {
  const AudioContextClass =
    window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) {
    return null;
  }
  if (sharedAudioContext === null || sharedAudioContext.state === 'closed') {
    sharedAudioContext = new AudioContextClass();
  }
  void sharedAudioContext.resume?.();
  return sharedAudioContext;
}

/** Connect an audio node through the shared sound-effects gain control. */
function connectWithSoundEffectsVolume(audioContext: AudioContext, source: AudioNode) {
  const masterGain = audioContext.createGain();
  masterGain.gain.value = soundEffectsVolume;
  source.connect(masterGain);
  masterGain.connect(audioContext.destination);
}

/** Route an audio element to a selected output device when the browser supports it. */
export async function setAudioSink(audio: HTMLAudioElement, sinkId: string): Promise<boolean> {
  // Chrome exposes output routing through setSinkId. Other browsers safely ignore it.
  const audioWithSink = audio as AudioElementWithSink;
  if (!sinkId || !audioWithSink.setSinkId) {
    return false;
  }
  await audioWithSink.setSinkId(sinkId);
  return true;
}

/** Play a short tone for joining, leaving, or receiving a voice call. */
export function playVoiceTone(kind: 'join' | 'leave' | 'call') {
  const audioContext = getSharedAudioContext();
  if (!audioContext) {
    return;
  }
  const gain = audioContext.createGain();
  const oscillator = audioContext.createOscillator();
  const frequency = kind === 'join' ? 720 : kind === 'leave' ? 360 : 560;
  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime);
  if (kind === 'call') {
    oscillator.frequency.setValueAtTime(760, audioContext.currentTime + 0.16);
  }
  gain.gain.setValueAtTime(0.001, audioContext.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.14, audioContext.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + (kind === 'call' ? 0.42 : 0.22));
  oscillator.connect(gain);
  connectWithSoundEffectsVolume(audioContext, gain);
  oscillator.start();
  oscillator.stop(audioContext.currentTime + (kind === 'call' ? 0.45 : 0.25));
}

/** Play the two-note text chat notification tone. */
export function playMessageTone() {
  const audioContext = getSharedAudioContext();
  if (!audioContext) {
    return;
  }

  [0, 0.09].forEach((offset, index) => {
    const gain = audioContext.createGain();
    const oscillator = audioContext.createOscillator();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(index === 0 ? 880 : 1175, audioContext.currentTime + offset);
    gain.gain.setValueAtTime(0.001, audioContext.currentTime + offset);
    gain.gain.exponentialRampToValueAtTime(0.11, audioContext.currentTime + offset + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + offset + 0.16);
    oscillator.connect(gain);
    connectWithSoundEffectsVolume(audioContext, gain);
    oscillator.start(audioContext.currentTime + offset);
    oscillator.stop(audioContext.currentTime + offset + 0.18);
  });
}

/** Play a small ascending or descending tone for mute state changes. */
export function playMuteToggleTone(isMuted: boolean) {
  const audioContext = getSharedAudioContext();
  if (!audioContext) {
    return;
  }
  const frequencies = isMuted ? [520, 330] : [330, 520];
  frequencies.forEach((frequency, index) => {
    const offset = index * 0.075;
    const gain = audioContext.createGain();
    const oscillator = audioContext.createOscillator();
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime + offset);
    gain.gain.setValueAtTime(0.001, audioContext.currentTime + offset);
    gain.gain.exponentialRampToValueAtTime(0.13, audioContext.currentTime + offset + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + offset + 0.13);
    oscillator.connect(gain);
    connectWithSoundEffectsVolume(audioContext, gain);
    oscillator.start(audioContext.currentTime + offset);
    oscillator.stop(audioContext.currentTime + offset + 0.15);
  });
}

/** Play one clock tick for vote counting movement. */
export function playTickTone() {
  const audio = new Audio(clockTickUrl);
  audio.volume = Math.min(1, 0.5 * soundEffectsVolume);
  // Each vote step creates a fresh short sample so every player hears exactly
  // one tick when the counting hand moves.
  const stopAfterOneTick = window.setTimeout(() => {
    audio.pause();
    audio.src = '';
  }, 420);
  audio.play().catch(() => window.clearTimeout(stopAfterOneTick));
}

/** Play the church bell used by timer alarms and manual bell rings. */
export function playTimerAlarm() {
  const audio = new Audio(churchBellUrl);
  audio.volume = Math.min(1, 0.6 * soundEffectsVolume);
  audio.play().catch(() => undefined);
}

/** Play the execution sound after a nominee is successfully killed. */
export function playNominationKillSound() {
  const audio = new Audio(nominateKillUrl);
  audio.volume = Math.min(1, 0.5 * soundEffectsVolume);
  audio.play().catch(() => undefined);
}

/** Ring the shared room bell sound. */
export function ringBell() {
  playTimerAlarm();
}
