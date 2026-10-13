// Contract: character-grid frames and the desktop or mobile layout mode.

export const DESKTOP_COLUMNS = 80;
export const MOBILE_COLUMNS = 32;
export const BREAKPOINT_PX = 720;

const TOP_LEFT = '\u250C';
const TOP_RIGHT = '\u2510';
const BOTTOM_LEFT = '\u2514';
const BOTTOM_RIGHT = '\u2518';
const HORIZONTAL = '\u2500';

export function layoutMode(widthPx: number): 'mobile' | 'desktop' {
  if (!Number.isInteger(widthPx) || widthPx < 0 || widthPx > 10000) {
    throw new Error('bad_width');
  }
  if (widthPx <= BREAKPOINT_PX) {
    return 'mobile';
  }
  return 'desktop';
}

function assertColumns(columns: number): void {
  if (!Number.isInteger(columns) || columns < 8 || columns > 120) {
    throw new Error('bad_columns');
  }
}

function assertTitle(title: string): void {
  if (title !== '' && !/^[A-Za-z0-9 -]+$/.test(title)) {
    throw new Error('bad_title');
  }
}

export function frameTop(columns: number, title: string): string {
  assertColumns(columns);
  assertTitle(title);
  if (title === '') {
    return TOP_LEFT + HORIZONTAL.repeat(columns - 2) + TOP_RIGHT;
  }
  const dashCount = columns - 4 - title.length;
  if (dashCount < 0) {
    throw new Error('bad_title');
  }
  return TOP_LEFT + HORIZONTAL.repeat(dashCount) + ' ' + title + ' ' + TOP_RIGHT;
}

export function frameBottom(columns: number): string {
  assertColumns(columns);
  return BOTTOM_LEFT + HORIZONTAL.repeat(columns - 2) + BOTTOM_RIGHT;
}

// A negative limit has no legal title length. Return an empty string.
export function fitTitle(title: string, columns: number): string {
  const cleaned = title.replace(/[^A-Za-z0-9 -]/g, '');
  const max = columns - 4;
  if (max < 1) {
    return '';
  }
  return cleaned.slice(0, max);
}
