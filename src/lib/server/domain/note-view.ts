import { fieldsByName, renderCard } from '#lib/server/domain/core/card-plan.js';
import type {
  CardState,
  NoteState,
  NoteTypeWithTemplates,
} from '#lib/server/domain/store/store-types.js';

export type CardView = {
  id: string;
  templateId: string;
  templateName: string;
  ordinal: number;
  deckId: string | null;
  state: CardState;
  position: number;
  flags: number;
  /** Rendered text. It is not sanitized. A client must sanitize it before display. */
  front: string;
  back: string;
};

export type NoteView = {
  id: string;
  noteTypeId: string;
  guid: string;
  fields: string[];
  tags: string[];
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
  cards: CardView[];
  duplicates: string[];
};

export function toNoteView(
  noteType: NoteTypeWithTemplates,
  state: NoteState,
  duplicates: string[],
): NoteView {
  const { note } = state;
  const fields = fieldsByName(noteType, note.fields);
  const cards = state.cards.map((card): CardView => {
    const template = noteType.templates.find((t) => t.id === card.templateId);
    const rendered =
      template === undefined ? { front: '', back: '' } : renderCard(template, fields, card.ordinal);
    return {
      id: card.id,
      templateId: card.templateId,
      templateName: template?.name ?? '',
      ordinal: card.ordinal,
      deckId: card.deckId,
      state: card.state,
      position: card.position,
      flags: card.flags,
      ...rendered,
    };
  });
  return {
    id: note.id,
    noteTypeId: note.noteTypeId,
    guid: note.guid,
    fields: note.fields,
    tags: state.tags,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    deletedAt: note.deletedAt,
    cards,
    duplicates,
  };
}
