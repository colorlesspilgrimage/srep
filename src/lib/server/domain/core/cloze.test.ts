import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  clozeIndices,
  parseCloze,
  renderCloze,
  segmentsToSource,
} from '#lib/server/domain/core/cloze.js';

const FC = { seed: 20261011, numRuns: 200 };

describe('parseCloze examples', () => {
  it('reads one cloze', () => {
    expect(parseCloze('{{c1::a}}')).toEqual([
      { kind: 'cloze', index: 1, text: 'a', hint: null, source: '{{c1::a}}' },
    ]);
    expect(clozeIndices('{{c1::a}}')).toEqual([1]);
  });

  it('reads a hint, and splits the body at the first ::', () => {
    expect(parseCloze('{{c1::a::hint}}')[0]).toMatchObject({ text: 'a', hint: 'hint' });
    expect(parseCloze('{{c1::a::b::c}}')[0]).toMatchObject({ text: 'a', hint: 'b::c' });
  });

  it('finds distinct indices in ascending order', () => {
    expect(clozeIndices('{{c2::x}} and {{c1::y}} and {{c1::z}}')).toEqual([1, 2]);
    expect(clozeIndices('{{c1::a}} {{c1::b}}')).toEqual([1]);
  });

  it.each(['{{c0::a}}', '{{c1000::a}}', '{{c1::unclosed', '{{c::a}}', '{{c1:a}}', '{{c+1::a}}'])(
    'keeps %s as literal text',
    (text) => {
      expect(parseCloze(text)).toEqual([{ kind: 'text', text }]);
      expect(clozeIndices(text)).toEqual([]);
    },
  );

  it('accepts leading zeros when the value is in range', () => {
    expect(clozeIndices('{{c007::a}}')).toEqual([7]);
    expect(segmentsToSource(parseCloze('{{c007::a}}'))).toBe('{{c007::a}}');
  });

  it('ends the cloze at the first }} and keeps the rest literal', () => {
    expect(parseCloze('x {{c1::a}} y}}')).toEqual([
      { kind: 'text', text: 'x ' },
      { kind: 'cloze', index: 1, text: 'a', hint: null, source: '{{c1::a}}' },
      { kind: 'text', text: ' y}}' },
    ]);
  });

  it('allows an empty body and unicode text', () => {
    expect(parseCloze('{{c1::}}')[0]).toMatchObject({ text: '', hint: null });
    expect(parseCloze('{{c3::東京 🗼}}')[0]).toMatchObject({ index: 3, text: '東京 🗼' });
  });
});

describe('renderCloze', () => {
  const source = '{{c1::Tokyo::city}} is in {{c2::Japan}}';

  it('shows a gap with the hint or [...] on the front', () => {
    expect(renderCloze(source, 1, 'front')).toBe('<span class="cloze">[city]</span> is in Japan');
    expect(renderCloze(source, 2, 'front')).toBe('Tokyo is in <span class="cloze">[...]</span>');
  });

  it('shows the answer on the back', () => {
    expect(renderCloze(source, 2, 'back')).toBe('Tokyo is in <span class="cloze">Japan</span>');
  });

  it('shows all text for active index 0', () => {
    expect(renderCloze(source, 0, 'front')).toBe('Tokyo is in Japan');
  });
});

type Piece =
  { kind: 'lit'; text: string } | { kind: 'cloze'; index: number; text: string; hint?: string };

// Literal text without `{{` and cloze text without `::` and `}`, so the document is exact.
const literal = fc.string().filter((s) => !s.includes('{') && !s.endsWith('}'));
const clozeText = fc
  .string()
  .filter((s) => !s.includes('::') && !s.includes('}') && !s.endsWith(':'));
const piece: fc.Arbitrary<Piece> = fc.oneof(
  literal.map((text) => ({ kind: 'lit' as const, text })),
  fc.record(
    {
      kind: fc.constant('cloze' as const),
      index: fc.integer({ min: 1, max: 999 }),
      text: clozeText,
      hint: clozeText,
    },
    { requiredKeys: ['kind', 'index', 'text'] },
  ),
);

function source(pieces: Piece[]): string {
  return pieces
    .map((p) =>
      p.kind === 'lit'
        ? p.text
        : `{{c${p.index}::${p.text}${p.hint === undefined ? '' : `::${p.hint}`}}}`,
    )
    .join('');
}

describe('cloze properties (seeded)', () => {
  it('never throws and joins back to the input', () => {
    fc.assert(
      fc.property(fc.oneof(fc.string(), fc.string({ unit: 'binary' })), (s) => {
        expect(segmentsToSource(parseCloze(s))).toBe(s);
      }),
      FC,
    );
  });

  it('round-trips text built from cloze pieces', () => {
    const noisy = fc.array(fc.constantFrom('{{c', '1', '::', '}}', 'x', '{', '}', ':'), {
      maxLength: 30,
    });
    fc.assert(
      fc.property(noisy, (parts) => {
        const s = parts.join('');
        expect(segmentsToSource(parseCloze(s))).toBe(s);
      }),
      FC,
    );
  });

  it('finds exactly the generated indices', () => {
    fc.assert(
      fc.property(fc.array(piece, { maxLength: 12 }), (pieces) => {
        const expected = [...new Set(pieces.flatMap((p) => (p.kind === 'cloze' ? [p.index] : [])))];
        expect(clozeIndices(source(pieces))).toEqual(expected.sort((a, b) => a - b));
      }),
      FC,
    );
  });

  it('shows the plain text for index 0 on the back', () => {
    fc.assert(
      fc.property(fc.array(piece, { maxLength: 12 }), (pieces) => {
        const plain = pieces.map((p) => p.text).join('');
        expect(renderCloze(source(pieces), 0, 'back')).toBe(plain);
      }),
      FC,
    );
  });

  it('runs in linear time on a long unclosed input (CWE-1333)', () => {
    // The test timeout is the bound. A quadratic scan would not finish in time.
    expect(clozeIndices('{{c1::'.repeat(100_000 / 6))).toEqual([]);
    expect(clozeIndices('{{c1'.repeat(25_000))).toEqual([]);
    expect(clozeIndices(`${'{{c1::x'.repeat(14_000)}}}`)).toEqual([1]);
  });
});
