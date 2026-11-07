import { describe, expect, it } from 'vitest';
import { studyKeyAction, type StudyKeyInput } from './study-keys.js';

const NONE = { type: 'none' } as const;

function key(
  extra: Partial<StudyKeyInput> & Pick<StudyKeyInput, 'key'>,
): ReturnType<typeof studyKeyAction> {
  return studyKeyAction({
    side: 'front',
    targetIsField: false,
    targetIsButton: false,
    modalOpen: false,
    paletteOpen: false,
    status: 'card',
    inFlight: false,
    ...extra,
  });
}

describe('studyKeyAction', () => {
  it('reveals on Space and Enter and ignores rating and move keys on the front', () => {
    expect(key({ key: ' ' })).toEqual({ type: 'reveal' });
    expect(key({ key: 'Enter' })).toEqual({ type: 'reveal' });
    for (const name of ['1', '2', '3', '4']) {
      expect(key({ key: name })).toEqual(NONE);
    }
    for (const name of ['ArrowDown', 'ArrowUp', 'j', 'k', 'Home', 'End', 'PageUp', 'PageDown']) {
      expect(key({ key: name })).toEqual(NONE);
    }
    expect(key({ key: 'u' })).toEqual({ type: 'undo' });
    expect(key({ key: 's' })).toEqual({ type: 'suspend' });
    expect(key({ key: 'e' })).toEqual({ type: 'edit' });
    expect(key({ key: 'Escape' })).toEqual(NONE);
    expect(key({ key: 'Tab' })).toEqual(NONE);
    expect(key({ key: ':' })).toEqual(NONE);
    expect(key({ key: ' ', targetIsButton: true })).toEqual(NONE);
    expect(key({ key: 'Enter', targetIsButton: true })).toEqual(NONE);
  });

  it('rates on the back and leaves Space and Enter to a focused button', () => {
    expect(key({ key: '1', side: 'back' })).toEqual({ type: 'rate', rating: 1 });
    expect(key({ key: '2', side: 'back' })).toEqual({ type: 'rate', rating: 2 });
    expect(key({ key: '3', side: 'back' })).toEqual({ type: 'rate', rating: 3 });
    expect(key({ key: '4', side: 'back' })).toEqual({ type: 'rate', rating: 4 });
    expect(key({ key: ' ', side: 'back' })).toEqual({ type: 'rate', rating: 3 });
    expect(key({ key: 'Enter', side: 'back' })).toEqual(NONE);
    expect(key({ key: ' ', side: 'back', targetIsButton: true })).toEqual(NONE);
    expect(key({ key: 'Enter', side: 'back', targetIsButton: true })).toEqual(NONE);
    for (const name of [
      'ArrowDown',
      'ArrowUp',
      'j',
      'k',
      'Home',
      'End',
      'h',
      'l',
      'PageUp',
      'PageDown',
    ]) {
      expect(key({ key: name, side: 'back' })).toEqual(NONE);
    }
    expect(key({ key: 'u', side: 'back' })).toEqual({ type: 'undo' });
    expect(key({ key: 's', side: 'back' })).toEqual({ type: 'suspend' });
    expect(key({ key: 'e', side: 'back' })).toEqual({ type: 'edit' });
    expect(key({ key: 'Escape', side: 'back' })).toEqual(NONE);
    expect(key({ key: ':', side: 'back' })).toEqual(NONE);
  });

  it('does nothing for study keys while the dialog, a field, or the palette is open', () => {
    for (const name of ['1', '2', '3', '4', ' ', 'u', 's', 'e']) {
      expect(key({ key: name, side: 'back', modalOpen: true })).toEqual(NONE);
      expect(key({ key: name, side: 'back', targetIsField: true })).toEqual(NONE);
      expect(key({ key: name, side: 'front', paletteOpen: true })).toEqual(NONE);
    }
  });

  it('undoes on wait or done and does not rate, edit, or suspend', () => {
    for (const status of ['wait', 'done'] as const) {
      for (const name of ['1', '2', '3', '4', ' ']) {
        expect(key({ key: name, side: 'back', status })).toEqual(NONE);
      }
      expect(key({ key: 'u', status })).toEqual({ type: 'undo' });
      expect(key({ key: 'e', status })).toEqual(NONE);
      expect(key({ key: 's', status })).toEqual(NONE);
    }
  });

  it('returns none while a request is in flight', () => {
    expect(key({ key: ' ', inFlight: true })).toEqual(NONE);
    expect(key({ key: '1', side: 'back', inFlight: true })).toEqual(NONE);
    expect(key({ key: 'u', inFlight: true })).toEqual(NONE);
    expect(key({ key: 's', inFlight: true })).toEqual(NONE);
    expect(key({ key: 'e', inFlight: true })).toEqual(NONE);
  });
});
