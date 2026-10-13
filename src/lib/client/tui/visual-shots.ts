// Contract: screenshot names for the 12 themes at two widths.
// A name is one file segment. The segment stays in the snapshot folder.

import { PREMADE_THEMES, themeById } from './themes.js';

export const VISUAL_WIDTHS = [360, 1440] as const;

export type VisualWidth = (typeof VISUAL_WIDTHS)[number];

export type VisualShot = {
  id: string;
  themeName: string;
  width: VisualWidth;
  file: string;
};

const SAFE_THEME_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SAFE_SHOT_FILE = /^[a-z0-9]+(?:-[a-z0-9]+)*-(?:360|1440)\.png$/;

function isVisualWidth(width: number): width is VisualWidth {
  for (const item of VISUAL_WIDTHS) {
    if (item === width) {
      return true;
    }
  }
  return false;
}

export function requireSafeShotFile(fileName: string): string {
  if (!SAFE_SHOT_FILE.test(fileName)) {
    throw new Error('bad_theme');
  }
  return fileName;
}

export function visualShotName(themeId: string, width: number): string {
  if (!SAFE_THEME_ID.test(themeId) || themeById(themeId) === undefined) {
    throw new Error('bad_theme');
  }
  if (!isVisualWidth(width)) {
    throw new Error('bad_width');
  }
  return requireSafeShotFile(`${themeId}-${width}.png`);
}

export function visualGalleryPath(themeId: string): string {
  if (!SAFE_THEME_ID.test(themeId) || themeById(themeId) === undefined) {
    throw new Error('bad_theme');
  }
  return `/gallery?theme=${encodeURIComponent(themeId)}`;
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
