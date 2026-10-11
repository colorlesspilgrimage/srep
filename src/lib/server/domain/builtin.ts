import type {
  NoteTypeRow,
  PresetRow,
  SeedInput,
  TemplateRow,
} from '#lib/server/domain/store/store-types.js';

// Built-in rows have fixed ids. The user cannot delete them.
export const DEFAULT_PRESET_ID = '00000000-0000-4000-8000-000000000001';
export const BASIC_ID = '00000000-0000-4000-8000-000000000011';
export const BASIC_REVERSED_ID = '00000000-0000-4000-8000-000000000012';
export const CLOZE_ID = '00000000-0000-4000-8000-000000000013';
export const BASIC_CARD_ID = '00000000-0000-4000-8000-000000000021';
export const REVERSED_CARD_1_ID = '00000000-0000-4000-8000-000000000022';
export const REVERSED_CARD_2_ID = '00000000-0000-4000-8000-000000000023';
export const CLOZE_CARD_ID = '00000000-0000-4000-8000-000000000024';

export const BUILTIN_NOTE_TYPE_IDS: readonly string[] = [BASIC_ID, BASIC_REVERSED_ID, CLOZE_ID];

export const BUILTIN_PRESET: PresetRow = {
  id: DEFAULT_PRESET_ID,
  name: 'Default',
  newPerDay: 20,
  reviewsPerDay: 200,
  desiredRetention: 0.9,
  learningSteps: [1, 10],
  relearningSteps: [10],
  maxInterval: 36_500,
  fsrsParams: null,
  burySiblings: false,
  newOrder: 'added',
};

function template(
  id: string,
  noteTypeId: string,
  ordinal: number,
  name: string,
  [frontTpl, backTpl]: [string, string],
): TemplateRow {
  return { id, noteTypeId, name, ordinal, frontTpl, backTpl };
}

function noteType(id: string, name: string, fields: string[], cssClass: string): NoteTypeRow {
  return { id, name, fields, cssClass, sortFieldIdx: 0 };
}

const CARD_1: [string, string] = ['{{Front}}', '{{Front}}<hr>{{Back}}'];
const CARD_2: [string, string] = ['{{Back}}', '{{Back}}<hr>{{Front}}'];

export const BUILTIN_NOTE_TYPES: SeedInput['noteTypes'] = [
  {
    noteType: noteType(BASIC_ID, 'Basic', ['Front', 'Back'], 'basic'),
    templates: [template(BASIC_CARD_ID, BASIC_ID, 0, 'Card 1', CARD_1)],
  },
  {
    noteType: noteType(BASIC_REVERSED_ID, 'Basic+Reversed', ['Front', 'Back'], 'basic-reversed'),
    templates: [
      template(REVERSED_CARD_1_ID, BASIC_REVERSED_ID, 0, 'Card 1', CARD_1),
      template(REVERSED_CARD_2_ID, BASIC_REVERSED_ID, 1, 'Card 2', CARD_2),
    ],
  },
  {
    noteType: noteType(CLOZE_ID, 'Cloze', ['Text', 'Extra'], 'cloze'),
    templates: [
      template(CLOZE_CARD_ID, CLOZE_ID, 0, 'Cloze', [
        '{{cloze:Text}}',
        '{{cloze:Text}}<br>{{Extra}}',
      ]),
    ],
  },
];
