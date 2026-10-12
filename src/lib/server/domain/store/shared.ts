import type { CardDraft, CardRow, TemplateRow } from '#lib/server/domain/store/store-types.js';

// SQLite allows a limited count of bound values in one statement.
export const ID_CHUNK = 500;

export function chunk<T>(items: T[], size = ID_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

export function newCard(draft: CardDraft, noteId: string, now: number, position: number): CardRow {
  return {
    id: draft.id,
    noteId,
    templateId: draft.templateId,
    ordinal: draft.ordinal,
    deckId: draft.deckId,
    state: 'new',
    due: now,
    stability: 0,
    difficulty: 0,
    lastReview: null,
    reps: 0,
    lapses: 0,
    position,
    buriedUntil: null,
    flags: 0,
    schedState: 'new',
    learningStep: 0,
  };
}

export function withTemplates<T extends { id: string }>(
  noteTypes: T[],
  templates: TemplateRow[],
): (T & { templates: TemplateRow[] })[] {
  return noteTypes.map((nt) => ({
    ...nt,
    templates: templates
      .filter((t) => t.noteTypeId === nt.id)
      .sort((a, b) => a.ordinal - b.ordinal),
  }));
}
