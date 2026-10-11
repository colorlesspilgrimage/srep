import { describe, expect, it } from 'vitest';
import {
  fieldsByName,
  MAX_NOTE_RENDER_COST,
  withinRenderCost,
  type PlanNoteType,
} from '#lib/server/domain/core/card-plan.js';
import {
  parseTemplate,
  RenderLimitError,
  renderTemplate,
  type TemplateNode,
} from '#lib/server/domain/core/template.js';

// Render cost limits (CWE-400, CWE-405) and prototype-free field maps (CWE-1321).

function ast(source: string): TemplateNode[] {
  const parsed = parseTemplate(source);
  if (!parsed.ok) {
    throw new Error(parsed.error);
  }
  return parsed.ast;
}

function clozeType(refs: number, templates: number): PlanNoteType {
  const tpl = '{{cloze:T}}'.repeat(refs);
  return {
    fields: ['T'],
    templates: Array.from({ length: templates }, (_, i) => ({
      id: `t${i}`,
      ordinal: i,
      frontTpl: tpl,
      backTpl: tpl,
    })),
  };
}

const clozes = (n: number): string =>
  Array.from({ length: n }, (_, i) => `{{c${(i % 999) + 1}::a}}`).join('');

describe('renderTemplate budget', () => {
  it('renders as before without a budget', () => {
    expect(renderTemplate(ast('{{F}}{{F}}'), { F: 'ab' }, { side: 'front', clozeIndex: 0 })).toBe(
      'abab',
    );
  });

  it('throws RenderLimitError when the output passes the budget', () => {
    const ctx = { side: 'front' as const, clozeIndex: 0, budget: { left: 10 } };
    expect(() => renderTemplate(ast('{{F}}{{F}}'), { F: 'abcdef' }, ctx)).toThrow(RenderLimitError);
  });

  it('charges the parsed cloze text before it parses it', () => {
    const ctx = { side: 'front' as const, clozeIndex: 1, budget: { left: 5 } };
    expect(() => renderTemplate(ast('{{cloze:T}}'), { T: clozes(10) }, ctx)).toThrow(
      RenderLimitError,
    );
  });
});

describe('withinRenderCost', () => {
  it('accepts a normal cloze note with 999 cards', () => {
    const nt = clozeType(1, 1);
    expect(withinRenderCost(nt, fieldsByName(nt, [clozes(999)]), [])).toBe(true);
  });

  it('refuses many references times many cloze cards, and returns quickly', () => {
    const nt = clozeType(900, 20);
    expect(withinRenderCost(nt, fieldsByName(nt, [clozes(6000)]), [])).toBe(false);
  });

  it('counts the stored cards that the plan does not want', () => {
    const nt = clozeType(1, 1);
    const fields = fieldsByName(nt, ['x'.repeat(1000)]);
    const stored = Array.from({ length: 50 }, (_, i) => ({ templateId: 't0', ordinal: i + 1 }));
    expect(withinRenderCost(nt, fields, stored, 1_000_000)).toBe(true);
    expect(withinRenderCost(nt, fields, stored, 50_000)).toBe(false);
  });

  it('has a limit that stays below the V8 string length limit', () => {
    expect(MAX_NOTE_RENDER_COST).toBeLessThan(2 ** 29 - 24);
  });
});

describe('fieldsByName', () => {
  it('has no prototype, so Object.prototype keys read as own values', () => {
    const fields = fieldsByName({ fields: ['__proto__', 'toString'] }, ['a', 'b']);
    expect(Object.getPrototypeOf(fields)).toBeNull();
    expect(fields['__proto__']).toBe('a');
    expect(fields['toString']).toBe('b');
    expect(fields['constructor']).toBeUndefined();
  });
});
