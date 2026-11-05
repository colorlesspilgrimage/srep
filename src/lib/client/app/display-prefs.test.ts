import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DISPLAY,
  acceptDisplay,
  displayRootClass,
  parseDisplayBody,
  parseDisplayPrefs,
} from './display-prefs.js';

describe('display prefs', () => {
  it('accepts a valid form and refuses a bad font size', () => {
    expect(
      acceptDisplay({
        fontSizeText: '18',
        reducedMotion: true,
        scanline: true,
        cursorBlink: false,
      }),
    ).toEqual({
      ok: true,
      display: {
        fontSize: 18,
        reducedMotion: true,
        scanline: true,
        cursorBlink: false,
      },
    });
    expect(
      acceptDisplay({
        fontSizeText: '11',
        reducedMotion: false,
        scanline: false,
        cursorBlink: false,
      }).ok,
    ).toBe(false);
    expect(
      acceptDisplay({
        fontSizeText: '25',
        reducedMotion: false,
        scanline: false,
        cursorBlink: false,
      }).ok,
    ).toBe(false);
  });

  it('parses a display body and builds root class and style', () => {
    expect(parseDisplayBody({ display: DEFAULT_DISPLAY })).toEqual(DEFAULT_DISPLAY);
    expect(parseDisplayPrefs({ fontSize: 16, reducedMotion: false })).toBeNull();
    expect(displayRootClass(DEFAULT_DISPLAY)).toBe('tui-display tui-font-16');
    expect(
      displayRootClass({
        fontSize: 18,
        reducedMotion: true,
        scanline: true,
        cursorBlink: true,
      }),
    ).toBe(
      'tui-display tui-font-18 tui-display-reduced-motion tui-display-scanline tui-display-cursor-blink',
    );
  });
});
