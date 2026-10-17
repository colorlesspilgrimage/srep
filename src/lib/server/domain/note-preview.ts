// Contract: render cards for unsaved fields. A missing type is 404 not_found.
// A bad field list or a render over the cost limit is 400 bad_request.
// HTML is not sanitized. This function does not insert a note or touch media files.

import { fail, type Result } from '#lib/server/auth/deps.js';
import {
  desiredCards,
  fieldsByName,
  renderCard,
  withinRenderCost,
} from '#lib/server/domain/core/card-plan.js';
import { MAX_FIELD_TEXT } from '#lib/server/domain/core/validation.js';
import type { DomainDeps } from '#lib/server/domain/deps.js';
import type { DesiredCard } from '#lib/server/domain/core/card-plan.js';
import type { NoteTypeWithTemplates } from '#lib/server/domain/store/store-types.js';

export type PreviewInput = { noteTypeId: string; fields: string[] };

export type PreviewCard = {
  templateName: string;
  ordinal: number;
  front: string;
  back: string;
};

function fieldsFit(noteType: NoteTypeWithTemplates, fields: string[]): boolean {
  if (fields.length !== noteType.fields.length) {
    return false;
  }
  return fields.every((field) => field.length <= MAX_FIELD_TEXT && !field.includes('\u0000'));
}

export function renderPreviewCards(
  noteType: NoteTypeWithTemplates,
  fields: string[],
  cards: readonly DesiredCard[],
): PreviewCard[] {
  const named = fieldsByName(noteType, fields);
  const templates = new Map(noteType.templates.map((row) => [row.id, row]));
  const out: PreviewCard[] = [];
  for (const card of cards) {
    const template = templates.get(card.templateId);
    if (template === undefined) {
      out.push({ templateName: '', ordinal: card.ordinal, front: '', back: '' });
      continue;
    }
    const rendered = renderCard(template, named, card.ordinal);
    out.push({
      templateName: template.name,
      ordinal: card.ordinal,
      front: rendered.front,
      back: rendered.back,
    });
  }
  return out;
}

export async function previewNote(
  deps: DomainDeps,
  input: PreviewInput,
): Promise<Result<{ cards: PreviewCard[] }>> {
  const noteType = await deps.store.getNoteType(input.noteTypeId);
  if (noteType === undefined) {
    return fail(404, 'not_found');
  }
  if (!fieldsFit(noteType, input.fields)) {
    return fail(400, 'bad_request');
  }
  const named = fieldsByName(noteType, input.fields);
  if (!withinRenderCost(noteType, named, [])) {
    return fail(400, 'bad_request');
  }
  const cards = renderPreviewCards(noteType, input.fields, desiredCards(noteType, named));
  return { ok: true, cards };
}
