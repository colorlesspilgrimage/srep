import { describe, expect, it } from 'vitest';
import { dialogKeyAction } from './dialog-focus.js';

describe('dialogKeyAction', () => {
  it('closes on Escape and keeps Tab inside the dialog', () => {
    expect(dialogKeyAction('Escape', false, false)).toEqual({ type: 'close' });
    expect(dialogKeyAction('Tab', false, false)).toEqual({ type: 'tab', shift: false });
    expect(dialogKeyAction('Tab', true, true)).toEqual({ type: 'tab', shift: true });
  });

  it('stops Space on the dialog and leaves a control key alone', () => {
    expect(dialogKeyAction(' ', false, false)).toEqual({ type: 'prevent' });
    expect(dialogKeyAction(' ', false, true)).toEqual({ type: 'none' });
    for (const key of ['Enter', '1', '2', '3', '4', 'ArrowDown']) {
      expect(dialogKeyAction(key, false, false)).toEqual({ type: 'none' });
    }
  });
});
