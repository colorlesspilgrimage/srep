// Contract: cloze helpers. A bad index, selection, or surrogate split returns null (CWE-176).
// Text above 50000 characters is refused (CWE-400). The result index is at most 999.
// The first }} ends a cloze. A nested {{cM:: inside that cloze is not a second cloze.

const MAX_CLOZE_INDEX = 999;
const MAX_CLOZE_TEXT = 50_000;

function integerInRange(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}

function cutsSurrogate(text: string, index: number): boolean {
  if (index <= 0 || index >= text.length) {
    return false;
  }
  const prev = text.charCodeAt(index - 1);
  const next = text.charCodeAt(index);
  return prev >= 0xd800 && prev <= 0xdbff && next >= 0xdc00 && next <= 0xdfff;
}

export function wrapCloze(text: string, start: number, end: number, index: number): string | null {
  if (text.length > MAX_CLOZE_TEXT) {
    return null;
  }
  if (!integerInRange(index, 1, MAX_CLOZE_INDEX)) {
    return null;
  }
  if (!Number.isInteger(start) || !Number.isInteger(end)) {
    return null;
  }
  if (start < 0 || end < start || end > text.length) {
    return null;
  }
  if (cutsSurrogate(text, start) || cutsSurrogate(text, end)) {
    return null;
  }
  const body = text.slice(start, end);
  const next = `${text.slice(0, start)}{{c${index}::${body}}}${text.slice(end)}`;
  if (next.length > MAX_CLOZE_TEXT) {
    return null;
  }
  return next;
}

function readDigits(text: string, from: number): number {
  let end = from;
  while (end < text.length && text.charCodeAt(end) >= 48 && text.charCodeAt(end) <= 57) {
    end += 1;
  }
  return end;
}

function clozeAt(text: string, start: number): { index: number; end: number } | null {
  if (!text.startsWith('{{c', start)) {
    return null;
  }
  const digitsEnd = readDigits(text, start + 3);
  if (digitsEnd === start + 3 || !text.startsWith('::', digitsEnd)) {
    return null;
  }
  const index = Number(text.slice(start + 3, digitsEnd));
  if (!integerInRange(index, 1, MAX_CLOZE_INDEX)) {
    return null;
  }
  const close = text.indexOf('}}', digitsEnd + 2);
  if (close === -1) {
    return null;
  }
  return { index, end: close + 2 };
}

export function nextClozeIndex(text: string): number {
  if (text.length > MAX_CLOZE_TEXT) {
    return 1;
  }
  let highest = 0;
  let at = 0;
  while (at < text.length) {
    const start = text.indexOf('{{c', at);
    if (start === -1) {
      break;
    }
    const found = clozeAt(text, start);
    if (found === null) {
      at = start + 1;
      continue;
    }
    if (found.index > highest) {
      highest = found.index;
    }
    at = found.end;
  }
  const next = highest + 1;
  return next > MAX_CLOZE_INDEX ? MAX_CLOZE_INDEX : next;
}
