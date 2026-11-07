export type DialogKeyAction =
  { type: 'close' } | { type: 'tab'; shift: boolean } | { type: 'prevent' } | { type: 'none' };

export function dialogKeyAction(
  key: string,
  shiftKey: boolean,
  targetIsControl: boolean,
): DialogKeyAction {
  if (key === 'Escape') {
    return { type: 'close' };
  }
  if (key === 'Tab') {
    return { type: 'tab', shift: shiftKey };
  }
  if (key === ' ' && !targetIsControl) {
    return { type: 'prevent' };
  }
  return { type: 'none' };
}
