// Contract: the study JSON client.
// A deck id or a note id enters a path only after the UUID check.
// A card id is checked, then sent with JSON.stringify through apiFetch.
// reps is an integer from 0 to 1000000. elapsedMs is 0 to 3600000.
// A failed check does not call fetch. No shell command is built.

import { apiFetch, rejectedResult, type ApiResult } from '#lib/client/api.js';
import { isDeckUuid } from './deck-id.js';
import { MAX_ELAPSED_MS } from './study-elapsed.js';
import { isStudyRating, type StudyRating } from './study-keys.js';
import { validNoteFields } from './study-parse.js';
import { noteResourcePath, studyNextPath } from './study-paths.js';

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

const MAX_REPS = 1_000_000;

function validAnswer(body: AnswerRequest): boolean {
  const repsOk = Number.isInteger(body.reps) && body.reps >= 0 && body.reps <= MAX_REPS;
  const elapsedOk =
    Number.isInteger(body.elapsedMs) && body.elapsedMs >= 0 && body.elapsedMs <= MAX_ELAPSED_MS;
  return isStudyRating(body.rating) && repsOk && elapsedOk;
}

export { validNoteFields };

export function createStudyClient(fetchJson: FetchJson = apiFetch) {
  function fetchIf<T>(
    ok: boolean,
    path: string | null,
    init?: { method?: string; body?: unknown },
  ): Promise<ApiResult<T>> {
    if (!ok || path === null) {
      return Promise.resolve(rejectedResult());
    }
    return fetchJson(path, init);
  }

  return {
    next(deckId: string | null) {
      const path = studyNextPath(deckId);
      return fetchIf(path !== null, path);
    },
    answer(body: AnswerRequest) {
      const ok = isDeckUuid(body.cardId) && validAnswer(body);
      return fetchIf(ok, '/api/study/answer', { method: 'POST', body });
    },
    undo() {
      return fetchIf(true, '/api/study/undo', { method: 'POST', body: {} });
    },
    suspend(cardId: string) {
      return fetchIf(isDeckUuid(cardId), '/api/cards/suspend', {
        method: 'POST',
        body: { cardIds: [cardId] },
      });
    },
    getNote(noteId: string) {
      const path = noteResourcePath(noteId);
      return fetchIf(path !== null, path);
    },
    patchNote(noteId: string, fields: readonly string[]) {
      const path = noteResourcePath(noteId);
      return fetchIf(path !== null && validNoteFields(fields), path, {
        method: 'PATCH',
        body: { fields: [...fields] },
      });
    },
  };
}
