import { elementIsTextField } from './keymap.js';

export function targetIsTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return elementIsTextField(target.tagName, target.isContentEditable);
}
