import { describe, expect, it } from 'vitest';
import { fieldKeyEffect } from './note-field-keys.js';

function effect(
  key: string,
  extra: { altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean } = {},
) {
  return fieldKeyEffect({ key, altKey: false, ctrlKey: false, metaKey: false, ...extra });
}

describe('fieldKeyEffect', () => {
  it('lets the field take arrows, letters, digits, Space, Enter, and colon', () => {
    for (const key of [
      'ArrowDown',
      'ArrowUp',
      'j',
      'k',
      '1',
      '2',
      '3',
      '4',
      ' ',
      'Enter',
      ':',
      'Tab',
    ]) {
      expect(effect(key)).toEqual({ type: 'pass' });
    }
  });

  it('wraps on Alt+C and blurs on Escape', () => {
    expect(effect('c', { altKey: true })).toEqual({ type: 'cloze' });
    expect(effect('C', { altKey: true })).toEqual({ type: 'cloze' });
    expect(
      fieldKeyEffect({ key: 'Dead', code: 'KeyC', altKey: true, ctrlKey: false, metaKey: false }),
    ).toEqual({
      type: 'cloze',
    });
    expect(effect('Escape')).toEqual({ type: 'blur' });
  });

  it('does not take Ctrl+K, Meta chords, or Alt with another key', () => {
    expect(effect('k', { ctrlKey: true })).toEqual({ type: 'pass' });
    expect(effect('c', { altKey: true, ctrlKey: true })).toEqual({ type: 'pass' });
    expect(effect('c', { metaKey: true })).toEqual({ type: 'pass' });
    expect(effect('x', { altKey: true })).toEqual({ type: 'pass' });
    expect(effect('Escape', { altKey: true })).toEqual({ type: 'pass' });
  });
});
