import { clozeIndices } from '#lib/server/domain/core/cloze.js';
import {
  chargeRender,
  parseTemplate,
  RenderLimitError,
  renderTemplate,
  templateFields,
  type RenderBudget,
  type TemplateNode,
} from '#lib/server/domain/core/template.js';
import { isBlank } from '#lib/server/domain/core/text.js';

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

function astOf(source: string, budget?: RenderBudget): TemplateNode[] {
  chargeRender(budget, source.length);
  const parsed = parseTemplate(source);
  return parsed.ok ? parsed.ast : [];
}

export function fieldsByName(
  noteType: { fields: string[] },
  values: string[],
): Record<string, string> {
  const out = Object.create(null) as Record<string, string>;
  noteType.fields.forEach((name, i) => {
    out[name] = values[i] ?? '';
  });
  return out;
}

function desiredForTemplate(
  template: PlanTemplate,
  fields: Record<string, string>,
  budget?: RenderBudget,
): DesiredCard[] {
  const front = astOf(template.frontTpl, budget);
  const clozeFields = templateFields(front).cloze;
  if (clozeFields.size === 0) {
    const rendered = renderTemplate(front, fields, { side: 'front', clozeIndex: 0, budget });
    return isBlank(rendered) ? [] : [{ templateId: template.id, ordinal: 0 }];
  }
  const indices = new Set<number>();
  for (const name of clozeFields) {
    const value = fields[name] ?? '';
    chargeRender(budget, value.length);
    for (const index of clozeIndices(value)) {
      indices.add(index);
    }
  }
  return [...indices]
    .sort((a, b) => a - b)
    .map((ordinal) => ({ templateId: template.id, ordinal }));
}

export function desiredCards(
  noteType: PlanNoteType,
  fields: Record<string, string>,
  budget?: RenderBudget,
): DesiredCard[] {
  const templates = [...noteType.templates].sort((a, b) => a.ordinal - b.ordinal);
  return templates.flatMap((template) => desiredForTemplate(template, fields, budget));
}

export function renderCard(
  template: PlanTemplate,
  fields: Record<string, string>,
  ordinal: number,
  budget?: RenderBudget,
): { front: string; back: string } {
  const front = astOf(template.frontTpl, budget);
  const back = astOf(template.backTpl, budget);
  return {
    front: renderTemplate(front, fields, { side: 'front', clozeIndex: ordinal, budget }),
    back: renderTemplate(back, fields, { side: 'back', clozeIndex: ordinal, budget }),
  };
}

export const MAX_NOTE_RENDER_COST = 32_000_000;

export function withinRenderCost(
  noteType: PlanNoteType,
  fields: Record<string, string>,
  existing: DesiredCard[],
  limit = MAX_NOTE_RENDER_COST,
): boolean {
  const budget: RenderBudget = { left: limit };
  try {
    const cards = new Map<string, DesiredCard>();
    for (const card of [...desiredCards(noteType, fields, budget), ...existing]) {
      cards.set(keyOf(card), card);
    }
    for (const card of cards.values()) {
      const template = noteType.templates.find((t) => t.id === card.templateId);
      if (template !== undefined) {
        renderCard(template, fields, card.ordinal, budget);
      }
    }
    return true;
  } catch (error) {
    if (error instanceof RenderLimitError) {
      return false;
    }
    throw error;
  }
}

const keyOf = (card: DesiredCard): string => `${card.templateId}:${card.ordinal}`;

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
