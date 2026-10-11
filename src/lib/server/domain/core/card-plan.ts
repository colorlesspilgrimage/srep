import { clozeIndices } from '#lib/server/domain/core/cloze.js';
import {
  parseTemplate,
  renderTemplate,
  templateFields,
  type TemplateNode,
} from '#lib/server/domain/core/template.js';
import { isBlank } from '#lib/server/domain/core/text.js';

// The card lost its source (template or cloze) and waits for the user to confirm.
export const FLAG_ORPHANED = 1;

export type PlanTemplate = { id: string; ordinal: number; frontTpl: string; backTpl: string };
export type PlanNoteType = { fields: string[]; templates: PlanTemplate[] };
export type DesiredCard = { templateId: string; ordinal: number };
export type ExistingCard = {
  id: string;
  templateId: string;
  ordinal: number;
  reps: number;
  flags: number;
};

export type Reconciliation = {
  create: DesiredCard[];
  keep: string[];
  deleteIds: string[];
  orphanIds: string[];
  unorphanIds: string[];
};

// Templates are checked when the note type is made. A broken one gives no output.
function astOf(source: string): TemplateNode[] {
  const parsed = parseTemplate(source);
  return parsed.ok ? parsed.ast : [];
}

export function fieldsByName(
  noteType: { fields: string[] },
  values: string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  noteType.fields.forEach((name, i) => {
    out[name] = values[i] ?? '';
  });
  return out;
}

function desiredForTemplate(template: PlanTemplate, fields: Record<string, string>): DesiredCard[] {
  const front = astOf(template.frontTpl);
  const clozeFields = templateFields(front).cloze;
  if (clozeFields.size === 0) {
    const rendered = renderTemplate(front, fields, { side: 'front', clozeIndex: 0 });
    return isBlank(rendered) ? [] : [{ templateId: template.id, ordinal: 0 }];
  }
  const indices = new Set<number>();
  for (const name of clozeFields) {
    for (const index of clozeIndices(fields[name] ?? '')) {
      indices.add(index);
    }
  }
  return [...indices]
    .sort((a, b) => a - b)
    .map((ordinal) => ({ templateId: template.id, ordinal }));
}

// The cards that the note must have. Sorted by template ordinal, then card ordinal.
export function desiredCards(
  noteType: PlanNoteType,
  fields: Record<string, string>,
): DesiredCard[] {
  const templates = [...noteType.templates].sort((a, b) => a.ordinal - b.ordinal);
  return templates.flatMap((template) => desiredForTemplate(template, fields));
}

export function renderCard(
  template: PlanTemplate,
  fields: Record<string, string>,
  ordinal: number,
): { front: string; back: string } {
  return {
    front: renderTemplate(astOf(template.frontTpl), fields, { side: 'front', clozeIndex: ordinal }),
    back: renderTemplate(astOf(template.backTpl), fields, { side: 'back', clozeIndex: ordinal }),
  };
}

const keyOf = (card: DesiredCard): string => `${card.templateId}:${card.ordinal}`;

// Compares the wanted cards with the stored cards. A reviewed card is never deleted.
export function reconcile(desired: DesiredCard[], existing: ExistingCard[]): Reconciliation {
  const result: Reconciliation = {
    create: [],
    keep: [],
    deleteIds: [],
    orphanIds: [],
    unorphanIds: [],
  };
  const wanted = new Set(desired.map(keyOf));
  const stored = new Set(existing.map(keyOf));
  for (const card of desired) {
    if (!stored.has(keyOf(card))) {
      result.create.push(card);
    }
  }
  for (const card of existing) {
    const orphaned = (card.flags & FLAG_ORPHANED) !== 0;
    if (wanted.has(keyOf(card))) {
      result.keep.push(card.id);
      if (orphaned) {
        result.unorphanIds.push(card.id);
      }
    } else if (card.reps === 0) {
      result.deleteIds.push(card.id);
    } else if (!orphaned) {
      result.orphanIds.push(card.id);
    }
  }
  return result;
}
