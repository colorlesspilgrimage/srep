import { renderCloze } from '#lib/server/domain/core/cloze.js';
import { isBlank } from '#lib/server/domain/core/text.js';

// Template syntax: {{Field}}, {{#Field}}...{{/Field}} and {{cloze:Field}}.
// Every other `{{` stays literal text. One hand-written scan, linear time (CWE-1333).
// The output is not escaped or sanitized. The caller must sanitize it before display.

export type TemplateNode =
  | { kind: 'text'; text: string }
  | { kind: 'field'; name: string }
  | { kind: 'cloze'; name: string }
  | { kind: 'block'; name: string; children: TemplateNode[] };

export type ParsedTemplate =
  { ok: true; ast: TemplateNode[] } | { ok: false; error: 'invalid_template' };

export const MAX_BLOCK_DEPTH = 10;
export const MAX_FIELD_NAME = 50;
// A tag body longer than this cannot be valid. The limit keeps the scan linear.
const MAX_TAG_BODY = MAX_FIELD_NAME + 'cloze:'.length + 64;
const FORBIDDEN_IN_NAME = /[{}#/^:\p{Cc}]/u;

export function isValidFieldName(name: string): boolean {
  return (
    name.length >= 1 &&
    name.length <= MAX_FIELD_NAME &&
    name === name.trim() &&
    !FORBIDDEN_IN_NAME.test(name)
  );
}

type Tag = { kind: 'field' | 'cloze' | 'open' | 'close'; name: string };

function readTag(body: string): Tag | null {
  let kind: Tag['kind'] = 'field';
  let rest = body;
  if (body.startsWith('#')) {
    kind = 'open';
    rest = body.slice(1);
  } else if (body.startsWith('/')) {
    kind = 'close';
    rest = body.slice(1);
  } else if (body.startsWith('cloze:')) {
    kind = 'cloze';
    rest = body.slice('cloze:'.length);
  }
  const name = rest.trim();
  return isValidFieldName(name) ? { kind, name } : null;
}

type Frame = { name: string; children: TemplateNode[] };

// Adds a tag to the tree. Returns false when the tag breaks the block structure.
function applyTag(stack: Frame[], tag: Tag): boolean {
  const top = stack[stack.length - 1] as Frame;
  if (tag.kind === 'field' || tag.kind === 'cloze') {
    top.children.push({ kind: tag.kind, name: tag.name });
    return true;
  }
  if (tag.kind === 'open') {
    if (stack.length > MAX_BLOCK_DEPTH) {
      return false;
    }
    const children: TemplateNode[] = [];
    top.children.push({ kind: 'block', name: tag.name, children });
    stack.push({ name: tag.name, children });
    return true;
  }
  if (stack.length === 1 || top.name !== tag.name) {
    return false;
  }
  stack.pop();
  return true;
}

function pushText(frame: Frame, text: string): void {
  if (text.length > 0) {
    frame.children.push({ kind: 'text', text });
  }
}

export function parseTemplate(source: string): ParsedTemplate {
  const stack: Frame[] = [{ name: '', children: [] }];
  let cursor = 0;
  let scan = 0;
  let close = -1;
  for (;;) {
    const start = source.indexOf('{{', scan);
    if (start === -1) {
      break;
    }
    if (close < start + 2) {
      close = source.indexOf('}}', start + 2);
    }
    if (close === -1) {
      break;
    }
    const tag = close - start - 2 <= MAX_TAG_BODY ? readTag(source.slice(start + 2, close)) : null;
    if (tag === null) {
      scan = start + 1;
      continue;
    }
    pushText(stack[stack.length - 1] as Frame, source.slice(cursor, start));
    if (!applyTag(stack, tag)) {
      return { ok: false, error: 'invalid_template' };
    }
    cursor = scan = close + 2;
  }
  if (stack.length !== 1) {
    return { ok: false, error: 'invalid_template' };
  }
  const root = stack[0] as Frame;
  pushText(root, source.slice(cursor));
  return { ok: true, ast: root.children };
}

// All field names that the template uses, also inside blocks.
export function templateFields(ast: TemplateNode[]): { plain: Set<string>; cloze: Set<string> } {
  const plain = new Set<string>();
  const cloze = new Set<string>();
  const pending = [...ast];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if (node.kind === 'field' || node.kind === 'block') {
      plain.add(node.name);
    }
    if (node.kind === 'cloze') {
      cloze.add(node.name);
    }
    if (node.kind === 'block') {
      pending.push(...node.children);
    }
  }
  return { plain, cloze };
}

export function isClozeTemplate(frontAst: TemplateNode[]): boolean {
  return templateFields(frontAst).cloze.size > 0;
}

// The budget counts the work of a render: nodes, field text read and text written.
// A template can name one field many times, so the output can be much larger than
// the input (CWE-400, CWE-405). The caller sets the budget and catches the error.
export type RenderBudget = { left: number };

export class RenderLimitError extends Error {
  constructor() {
    super('render budget exhausted');
    this.name = 'RenderLimitError';
  }
}

export function chargeRender(budget: RenderBudget | undefined, cost: number): void {
  if (budget === undefined) {
    return;
  }
  budget.left -= cost;
  if (budget.left < 0) {
    throw new RenderLimitError();
  }
}

export type RenderContext = { side: 'front' | 'back'; clozeIndex: number; budget?: RenderBudget };

// One pass. A field value that contains `{{...}}` is not expanded again.
// The depth of the recursion is at most MAX_BLOCK_DEPTH (CWE-674).
export function renderTemplate(
  ast: TemplateNode[],
  fields: Record<string, string>,
  ctx: RenderContext,
): string {
  let out = '';
  for (const node of ast) {
    const value = node.kind === 'text' ? node.text : (fields[node.name] ?? '');
    chargeRender(ctx.budget, 1 + value.length);
    if (node.kind === 'text' || node.kind === 'field') {
      out += value;
    } else if (node.kind === 'cloze') {
      const rendered = renderCloze(value, ctx.clozeIndex, ctx.side);
      chargeRender(ctx.budget, rendered.length);
      out += rendered;
    } else if (!isBlank(value)) {
      out += renderTemplate(node.children, fields, ctx);
    }
  }
  return out;
}
