export type SettingsSectionId =
  'appearance' | 'display' | 'study-day' | 'presets' | 'security' | 'pair-app' | 'data';

const SECTIONS: ReadonlyMap<string, SettingsSectionId> = new Map([
  ['appearance', 'appearance'],
  ['display', 'display'],
  ['study-day', 'study-day'],
  ['presets', 'presets'],
  ['security', 'security'],
  ['pair-app', 'pair-app'],
  ['data', 'data'],
]);

export function settingsSectionFromParam(raw: string | null): SettingsSectionId | null {
  if (raw === null) {
    return null;
  }
  return SECTIONS.get(raw) ?? null;
}
