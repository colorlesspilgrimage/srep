// Contract: pure study-screen state. The screen passes the clock and the reply.
// applyNext stores raw card text. CardHtml sanitizes that text once at display.
// A done screen uses the last answer interval. No I/O.

import { appMessageFor } from './app-messages.js';
import { formatInterval } from './format-interval.js';
import { formatUntil } from './format-until.js';
import { elapsedMs } from './study-elapsed.js';
import type { NextReply, StudyCounts } from './study-parse.js';
import type { StudyRating } from './study-keys.js';

export type RateLabels = Record<StudyRating, string>;

export type ShownCard = {
  id: string;
  noteId: string;
  reps: number;
  front: string;
  back: string;
  labels: RateLabels;
};

export type StudyPhase =
  | { kind: 'loading' }
  | { kind: 'bad-deck' }
  | { kind: 'error'; message: string }
  | { kind: 'card'; side: 'front' | 'back'; card: ShownCard; counts: StudyCounts }
  | { kind: 'wait'; untilText: string; counts: StudyCounts }
  | { kind: 'done'; dueText: string; counts: StudyCounts };

export type StudyState = {
  phase: StudyPhase;
  message: string;
  busy: boolean;
  editOpen: boolean;
  lastInterval: number | null;
  shownAt: number;
};

export function initialStudyState(): StudyState {
  return {
    phase: { kind: 'loading' },
    message: '',
    busy: false,
    editOpen: false,
    lastInterval: null,
    shownAt: 0,
  };
}

function labelsFor(previews: Record<StudyRating, number>): RateLabels {
  return {
    1: formatInterval(previews[1]),
    2: formatInterval(previews[2]),
    3: formatInterval(previews[3]),
    4: formatInterval(previews[4]),
  };
}

function idle(state: StudyState): StudyState {
  return { ...state, busy: false, message: '', editOpen: false };
}

export function badDeck(state: StudyState): StudyState {
  return { ...idle(state), phase: { kind: 'bad-deck' } };
}

export function failedLoad(state: StudyState, code: string): StudyState {
  return { ...idle(state), phase: { kind: 'error', message: appMessageFor(code) } };
}

export function applyNext(state: StudyState, reply: NextReply, now: number): StudyState {
  const base = idle(state);
  if (reply.status === 'wait') {
    return {
      ...base,
      phase: { kind: 'wait', untilText: formatUntil(reply.until), counts: reply.counts },
    };
  }
  if (reply.status === 'done') {
    return {
      ...base,
      phase: {
        kind: 'done',
        dueText: formatInterval(state.lastInterval ?? 0),
        counts: reply.counts,
      },
    };
  }
  return {
    ...base,
    shownAt: now,
    phase: {
      kind: 'card',
      side: 'front',
      counts: reply.counts,
      card: {
        id: reply.card.id,
        noteId: reply.card.noteId,
        reps: reply.card.reps,
        front: reply.card.front,
        back: reply.card.back,
        labels: labelsFor(reply.card.previews),
      },
    },
  };
}

export function reveal(state: StudyState): StudyState {
  if (state.busy || state.phase.kind !== 'card' || state.phase.side === 'back') {
    return state;
  }
  return { ...state, message: '', phase: { ...state.phase, side: 'back' } };
}

export function beginAction(state: StudyState): StudyState | null {
  if (state.busy) {
    return null;
  }
  return { ...state, busy: true, message: '' };
}

export function failedAction(state: StudyState, code: string): StudyState {
  return { ...state, busy: false, message: appMessageFor(code) };
}

export function nothingToUndo(state: StudyState): StudyState {
  return { ...state, busy: false, message: 'Nothing to undo.' };
}

export function rememberInterval(state: StudyState, interval: number | null): StudyState {
  if (interval === null) {
    return state;
  }
  return { ...state, lastInterval: interval };
}

export function rateElapsed(state: StudyState, now: number): number {
  return elapsedMs(state.shownAt, now);
}

export function openEdit(state: StudyState): StudyState {
  if (state.phase.kind !== 'card' || state.busy) {
    return state;
  }
  return { ...state, editOpen: true };
}

export function closeEdit(state: StudyState): StudyState {
  return { ...state, editOpen: false };
}

export function phaseStatus(phase: StudyPhase): 'card' | 'wait' | 'done' {
  if (phase.kind === 'card') {
    return 'card';
  }
  if (phase.kind === 'wait') {
    return 'wait';
  }
  return 'done';
}

export function phaseSide(phase: StudyPhase): 'front' | 'back' {
  if (phase.kind === 'card') {
    return phase.side;
  }
  return 'front';
}

export function applyEditedCard(state: StudyState, front: string, back: string): StudyState {
  if (state.phase.kind !== 'card') {
    return closeEdit(state);
  }
  return {
    ...state,
    editOpen: false,
    busy: false,
    message: '',
    phase: { ...state.phase, card: { ...state.phase.card, front, back } },
  };
}
