import { describe, expect, it } from 'vitest';
import { PREMADE_THEMES } from './themes.js';
import { VISUAL_WIDTHS, visualShotName, visualShotPlan } from './visual-shots.js';

// Contract: the 24 screenshot names. A bad id or a bad width throws.

function planFiles(): string[] {
  return visualShotPlan().map((shot) => shot.file);
}

describe('visualShotPlan', () => {
  it('returns 24 names in theme order, 360 then 1440', () => {
    const files = planFiles();
    expect(files).toHaveLength(24);
    expect(files[0]).toBe('phosphor-green-360.png');
    expect(files[1]).toBe('phosphor-green-1440.png');
    expect(files[23]).toBe('high-contrast-1440.png');
    expect(VISUAL_WIDTHS).toEqual([360, 1440]);
  });

  it('uses each catalog id twice and keeps the names unique', () => {
    const plan = visualShotPlan();
    const files = plan.map((shot) => shot.file);
    expect(new Set(files).size).toBe(files.length);
    for (const theme of PREMADE_THEMES) {
      const rows = plan.filter((shot) => shot.id === theme.id);
      expect(rows.map((shot) => shot.width)).toEqual([360, 1440]);
      expect(rows.map((shot) => shot.themeName)).toEqual([theme.name, theme.name]);
      expect(rows.map((shot) => shot.file)).toEqual([
        `${theme.id}-360.png`,
        `${theme.id}-1440.png`,
      ]);
    }
  });
});

describe('visualShotName', () => {
  it('throws bad_theme for an id that is not in the catalog', () => {
    expect(() => visualShotName('nope', 360)).toThrow(new Error('bad_theme'));
  });

  it('throws bad_width for a width that is not 360 or 1440', () => {
    expect(() => visualShotName('nord', 720)).toThrow(new Error('bad_width'));
  });
});
