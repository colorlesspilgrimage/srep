// Contract: a later choice or a later save wins.
// An older reply must not set the status text (CWE-362).

export type ThemeSaveState = {
  serial: number;
  statusText: string;
};

const SAVED_TEXT = 'Saved.';
const FAILED_TEXT = 'Could not save the theme.';

export function beginThemeSave(state: ThemeSaveState): { state: ThemeSaveState; serial: number } {
  const serial = state.serial + 1;
  return { state: { serial, statusText: state.statusText }, serial };
}

export function statusAfterChoice(
  state: ThemeSaveState,
  currentId: string,
  nextId: string,
): ThemeSaveState {
  if (nextId === currentId) {
    return state;
  }
  return { serial: state.serial + 1, statusText: '' };
}

export function finishThemeSave(
  current: ThemeSaveState,
  serial: number,
  saved: boolean,
): ThemeSaveState {
  if (serial !== current.serial) {
    return current;
  }
  return { serial: current.serial, statusText: saved ? SAVED_TEXT : FAILED_TEXT };
}

export function themeSaveMatches(body: unknown, id: string): boolean {
  if (typeof body !== 'object' || body === null || !('id' in body)) {
    return false;
  }
  return body.id === id;
}
