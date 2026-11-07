import { describe, expect, it } from 'vitest';
import { NOT_FOUND_TEXT } from './browse-model.js';
import { dialogMustStop, writeFollowUp } from './browse-guard.js';

describe('write follow-up', () => {
  it('keeps the screen when the write fails', () => {
    expect(writeFollowUp(false, 'not_found', 'tag:pets')).toEqual({
      type: 'stay',
      message: NOT_FOUND_TEXT,
    });
    expect(writeFollowUp(false, 'network_error', 'tag:pets')).toEqual({
      type: 'stay',
      message: 'The server did not answer.',
    });
    expect(writeFollowUp(false, 'constructor', 'tag:pets').type).toBe('stay');
  });

  it('reloads the captured query after a success', () => {
    expect(writeFollowUp(true, '', 'tag:pets')).toEqual({ type: 'reload', query: 'tag:pets' });
    expect(writeFollowUp(true, 'not_found', 'deck:Spanish')).toEqual({
      type: 'reload',
      query: 'deck:Spanish',
    });
  });
});

describe('delete dialog extra keys', () => {
  it('stops delete, digits, and select-all', () => {
    for (const key of ['Delete', 'Backspace', '1', '2', '3', '4']) {
      expect(dialogMustStop(key, false, false)).toBe(true);
    }
    expect(dialogMustStop('a', true, false)).toBe(true);
    expect(dialogMustStop('A', false, true)).toBe(true);
    expect(dialogMustStop('a', false, false)).toBe(false);
    expect(dialogMustStop('Enter', false, false)).toBe(false);
    expect(dialogMustStop('Tab', false, false)).toBe(false);
    expect(dialogMustStop('Escape', false, false)).toBe(false);
  });
});
