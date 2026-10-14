import { fail, type Failure, type Result } from '#lib/server/auth/deps.js';
import { randomToken } from '#lib/server/auth/tokens.js';
import {
  desiredCards,
  fieldsByName,
  reconcile,
  withinRenderCost,
  type DesiredCard,
} from '#lib/server/domain/core/card-plan.js';
import { findMediaTokens } from '#lib/server/domain/core/media-rules.js';
import { normalizeTags } from '#lib/server/domain/core/tags.js';
import { fieldChecksum } from '#lib/server/domain/core/text.js';
import { MAX_FIELD_TEXT } from '#lib/server/domain/core/validation.js';
import type {
  CardsMoveInput,
  NoteCreateInput,
  NotePatchInput,
} from '#lib/server/domain/core/validation.js';
import type { DomainDeps } from '#lib/server/domain/deps.js';
import { newId } from '#lib/server/domain/ids.js';
import { toNoteView, type NoteView } from '#lib/server/domain/note-view.js';
import type {
  NoteChange,
  NoteRow,
  NoteState,
  NoteTypeWithTemplates,
} from '#lib/server/domain/store/store-types.js';

export type { CardView, NoteView } from '#lib/server/domain/note-view.js';

export const TRASH_RETENTION_MS = 30 * 24 * 3600 * 1000;

type NoteResult = Promise<Result<{ note: NoteView }>>;

// Checks the field count and size, the tags, the render cost and the media tokens.
// `existing` lists the stored cards of the note, which the view renders too.
// Returns the clean tags.
async function checkContent(
  deps: DomainDeps,
  noteType: NoteTypeWithTemplates,
  fields: string[],
  tags: string[],
  existing: DesiredCard[] = [],
): Promise<Failure | { ok: true; tags: string[] }> {
  if (fields.length !== noteType.fields.length) {
    return fail(400, 'field_count_mismatch');
  }
  if (fields.some((f) => f.length > MAX_FIELD_TEXT || f.includes('\u0000'))) {
    return fail(400, 'bad_request');
  }
  const clean = normalizeTags(tags);
  if (clean === null) {
    return fail(400, 'invalid_tag');
  }
  if (!withinRenderCost(noteType, fieldsByName(noteType, fields), existing)) {
    return fail(413, 'payload_too_large');
  }
  const missing = await deps.store.findMissingMedia(fields.flatMap(findMediaTokens));
  return missing.length > 0 ? fail(400, 'unknown_media') : { ok: true, tags: clean };
}

const checksumOf = (noteType: NoteTypeWithTemplates, fields: string[]): string =>
  fieldChecksum(fields[noteType.sortFieldIdx] ?? '');

async function viewOf(
  deps: DomainDeps,
  noteType: NoteTypeWithTemplates,
  id: string,
  known?: NoteState,
): NoteResult {
  const state = known ?? (await deps.store.getNoteState(id));
  if (state === undefined) {
    return fail(404, 'not_found');
  }
  const duplicates =
    state.note.deletedAt === null
      ? await deps.store.findNoteIdsByChecksum(noteType.id, state.note.checksum, id)
      : [];
  return { ok: true, note: toNoteView(noteType, state, duplicates) };
}

export async function createNote(deps: DomainDeps, input: NoteCreateInput): NoteResult {
  const noteType = await deps.store.getNoteType(input.noteTypeId);
  if (noteType === undefined || (await deps.store.getDeck(input.deckId)) === undefined) {
    return fail(404, 'not_found');
  }
  const content = await checkContent(deps, noteType, input.fields, input.tags);
  if (!content.ok) {
    return content;
  }
  const now = deps.now();
  const note: NoteRow = {
    id: newId(deps.random),
    noteTypeId: noteType.id,
    guid: randomToken(12, deps.random),
    fields: input.fields,
    createdAt: now,
    updatedAt: now,
    checksum: checksumOf(noteType, input.fields),
    deletedAt: null,
  };
  const cards = desiredCards(noteType, fieldsByName(noteType, input.fields)).map((card) => ({
    id: newId(deps.random),
    ...card,
    deckId: input.deckId,
  }));
  await deps.store.insertNote({ note, tags: content.tags, cards, now });
  return viewOf(deps, noteType, note.id);
}

