import clockTickUrl from './clock-tick.m4a';
import churchBellUrl from './church_bell.mp3';

let soundEffectsVolume = 1;

export type AudioElementWithSink = HTMLAudioElement & {
  setSinkId?: (sinkId: string) => Promise<void>;
};

export type MediaDevicesWithOutputPicker = MediaDevices & {
  selectAudioOutput?: () => Promise<MediaDeviceInfo>;
};

export function setSoundEffectsVolume(volume: number) {
  soundEffectsVolume = Math.max(0, Math.min(2, volume));
}

function connectWithSoundEffectsVolume(audioContext: AudioContext, source: AudioNode) {
  const masterGain = audioContext.createGain();
  masterGain.gain.value = soundEffectsVolume;
  source.connect(masterGain);
  masterGain.connect(audioContext.destination);
}

export async function setAudioSink(audio: HTMLAudioElement, sinkId: string): Promise<boolean> {
  // Chrome exposes output routing through setSinkId. Other browsers safely ignore it.
  const audioWithSink = audio as AudioElementWithSink;
  if (!sinkId || !audioWithSink.setSinkId) {
    return false;
  }
  await audioWithSink.setSinkId(sinkId);
  return true;
}

export function playVoiceTone(kind: 'join' | 'leave' | 'call') {
  const AudioContextClass =
    window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) {
    return;
  }
  const audioContext = new AudioContextClass();
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

export function playMessageTone() {
  const AudioContextClass =
    window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) {
    return;
  }
  const audioContext = new AudioContextClass();
  void audioContext.resume?.();

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

export function playMuteToggleTone(isMuted: boolean) {
  const AudioContextClass =
    window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) {
    return;
  }
  const audioContext = new AudioContextClass();
  void audioContext.resume?.();
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

export function playTimerAlarm() {
  const audio = new Audio(churchBellUrl);
  audio.volume = Math.min(1, 0.72 * soundEffectsVolume);
  audio.play().catch(() => undefined);
}

export function ringBell() {
  playTimerAlarm();
}
