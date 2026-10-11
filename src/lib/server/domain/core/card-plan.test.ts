import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BUILTIN_NOTE_TYPES } from '#lib/server/domain/builtin.js';
import {
  desiredCards,
  fieldsByName,
  FLAG_ORPHANED,
  reconcile,
  renderCard,
  type DesiredCard,
  type ExistingCard,
  type PlanNoteType,
} from '#lib/server/domain/core/card-plan.js';

function builtin(index: number): PlanNoteType {
  const entry = BUILTIN_NOTE_TYPES[index];
  if (entry === undefined) {
    throw new Error('missing built-in');
  }
  return { fields: entry.noteType.fields, templates: entry.templates };
}

const basic = builtin(0);
const reversed = builtin(1);
const cloze = builtin(2);

function plan(noteType: PlanNoteType, values: string[]): DesiredCard[] {
  return desiredCards(noteType, fieldsByName(noteType, values));
}

describe('desiredCards', () => {
  it('gives 1 card for Basic and none for an empty front', () => {
    expect(plan(basic, ['dog', 'Hund'])).toHaveLength(1);
    expect(plan(basic, ['', 'Hund'])).toEqual([]);
    expect(plan(basic, ['<br>&nbsp;', 'Hund'])).toEqual([]);
  });

  it('gives 2 cards for Basic+Reversed, and 1 for an empty Back', () => {
    expect(plan(reversed, ['dog', 'Hund']).map((c) => c.ordinal)).toEqual([0, 0]);
    expect(plan(reversed, ['dog', 'Hund'])).toHaveLength(2);
    const one = plan(reversed, ['dog', '']);
    expect(one).toEqual([{ templateId: reversed.templates[0]?.id, ordinal: 0 }]);
  });

  it('gives one card per distinct cloze index, sorted', () => {
    const cards = plan(cloze, ['{{c3::a}} {{c1::b}} {{c2::c}} {{c1::d}}', '']);
    expect(cards.map((c) => c.ordinal)).toEqual([1, 2, 3]);
    expect(plan(cloze, ['no cloze here', 'extra'])).toEqual([]);
  });

  it('uses a conditional template of a custom type', () => {
    const custom: PlanNoteType = {
      fields: ['Word', 'Audio'],
      templates: [
        { id: 't1', ordinal: 0, frontTpl: '{{Word}}', backTpl: '{{Audio}}' },
        {
          id: 't2',
          ordinal: 1,
          frontTpl: '{{#Audio}}listen {{Audio}}{{/Audio}}',
          backTpl: '{{Word}}',
        },
      ],
    };
    expect(plan(custom, ['w', ''])).toEqual([{ templateId: 't1', ordinal: 0 }]);
    expect(plan(custom, ['w', 'a'])).toHaveLength(2);
  });

  it('renders the front and back of a card', () => {
    const template = cloze.templates[0];
    if (template === undefined) {
      throw new Error('missing template');
    }
    const fields = fieldsByName(cloze, ['{{c1::Tokyo}} is big', 'note']);
    expect(renderCard(template, fields, 1)).toEqual({
      front: '<span class="cloze">[...]</span> is big',
      back: '<span class="cloze">Tokyo</span> is big<br>note',
    });
  });
});

function existing(id: string, ordinal: number, extra: Partial<ExistingCard> = {}): ExistingCard {
  return { id, templateId: 't', ordinal, reps: 0, flags: 0, ...extra };
}

const want = (...ordinals: number[]): DesiredCard[] =>
  ordinals.map((ordinal) => ({ templateId: 't', ordinal }));

describe('reconcile', () => {
  it('keeps an unchanged note', () => {
    expect(reconcile(want(1), [existing('a', 1)])).toEqual({
      create: [],
      keep: ['a'],
      deleteIds: [],
      orphanIds: [],
      unorphanIds: [],
    });
  });

  it('creates a card for a new cloze index', () => {
    expect(reconcile(want(1, 2), [existing('a', 1)]).create).toEqual(want(2));
  });

  it('deletes an unreviewed card that is not wanted', () => {
    expect(reconcile(want(1), [existing('a', 1), existing('b', 2)]).deleteIds).toEqual(['b']);
  });

  it('orphans a reviewed card that is not wanted', () => {
    const result = reconcile(want(1), [existing('a', 1), existing('b', 2, { reps: 3 })]);
    expect(result.orphanIds).toEqual(['b']);
    expect(result.deleteIds).toEqual([]);
  });

  it('leaves an orphaned card as it is', () => {
    const card = existing('b', 2, { reps: 3, flags: FLAG_ORPHANED });
    const result = reconcile(want(1), [existing('a', 1), card]);
    expect(result.orphanIds).toEqual([]);
    expect(result.deleteIds).toEqual([]);
    expect(result.keep).toEqual(['a']);
  });

  it('clears the orphan flag when the card is wanted again', () => {
    const card = existing('b', 2, { reps: 3, flags: FLAG_ORPHANED });
    const result = reconcile(want(1, 2), [existing('a', 1), card]);
    expect(result.unorphanIds).toEqual(['b']);
    expect(result.keep).toEqual(['a', 'b']);
  });

  it('puts every card in exactly one group (seeded property)', () => {
    const card = fc.record({
      ordinal: fc.integer({ min: 0, max: 6 }),
      reps: fc.integer({ min: 0, max: 2 }),
      flags: fc.constantFrom(0, FLAG_ORPHANED),
    });
    const input = fc.tuple(
      fc.uniqueArray(fc.integer({ min: 0, max: 6 }), { maxLength: 7 }),
      fc.uniqueArray(card, { selector: (c) => c.ordinal, maxLength: 7 }),
    );
    fc.assert(
      fc.property(input, ([wanted, stored]) => {
        const cards = stored.map((c, i) => existing(`c${i}`, c.ordinal, c));
        const result = reconcile(want(...wanted), cards);
        for (const c of cards) {
          const groups = [result.keep, result.deleteIds, result.orphanIds].filter((g) =>
            g.includes(c.id),
          );
          const untouchedOrphan = c.flags === FLAG_ORPHANED && c.reps > 0;
          expect(groups.length).toBe(wanted.includes(c.ordinal) || !untouchedOrphan ? 1 : 0);
        }
        const kept = cards.filter((c) => result.keep.includes(c.id)).map((c) => c.ordinal);
        const made = result.create.map((c) => c.ordinal);
        expect([...kept, ...made].sort()).toEqual([...wanted].sort());
      }),
      { seed: 20261011, numRuns: 200 },
    );
  });
});
