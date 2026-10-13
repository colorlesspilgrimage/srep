// Contract: dialog keys. Escape closes the dialog. Tab stays on Close.

export type ModalKeyAction = 'close' | 'trap' | 'none';

export function modalKeyAction(key: string): ModalKeyAction {
  if (key === 'Escape') {
    return 'close';
  }
  if (key === 'Tab') {
    return 'trap';
  }
  return 'none';
}
