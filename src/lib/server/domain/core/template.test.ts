import { describe, expect, it } from 'vitest';
import {
  isClozeTemplate,
  isValidFieldName,
  parseTemplate,
  renderTemplate,
  templateFields,
  type RenderContext,
  type TemplateNode,
} from '#lib/server/domain/core/template.js';

function ast(source: string): TemplateNode[] {
  const parsed = parseTemplate(source);
  if (!parsed.ok) {
    throw new Error(`invalid template: ${source}`);
  }
  return parsed.ast;
}

const front: RenderContext = { side: 'front', clozeIndex: 0 };

function render(source: string, fields: Record<string, string>, ctx = front): string {
  return renderTemplate(ast(source), fields, ctx);
}

describe('parseTemplate and renderTemplate', () => {
  it('replaces a plain field and keeps other text', () => {
    expect(render('Q: {{Front}}!', { Front: 'dog' })).toBe('Q: dog!');
  });

  it('accepts field names with spaces and trims the tag', () => {
    expect(render('{{ My Field }}', { 'My Field': 'x' })).toBe('x');
  });

  it('lists every used field, also in blocks, and finds unknown names', () => {
    const used = templateFields(ast('{{A}}{{#B}}{{C}}{{cloze:D}}{{/B}}'));
    expect([...used.plain].sort()).toEqual(['A', 'B', 'C']);
    expect([...used.cloze]).toEqual(['D']);
    expect(used.plain.has('Missing')).toBe(false);
  });

  it('shows a block for a non-blank field only', () => {
    const tpl = '[{{#Back}}B={{Back}}{{/Back}}]';
    expect(render(tpl, { Back: 'x' })).toBe('[B=x]');
    expect(render(tpl, { Back: '' })).toBe('[]');
    expect(render(tpl, { Back: '<br>' })).toBe('[]');
    expect(render(tpl, { Back: ' &nbsp; <div></div>' })).toBe('[]');
    expect(render(tpl, {})).toBe('[]');
  });

  it('renders nested blocks', () => {
    const tpl = '{{#A}}a{{#B}}b{{/B}}{{/A}}';
    expect(render(tpl, { A: '1', B: '1' })).toBe('ab');
    expect(render(tpl, { A: '1', B: '' })).toBe('a');
    expect(render(tpl, { A: '', B: '1' })).toBe('');
  });

  it('allows depth 10 and refuses depth 11 (CWE-674)', () => {
    const nest = (depth: number) => '{{#A}}'.repeat(depth) + 'x' + '{{/A}}'.repeat(depth);
    expect(parseTemplate(nest(10)).ok).toBe(true);
    expect(parseTemplate(nest(11))).toEqual({ ok: false, error: 'invalid_template' });
  });

  it.each(['{{#A}}x', '{{/A}}', '{{#A}}{{#B}}{{/A}}{{/B}}'])('refuses %s', (source) => {
    expect(parseTemplate(source)).toEqual({ ok: false, error: 'invalid_template' });
  });

  it.each(['{{', 'a {{ b', '{{}}', '{{a:b}}', '{{^A}}', '{{{A}}}', '}} {{'])(
    'keeps %s as literal text where it is not a tag',
    (source) => {
      const parsed = parseTemplate(source);
      expect(parsed.ok).toBe(true);
    },
  );

  it('keeps a lone {{ and still reads a later tag', () => {
    expect(render('{{ {{A}}', { A: 'x' })).toBe('{{ x');
    expect(render('{{{A}}}', { A: 'x' })).toBe('{x}');
  });

  it('renders cloze on the front and the back', () => {
    const fields = { Text: '{{c1::a}} {{c2::b}}' };
    expect(render('{{cloze:Text}}', fields, { side: 'front', clozeIndex: 1 })).toBe(
      '<span class="cloze">[...]</span> b',
    );
    expect(render('{{cloze:Text}}', fields, { side: 'back', clozeIndex: 2 })).toBe(
      'a <span class="cloze">b</span>',
    );
    expect(isClozeTemplate(ast('{{cloze:Text}}'))).toBe(true);
    expect(isClozeTemplate(ast('{{Text}}'))).toBe(false);
  });

  it('does not expand a value again (single pass)', () => {
    expect(render('{{Front}}', { Front: '{{Back}}', Back: 'secret' })).toBe('{{Back}}');
  });

  it('returns for a 100,000 character input (CWE-1333)', () => {
    // The test timeout is the bound. A quadratic scan would not finish in time.
    expect(parseTemplate('{{'.repeat(50_000)).ok).toBe(true);
    expect(parseTemplate('{{'.repeat(50_000) + '}}').ok).toBe(true);
    expect(parseTemplate('{{x'.repeat(33_000) + '}}').ok).toBe(true);
  });
});

describe('isValidFieldName', () => {
  it.each([
    ['Front', true],
    ['My Field', true],
    ['x'.repeat(50), true],
    ['x'.repeat(51), false],
    ['', false],
    [' padded', false],
    ...['{', '}', '#', '/', '^', ':', '\u0000', '\n'].map((c): [string, boolean] => [
      `a${c}b`,
      false,
    ]),
  ])('%j gives %s', (name, valid) => {
    expect(isValidFieldName(name)).toBe(valid);
  });
});
