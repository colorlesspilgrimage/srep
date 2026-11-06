import { describe, expect, it } from 'vitest';
import { settingsSectionFromParam } from './settings-section.js';

describe('settingsSectionFromParam', () => {
  it('maps known section ids and rejects others', () => {
    expect(settingsSectionFromParam('security')).toBe('security');
    expect(settingsSectionFromParam('data')).toBe('data');
    expect(settingsSectionFromParam('appearance')).toBe('appearance');
    expect(settingsSectionFromParam(null)).toBeNull();
    expect(settingsSectionFromParam('')).toBeNull();
    expect(settingsSectionFromParam('constructor')).toBeNull();
    expect(settingsSectionFromParam('__proto__')).toBeNull();
  });
});
