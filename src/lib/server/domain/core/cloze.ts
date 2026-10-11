// Cloze syntax: {{cN::text}} or {{cN::text::hint}}, with N from 1 to 999.
// The first `}}` ends a cloze. Nesting is not supported.
// The scanner never throws and runs in linear time (CWE-1333).

export type ClozeSegment =
  | { kind: 'text'; text: string }
  | { kind: 'cloze'; index: number; text: string; hint: string | null; source: string };

export const MAX_CLOZE_INDEX = 999;

type Match = { start: number; end: number; segment: ClozeSegment };

function readDigits(text: string, from: number): number {
  let end = from;
  while (end < text.length && text.charCodeAt(end) >= 48 && text.charCodeAt(end) <= 57) {
    end += 1;
  }
  return end;
}

// Finds the next cloze at or after `from`. Returns null when no more cloze exists.
function nextCloze(text: string, from: number): Match | null {
  let at = from;
  for (;;) {
    const start = text.indexOf('{{c', at);
    if (start === -1) {
      return null;
    }
    const digitsEnd = readDigits(text, start + 3);
    const index = Number(text.slice(start + 3, digitsEnd));
    const valid =
      digitsEnd > start + 3 &&
      text.startsWith('::', digitsEnd) &&
      index >= 1 &&
      index <= MAX_CLOZE_INDEX;
    if (!valid) {
      at = start + 1;
      continue;
    }
    const bodyStart = digitsEnd + 2;
    const close = text.indexOf('}}', bodyStart);
    if (close === -1) {
      // Every later candidate starts after this one, so it has no `}}` either.
      return null;
    }
    const body = text.slice(bodyStart, close);
    const split = body.indexOf('::');
    const segment: ClozeSegment = {
      kind: 'cloze',
      index,
      text: split === -1 ? body : body.slice(0, split),
      hint: split === -1 ? null : body.slice(split + 2),
      source: text.slice(start, close + 2),
    };
    return { start, end: close + 2, segment };
  }
}

export function parseCloze(text: string): ClozeSegment[] {
  const segments: ClozeSegment[] = [];
  let cursor = 0;
  for (let match = nextCloze(text, 0); match !== null; match = nextCloze(text, cursor)) {
    if (match.start > cursor) {
      segments.push({ kind: 'text', text: text.slice(cursor, match.start) });
    }
    segments.push(match.segment);
    cursor = match.end;
  }
  if (cursor < text.length) {
    segments.push({ kind: 'text', text: text.slice(cursor) });
  }
  return segments;
}

export function segmentsToSource(segments: ClozeSegment[]): string {
  return segments.map((s) => (s.kind === 'text' ? s.text : s.source)).join('');
}

// Distinct cloze indices in ascending order.
export function clozeIndices(text: string): number[] {
  const found = new Set<number>();
  for (const segment of parseCloze(text)) {
    if (segment.kind === 'cloze') {
      found.add(segment.index);
    }
  }
  return [...found].sort((a, b) => a - b);
}

// Shows the active cloze as a gap (front) or as an answer (back). Other clozes show
// their text. The output is not escaped. The caller must sanitize it before display.
export function renderCloze(text: string, activeIndex: number, side: 'front' | 'back'): string {
  let out = '';
  for (const segment of parseCloze(text)) {
    if (segment.kind === 'text') {
      out += segment.text;
    } else if (segment.index !== activeIndex) {
      out += segment.text;
    } else if (side === 'back') {
      out += `<span class="cloze">${segment.text}</span>`;
    } else {
      out += `<span class="cloze">[${segment.hint ?? '...'}]</span>`;
    }
  }
  return out;
}