// `fields` and `tags` are undefined when the patch does not change them. Then the
// transaction keeps the stored values, so a parallel edit is not lost (CWE-362).
type PlannedEdit = {
  noteType: NoteTypeWithTemplates;
  fields: string[] | undefined;
  tags: string[] | undefined;
  deckId: string | undefined;
  now: number;
};

// Pure step in the store transaction. A new card goes to the deck of the first card
// that has one. Without such a card, it goes to the requested deck.
function planNoteChange(deps: DomainDeps, edit: PlannedEdit, state: NoteState): NoteChange {
  const fields = edit.fields ?? state.note.fields;
  const desired = desiredCards(edit.noteType, fieldsByName(edit.noteType, fields));
  const plan = reconcile(desired, state.cards);
  const home = state.cards.find((c) => c.deckId !== null)?.deckId ?? edit.deckId;
  if (plan.create.length > 0 && home === undefined) {
    return fail(400, 'deck_required');
  }
  return {
    ok: true,
    fields,
    checksum: checksumOf(edit.noteType, fields),
    updatedAt: edit.now,
    tags: edit.tags ?? state.tags,
    create: plan.create.map((c) => ({ id: newId(deps.random), ...c, deckId: home as string })),
    deleteIds: plan.deleteIds,
    orphanIds: plan.orphanIds,
    unorphanIds: plan.unorphanIds,
  };
}

// Cards that stay keep their review history. See reconcile() for removed cards.
export async function updateNote(deps: DomainDeps, id: string, patch: NotePatchInput): NoteResult {
  const current = await deps.store.getNoteState(id);
  const noteType =
    current === undefined ? undefined : await deps.store.getNoteType(current.note.noteTypeId);
  if (current === undefined || current.note.deletedAt !== null || noteType === undefined) {
    return fail(404, 'not_found');
  }
  const fields = patch.fields ?? current.note.fields;
  const tags = patch.tags ?? current.tags;
  const content = await checkContent(deps, noteType, fields, tags, current.cards);
  if (!content.ok) {
    return content;
  }
  if (patch.deckId !== undefined && (await deps.store.getDeck(patch.deckId)) === undefined) {
    return fail(404, 'not_found');
  }
  const edit: PlannedEdit = {
    noteType,
    fields: patch.fields,
    tags: patch.tags === undefined ? undefined : content.tags,
    deckId: patch.deckId,
    now: deps.now(),
  };
  const result = await deps.store.updateNote(id, (state) => planNoteChange(deps, edit, state));
  if (result === 'not_found') {
    return fail(404, 'not_found');
  }
  return result.ok ? viewOf(deps, noteType, id) : result;
}

export async function getNote(deps: DomainDeps, id: string): NoteResult {
  const state = await deps.store.getNoteState(id);
  if (state === undefined) {
    return fail(404, 'not_found');
  }
  const noteType = await deps.store.getNoteType(state.note.noteTypeId);
  if (noteType === undefined) {
    return fail(404, 'not_found');
  }
  return viewOf(deps, noteType, id, state);
}

export async function trashNote(deps: DomainDeps, id: string): Promise<Result<object>> {
  return (await deps.store.trashNote(id, deps.now())) ? { ok: true } : fail(404, 'not_found');
}

// A card whose deck was deleted needs a new deck before the note comes back.
export async function restoreNote(
  deps: DomainDeps,
  id: string,
  input: { deckId?: string },
): NoteResult {
  const result = await deps.store.restoreNote(id, input.deckId, deps.now());
  if (result === 'deck_required') {
    return fail(400, 'deck_required');
  }
  if (result !== 'ok') {
    return fail(404, 'not_found');
  }
  return getNote(deps, id);
}

// Moves cards and keeps their review state. One unknown id stops the whole move.
export async function moveCards(deps: DomainDeps, input: CardsMoveInput): Promise<Result<object>> {
  const result = await deps.store.moveCards(input.cardIds, input.deckId);
  return result === 'ok' ? { ok: true } : fail(404, 'not_found');
}

// Removes the notes that are in the trash for TRASH_RETENTION_MS or longer.
export async function purgeTrash(deps: DomainDeps): Promise<Result<{ purged: number }>> {
  return { ok: true, purged: await deps.store.purgeTrash(deps.now() - TRASH_RETENTION_MS) };
}
