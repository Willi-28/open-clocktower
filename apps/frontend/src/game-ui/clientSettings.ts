export const clientSettingsKey = 'open-clocktower.client-settings.v1';

export type ClientSettings = {
  showTable: boolean;
  appTheme: 'classic' | 'dark' | 'light' | 'universe' | 'magic' | 'island';
  nightEffect: 'subtle' | 'fog' | 'none';
  soundVolume: number;
  soundFiltersEnabled: boolean;
  characterLanguage: string;
};

export const defaultClientSettings: ClientSettings = {
  showTable: true,
  appTheme: 'classic',
  nightEffect: 'subtle',
  soundVolume: 1,
  soundFiltersEnabled: true,
  characterLanguage: '',
};

export function loadClientSettings(): ClientSettings {
  try {
    const stored = JSON.parse(localStorage.getItem(clientSettingsKey) ?? '{}') as Record<string, unknown>;
    const soundVolume = typeof stored.soundVolume === 'number' && Number.isFinite(stored.soundVolume)
      ? Math.max(0, Math.min(2, stored.soundVolume))
      : defaultClientSettings.soundVolume;
    return {
      ...defaultClientSettings,
      ...stored,
      showTable: typeof stored.showTable === 'boolean' ? stored.showTable : true,
      appTheme: ['classic', 'dark', 'light', 'universe', 'magic', 'island'].includes(String(stored.appTheme)) ? stored.appTheme as ClientSettings['appTheme'] : 'classic',
      characterLanguage: typeof stored.characterLanguage === 'string' ? stored.characterLanguage : '',
      soundFiltersEnabled: typeof stored.soundFiltersEnabled === 'boolean' ? stored.soundFiltersEnabled : defaultClientSettings.soundFiltersEnabled,
      soundVolume,
    };
  } catch {
    return defaultClientSettings;
  }
}
