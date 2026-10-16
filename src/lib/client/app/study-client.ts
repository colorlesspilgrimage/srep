// Contract: the study JSON client.
// A deck id or a note id enters a path only after the UUID check.
// A card id is checked, then sent with JSON.stringify through apiFetch.
// A failed check does not call fetch. No shell command is built.

import { apiFetch, type ApiResult } from '#lib/client/api.js';
import { isDeckUuid } from './deck-id.js';
import { noteResourcePath, studyNextPath } from './study-paths.js';
import type { StudyRating } from './study-keys.js';

type FetchJson = <T>(
  path: string,
  init?: { method?: string; body?: unknown },
) => Promise<ApiResult<T>>;

export type AnswerRequest = {
  cardId: string;
  rating: StudyRating;
  reps: number;
  elapsedMs: number;
};

const MAX_ELAPSED_MS = 3_600_000;
const MAX_FIELDS = 100;
const MAX_FIELD_TEXT = 50_000;

function rejected(): ApiResult<never> {
  return { ok: false, status: 400, error: 'bad_request' };
}

function validAnswer(body: AnswerRequest): boolean {
  const ratingOk = body.rating === 1 || body.rating === 2 || body.rating === 3 || body.rating === 4;
  const repsOk = Number.isInteger(body.reps) && body.reps >= 0;
  const elapsedOk =
    Number.isInteger(body.elapsedMs) && body.elapsedMs >= 0 && body.elapsedMs <= MAX_ELAPSED_MS;
  return ratingOk && repsOk && elapsedOk;
}

export function validNoteFields(fields: readonly string[]): boolean {
  if (fields.length > MAX_FIELDS) {
    return false;
  }
  return fields.every((field) => field.length <= MAX_FIELD_TEXT && !field.includes('\u0000'));
}

export function createStudyClient(fetchJson: FetchJson = apiFetch) {
  return {
    next(deckId: string | null) {
      const path = studyNextPath(deckId);
      if (path === null) {
        return Promise.resolve(rejected());
      }
      return fetchJson(path);
    },
    answer(body: AnswerRequest) {
      if (!isDeckUuid(body.cardId) || !validAnswer(body)) {
        return Promise.resolve(rejected());
      }
      return fetchJson('/api/study/answer', { method: 'POST', body });
    },
    undo() {
      return fetchJson('/api/study/undo', { method: 'POST', body: {} });
    },
    suspend(cardId: string) {
      if (!isDeckUuid(cardId)) {
        return Promise.resolve(rejected());
      }
      return fetchJson('/api/cards/suspend', { method: 'POST', body: { cardIds: [cardId] } });
    },
    getNote(noteId: string) {
      const path = noteResourcePath(noteId);
      if (path === null) {
        return Promise.resolve(rejected());
      }
      return fetchJson(path);
    },
    patchNote(noteId: string, fields: readonly string[]) {
      const path = noteResourcePath(noteId);
      if (path === null || !validNoteFields(fields)) {
        return Promise.resolve(rejected());
      }
      return fetchJson(path, { method: 'PATCH', body: { fields: [...fields] } });
    },
  };
}
