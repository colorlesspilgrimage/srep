// Contract: map one study key to one action.
// Input: key, side, field and button flags, modal, palette, status, and inFlight.
// Output: reveal, rate, undo, suspend, edit, or none.
// inFlight is true while a rate, undo, or suspend request is open. The result is none.
// Space or Enter on a button is none, so that button runs once.
// No I/O.

export type StudySide = 'front' | 'back';
export type StudyStatus = 'card' | 'wait' | 'done';
export type StudyRating = 1 | 2 | 3 | 4;

export type StudyKeyInput = {
  key: string;
  side: StudySide;
  targetIsField: boolean;
  targetIsButton: boolean;
  modalOpen: boolean;
  paletteOpen: boolean;
  status: StudyStatus;
  inFlight: boolean;
};

export type StudyKeyAction =
  | { type: 'reveal' }
  | { type: 'rate'; rating: StudyRating }
  | { type: 'undo' }
  | { type: 'suspend' }
  | { type: 'edit' }
  | { type: 'none' };

const NONE: StudyKeyAction = { type: 'none' };

function blocked(input: StudyKeyInput): boolean {
  return input.inFlight || input.targetIsField || input.modalOpen || input.paletteOpen;
}

function rateKey(key: string): StudyRating | null {
  if (key === '1') {
    return 1;
  }
  if (key === '2') {
    return 2;
  }
  if (key === '3') {
    return 3;
  }
  if (key === '4') {
    return 4;
  }
  return null;
}

function frontAction(input: StudyKeyInput): StudyKeyAction {
  const showsBack = input.key === ' ' || input.key === 'Enter';
  if (showsBack && !input.targetIsButton) {
    return { type: 'reveal' };
  }
  if (input.key === 's') {
    return { type: 'suspend' };
  }
  if (input.key === 'e') {
    return { type: 'edit' };
  }
  return NONE;
}

function backAction(input: StudyKeyInput): StudyKeyAction {
  const rating = rateKey(input.key);
  if (rating !== null) {
    return { type: 'rate', rating };
  }
  if (input.key === ' ' && !input.targetIsButton) {
    return { type: 'rate', rating: 3 };
  }
  if (input.key === 's') {
    return { type: 'suspend' };
  }
  if (input.key === 'e') {
    return { type: 'edit' };
  }
  return NONE;
}

export function studyKeyAction(input: StudyKeyInput): StudyKeyAction {
  if (blocked(input)) {
    return NONE;
  }
  if (input.key === 'u') {
    return { type: 'undo' };
  }
  if (input.status !== 'card') {
    return NONE;
  }
  if (input.side === 'front') {
    return frontAction(input);
  }
  return backAction(input);
}
