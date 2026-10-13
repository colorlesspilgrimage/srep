import { describe, expect, it } from 'vitest';
import {
  beginThemeSave,
  finishThemeSave,
  statusAfterChoice,
  themeSaveMatches,
  type ThemeSaveState,
} from './theme-save-state.js';

// Contract: an older save reply must not mark a new choice as saved.

const saved: ThemeSaveState = { serial: 2, statusText: 'Saved.' };

describe('theme save state', () => {
  it('keeps the status when the choice does not change', () => {
    expect(statusAfterChoice(saved, 'nord', 'nord')).toEqual(saved);
  });

  it('clears the status when the choice changes', () => {
    expect(statusAfterChoice(saved, 'nord', 'amber-crt')).toEqual({ serial: 3, statusText: '' });
  });

  it('sets Saved when the matching reply succeeds', () => {
    const started = beginThemeSave({ serial: 0, statusText: '' });
    expect(started.serial).toBe(1);
    expect(
      finishThemeSave(started.state, started.serial, themeSaveMatches({ id: 'nord' }, 'nord')),
    ).toEqual({ serial: 1, statusText: 'Saved.' });
  });

  it('sets the error text when the matching reply fails', () => {
    const current = { serial: 4, statusText: '' };
    expect(finishThemeSave(current, 4, false)).toEqual({
      serial: 4,
      statusText: 'Could not save the theme.',
    });
  });

  it('ignores an older reply after a new choice', () => {
    const started = beginThemeSave({ serial: 1, statusText: '' });
    const cleared = statusAfterChoice(started.state, 'nord', 'amber-crt');
    expect(finishThemeSave(cleared, started.serial, true)).toEqual(cleared);
  });

  it('rejects a body that is not the sent id', () => {
    expect(themeSaveMatches(null, 'nord')).toBe(false);
    expect(themeSaveMatches({}, 'nord')).toBe(false);
    expect(themeSaveMatches({ id: 'amber-crt' }, 'nord')).toBe(false);
    expect(themeSaveMatches({ id: '<script>' }, 'nord')).toBe(false);
    expect(themeSaveMatches({ id: 1 }, 'nord')).toBe(false);
    expect(themeSaveMatches({ id: 'nord', extra: true }, 'nord')).toBe(true);
  });
});
