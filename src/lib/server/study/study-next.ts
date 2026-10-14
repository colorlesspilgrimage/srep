// Contract: getNext picks the next card of a deck tree (or of all decks) for the study day.
// Reply: status 'card' (rendered card with four answer previews), 'wait' (a learning card
// is due later today), or 'done'. Each reply has the counts and the study window.
// Errors: 404 not_found (unknown deck), 422 bad_preset, 500 settings_corrupt.
// Side effect: buried cards whose time is over come back (unburyExpired).
// The rendered text is not sanitized (same contract as M2). A client must sanitize it.
import { fail, type Result } from '#lib/server/auth/deps.js';
import { subtreeIds } from '#lib/server/domain/core/deck-paths.js';
import { toNoteView } from '#lib/server/domain/note-view.js';
import type { CardState, DeckRow, SchedState } from '#lib/server/domain/store/store-types.js';
import { schedFieldsOf } from '#lib/server/study/core/answer-plan.js';
import { studyWindow } from '#lib/server/study/core/day-clock.js';
import { previewAnswers, type AnswerPreviews } from '#lib/server/study/core/fsrs-adapter.js';
import {
  chooseNext,
  studyCounts,
  type DeckQuota,
  type StudyCounts,
} from '#lib/server/study/core/queue-choice.js';
import type { StudyWindow } from '#lib/server/study/core/types.js';
import type { StudyDeps } from '#lib/server/study/deps.js';
import { getSettings } from '#lib/server/study/study-settings.js';

export type StudyCard = {
  id: string;
  noteId: string;
  deckId: string | null;
  state: CardState;
  schedState: SchedState;
  /** The client sends this value back to answer. */
  reps: number;
  lapses: number;
  due: number;
  front: string;
  back: string;
  source: 'learning' | 'review' | 'new';
  previews: AnswerPreviews;
};

export type NextReply =
  | { status: 'card'; card: StudyCard; counts: StudyCounts; window: StudyWindow }
  | { status: 'wait'; until: number; counts: StudyCounts; window: StudyWindow }
  | { status: 'done'; counts: StudyCounts; window: StudyWindow };

// The deck and its descendants, or all decks. Archived decks are left out.
async function studyScope(
  deps: StudyDeps,
  deckId: string | undefined,
): Promise<{ decks: DeckRow[]; quotas: DeckQuota[] } | null> {
  const [all, presets] = await Promise.all([deps.domain.listDecks(), deps.domain.listPresets()]);
  if (deckId !== undefined && !all.some((d) => d.id === deckId)) {
    return null;
  }
  const ids = new Set(deckId === undefined ? all.map((d) => d.id) : subtreeIds(all, deckId));
  const decks: DeckRow[] = [];
  const quotas: DeckQuota[] = [];
  for (const deck of all) {
    const preset = presets.find((p) => p.id === deck.presetId);
    if (ids.has(deck.id) && deck.archivedAt === null && preset !== undefined) {
      decks.push(deck);
      quotas.push({
        deckId: deck.id,
        newPerDay: preset.newPerDay,
        reviewsPerDay: preset.reviewsPerDay,
        newOrder: preset.newOrder,
      });
    }
  }
  return { decks, quotas };
}

async function studyCard(
  deps: StudyDeps,
  cardId: string,
  source: StudyCard['source'],
  nowMs: number,
): Promise<Result<{ card: StudyCard }>> {
  const read = await deps.store.readCard(cardId);
  const noteState =
    read === undefined ? undefined : await deps.domain.getNoteState(read.card.noteId);
  const noteType =
    noteState === undefined ? undefined : await deps.domain.getNoteType(noteState.note.noteTypeId);
  if (read === undefined || noteState === undefined || noteType === undefined) {
    return fail(404, 'not_found');
  }
  const { card, deckPreset } = read;
  const previews =
    deckPreset === null ? null : previewAnswers(deckPreset, schedFieldsOf(card), nowMs);
  if (previews === null) {
    return fail(422, 'bad_preset');
  }
  const view = toNoteView(noteType, noteState, []).cards.find((c) => c.id === card.id);
  return {
    ok: true,
    card: {
      id: card.id,
      noteId: card.noteId,
      deckId: card.deckId,
      state: card.state,
      schedState: card.schedState,
      reps: card.reps,
      lapses: card.lapses,
      due: card.due,
      front: view?.front ?? '',
      back: view?.back ?? '',
      source,
      previews,
    },
  };
}

export async function getNext(
  deps: StudyDeps,
  input: { deckId?: string },
): Promise<Result<{ reply: NextReply }>> {
  const settings = await getSettings(deps);
  if (!settings.ok) {
    return settings;
  }
  const nowMs = deps.now();
  const window = studyWindow(nowMs, settings.settings);
  await deps.store.unburyExpired(nowMs);
  const scope = await studyScope(deps, input.deckId);
  if (scope === null) {
    return fail(404, 'not_found');
  }
  const snapshots = await deps.store.readStudySnapshots({
    deckIds: scope.decks.map((d) => d.id),
    nowMs,
    window,
    shuffleDeckIds: scope.quotas.filter((q) => q.newOrder === 'random').map((q) => q.deckId),
  });
  const counts = studyCounts(snapshots, scope.quotas);
  const choice = chooseNext(snapshots, scope.quotas, nowMs);
  if (choice.kind === 'wait') {
    return { ok: true, reply: { status: 'wait', until: choice.until, counts, window } };
  }
  if (choice.kind === 'done') {
    return { ok: true, reply: { status: 'done', counts, window } };
  }
  const picked = await studyCard(deps, choice.cardId, choice.source, nowMs);
  if (!picked.ok) {
    return picked;
  }
  return { ok: true, reply: { status: 'card', card: picked.card, counts, window } };
}
