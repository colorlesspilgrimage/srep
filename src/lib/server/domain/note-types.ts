import { fail, type Failure, type Result } from '#lib/server/auth/deps.js';
import { BUILTIN_NOTE_TYPE_IDS } from '#lib/server/domain/builtin.js';
import {
  isValidFieldName,
  parseTemplate,
  templateFields,
} from '#lib/server/domain/core/template.js';
import { MAX_TEMPLATE_TEXT, type NoteTypeCreateInput } from '#lib/server/domain/core/validation.js';
import type { DomainDeps } from '#lib/server/domain/deps.js';
import { newId } from '#lib/server/domain/ids.js';
import type { NoteTypeWithTemplates, TemplateRow } from '#lib/server/domain/store/store-types.js';

export const MAX_FIELDS = 50;
export const MAX_TEMPLATES = 20;
const CSS_CLASS = /^[a-z][a-z0-9-]{0,31}$/;
const MAX_TEMPLATE_NAME = 100;

function checkFields(fields: string[]): Failure | null {
  if (fields.length < 1 || fields.length > MAX_FIELDS) {
    return fail(400, 'bad_request');
  }
  if (!fields.every(isValidFieldName) || new Set(fields).size !== fields.length) {
    return fail(400, 'bad_request');
  }
  return null;
}

function checkTemplate(
  template: NoteTypeCreateInput['templates'][number],
  fields: Set<string>,
): Failure | null {
  for (const source of [template.front, template.back]) {
    if (source.length > MAX_TEMPLATE_TEXT) {
      return fail(400, 'bad_request');
    }
    const parsed = parseTemplate(source);
    if (!parsed.ok) {
      return fail(400, 'invalid_template');
    }
    const used = templateFields(parsed.ast);
    if (![...used.plain, ...used.cloze].every((name) => fields.has(name))) {
      return fail(400, 'unknown_field');
    }
  }
  return null;
}

function checkTemplates(input: NoteTypeCreateInput, fields: string[]): Failure | null {
  const { templates } = input;
  if (templates.length < 1 || templates.length > MAX_TEMPLATES) {
    return fail(400, 'bad_request');
  }
  const names = templates.map((t) => t.name.trim());
  const badName = names.some((n) => n.length < 1 || n.length > MAX_TEMPLATE_NAME);
  if (badName || new Set(names).size !== names.length) {
    return fail(400, 'bad_request');
  }
  const known = new Set(fields);
  for (const template of templates) {
    const failure = checkTemplate(template, known);
    if (failure !== null) {
      return failure;
    }
  }
  return null;
}

export async function listNoteTypes(
  deps: DomainDeps,
): Promise<Result<{ noteTypes: NoteTypeWithTemplates[] }>> {
  return { ok: true, noteTypes: await deps.store.listNoteTypes() };
}

export async function getNoteType(
  deps: DomainDeps,
  id: string,
): Promise<Result<{ noteType: NoteTypeWithTemplates }>> {
  const noteType = await deps.store.getNoteType(id);
  return noteType === undefined ? fail(404, 'not_found') : { ok: true, noteType };
}

// Checks the fields and every template before anything is stored.
export async function createNoteType(
  deps: DomainDeps,
  input: NoteTypeCreateInput,
): Promise<Result<{ noteType: NoteTypeWithTemplates }>> {
  const fields = input.fields.map((f) => f.trim());
  const sortFieldIdx = input.sortFieldIdx ?? 0;
  const cssClass = input.cssClass ?? 'custom';
  const failure = checkFields(fields) ?? checkTemplates(input, fields);
  if (failure !== null) {
    return failure;
  }
  if (sortFieldIdx >= fields.length || !CSS_CLASS.test(cssClass)) {
    return fail(400, 'bad_request');
  }
  const id = newId(deps.random);
  const templates: TemplateRow[] = input.templates.map((t, ordinal) => ({
    id: newId(deps.random),
    noteTypeId: id,
    name: t.name.trim(),
    ordinal,
    frontTpl: t.front,
    backTpl: t.back,
  }));
  const noteType = { id, name: input.name, fields, cssClass, sortFieldIdx };
  if ((await deps.store.insertNoteType(noteType, templates)) === 'name_taken') {
    return fail(409, 'name_taken');
  }
  return { ok: true, noteType: { ...noteType, templates } };
}

export async function deleteNoteType(deps: DomainDeps, id: string): Promise<Result<object>> {
  if (BUILTIN_NOTE_TYPE_IDS.includes(id)) {
    return fail(409, 'builtin_protected');
  }
  const result = await deps.store.deleteNoteTypeUnlessUsed(id);
  if (result === 'not_found') {
    return fail(404, 'not_found');
  }
  if (result === 'in_use') {
    return fail(409, 'in_use');
  }
  return { ok: true };
}
