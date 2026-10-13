// Contract: screenshot names for the 12 themes at two widths.

import { PREMADE_THEMES, themeById } from './themes.js';

export const VISUAL_WIDTHS = [360, 1440] as const;

export type VisualWidth = (typeof VISUAL_WIDTHS)[number];

export type VisualShot = {
  id: string;
  themeName: string;
  width: VisualWidth;
  file: string;
};

function isVisualWidth(width: number): width is VisualWidth {
  for (const item of VISUAL_WIDTHS) {
    if (item === width) {
      return true;
    }
  }
  return false;
}

export function visualShotName(themeId: string, width: number): string {
  if (themeById(themeId) === undefined) {
    throw new Error('bad_theme');
  }
  if (!isVisualWidth(width)) {
    throw new Error('bad_width');
  }
  return `${themeId}-${width}.png`;
}

export function visualShotPlan(): VisualShot[] {
  const shots: VisualShot[] = [];
  for (const theme of PREMADE_THEMES) {
    for (const width of VISUAL_WIDTHS) {
      shots.push({
        id: theme.id,
        themeName: theme.name,
        width,
        file: visualShotName(theme.id, width),
      });
    }
  }
  return shots;
}
