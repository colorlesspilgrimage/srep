// Contract: map ?section= to a Settings pane id. Unknown values are ignored.
// Own keys only (CWE-1321). No I/O.

export type SettingsSectionId =
  'appearance' | 'display' | 'study-day' | 'presets' | 'security' | 'data';

const SECTIONS: ReadonlyMap<string, SettingsSectionId> = new Map([
  ['appearance', 'appearance'],
  ['display', 'display'],
  ['study-day', 'study-day'],
  ['presets', 'presets'],
  ['security', 'security'],
  ['data', 'data'],
]);

export function settingsSectionFromParam(raw: string | null): SettingsSectionId | null {
  if (raw === null) {
    return null;
  }
  return SECTIONS.get(raw) ?? null;
}
