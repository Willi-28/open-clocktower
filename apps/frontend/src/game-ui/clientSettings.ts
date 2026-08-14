/**
 * Client-only settings persistence.
 *
 * These values are stored in localStorage so each browser can keep its own
 * theme, language, audio, and visibility preferences between sessions.
 */

export const clientSettingsKey = 'open-clocktower.client-settings.v1';

export type ClientSettings = {
  showTable: boolean;
  appTheme: 'classic' | 'dark' | 'light' | 'universe' | 'magic' | 'island';
  nightEffect: 'subtle' | 'fog' | 'none';
  soundVolume: number;
  soundFiltersEnabled: boolean;
  characterLanguage: string;
  selectedAudioInputId: string;
  selectedAudioOutputId: string;
  remoteVolumes: Record<string, number>;
};

export const defaultClientSettings: ClientSettings = {
  showTable: true,
  appTheme: 'classic',
  nightEffect: 'subtle',
  soundVolume: 1,
  soundFiltersEnabled: true,
  characterLanguage: '',
  selectedAudioInputId: '',
  selectedAudioOutputId: '',
  remoteVolumes: {},
};

/** Keep stored 0-200% per-player volumes bounded and JSON-safe. */
function sanitizeRemoteVolumes(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([playerId, volume]) => playerId && typeof volume === 'number' && Number.isFinite(volume))
      .slice(0, 200)
      .map(([playerId, volume]) => [playerId, Math.max(0, Math.min(2, volume as number))]),
  );
}

/** Load saved client settings and sanitize unknown or outdated values. */
export function loadClientSettings(): ClientSettings {
  try {
    const stored = JSON.parse(localStorage.getItem(clientSettingsKey) ?? '{}') as Record<string, unknown>;
    const soundVolume = typeof stored.soundVolume === 'number' && Number.isFinite(stored.soundVolume)
      ? Math.max(0, Math.min(2, stored.soundVolume))
      : defaultClientSettings.soundVolume;
    const appTheme = ['classic', 'dark', 'light', 'universe', 'magic', 'island'].includes(String(stored.appTheme))
      ? stored.appTheme as ClientSettings['appTheme']
      : defaultClientSettings.appTheme;
    const nightEffect = ['subtle', 'fog', 'none'].includes(String(stored.nightEffect))
      ? stored.nightEffect as ClientSettings['nightEffect']
      : defaultClientSettings.nightEffect;
    return {
      showTable: typeof stored.showTable === 'boolean' ? stored.showTable : defaultClientSettings.showTable,
      appTheme,
      nightEffect,
      soundVolume,
      soundFiltersEnabled: typeof stored.soundFiltersEnabled === 'boolean' ? stored.soundFiltersEnabled : defaultClientSettings.soundFiltersEnabled,
      characterLanguage: typeof stored.characterLanguage === 'string' ? stored.characterLanguage : '',
      selectedAudioInputId: typeof stored.selectedAudioInputId === 'string' ? stored.selectedAudioInputId : '',
      selectedAudioOutputId: typeof stored.selectedAudioOutputId === 'string' ? stored.selectedAudioOutputId : '',
      remoteVolumes: sanitizeRemoteVolumes(stored.remoteVolumes),
    };
  } catch {
    return defaultClientSettings;
  }
}
