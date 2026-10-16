// Contract: map one study key to one action.
// inFlight, a field, a dialog, or the palette returns none.
// Space or Enter on a button is none, so that button runs once.
// No I/O.

export type StudySide = 'front' | 'back';
export type StudyStatus = 'card' | 'wait' | 'done';
export type StudyRating = 1 | 2 | 3 | 4;

export const STUDY_RATINGS = [1, 2, 3, 4] as const;

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

const RATE_BY_KEY = new Map<string, StudyRating>(
  STUDY_RATINGS.map((rating) => [String(rating), rating]),
);

export function isStudyRating(value: number): value is StudyRating {
  return STUDY_RATINGS.some((rating) => rating === value);
}

function blocked(input: StudyKeyInput): boolean {
  return input.inFlight || input.targetIsField || input.modalOpen || input.paletteOpen;
}

function rateKey(key: string): StudyRating | null {
  return RATE_BY_KEY.get(key) ?? null;
}

function cardControl(key: string): StudyKeyAction | null {
  if (key === 's') {
    return { type: 'suspend' };
  }
  if (key === 'e') {
    return { type: 'edit' };
  }
  return null;
}

function frontAction(input: StudyKeyInput): StudyKeyAction {
  const showsBack = input.key === ' ' || input.key === 'Enter';
  if (showsBack && !input.targetIsButton) {
    return { type: 'reveal' };
  }
  return cardControl(input.key) ?? NONE;
}

function backAction(input: StudyKeyInput): StudyKeyAction {
  const rating = rateKey(input.key);
  if (rating !== null) {
    return { type: 'rate', rating };
  }
  if (input.key === ' ' && !input.targetIsButton) {
    return { type: 'rate', rating: 3 };
  }
  return cardControl(input.key) ?? NONE;
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
