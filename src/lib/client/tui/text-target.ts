// Contract: tell a keyboard target that is a text field.
// A value that is not an element is not a field.
// The tag check is elementIsTextField. No I/O.

import { elementIsTextField } from './keymap.js';

export function targetIsTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return elementIsTextField(target.tagName, target.isContentEditable);
}
