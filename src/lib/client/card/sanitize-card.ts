// Contract: sanitize rendered card HTML before display (CWE-79).
// Input: one string. Output: at most 200000 characters.
// Allowed marks are the exact strings <span class="cloze">, </span>, <br>, and <hr>.
// {{media: plus 64 lower-case hex digits plus }} becomes an img.
// Every other <, >, and & is escaped. A </span> with no open span is escaped.
// An output longer than 200000 characters is escaped text cut at that limit.
// The scan is one left-to-right pass. It does not use a regex (CWE-1333). No I/O.

const MAX_HTML = 200_000;
const MEDIA_MARK = '{{media:';
const CLOZE_OPEN = '<span class="cloze">';
const CLOZE_CLOSE = '</span>';

function escapeChar(ch: string): string {
  if (ch === '&') {
    return '&amp;';
  }
  if (ch === '<') {
    return '&lt;';
  }
  if (ch === '>') {
    return '&gt;';
  }
  return ch;
}

// Escapes from the start and stops at the character limit. A cut may split an entity.
function escapePrefix(input: string): string {
  let out = '';
  for (let index = 0; index < input.length && out.length < MAX_HTML; index += 1) {
    out += escapeChar(input.charAt(index));
    if (out.length > MAX_HTML) {
      return out.slice(0, MAX_HTML);
    }
  }
  return out;
}

function isLowerHex(text: string, start: number): boolean {
  for (let index = start; index < start + 64; index += 1) {
    const code = text.charCodeAt(index);
    const digit = code >= 48 && code <= 57;
    const lower = code >= 97 && code <= 102;
    if (!digit && !lower) {
      return false;
    }
  }
  return true;
}

function mediaHex(text: string, at: number): string | null {
  if (!text.startsWith(MEDIA_MARK, at) || at + MEDIA_MARK.length + 66 > text.length) {
    return null;
  }
  const start = at + MEDIA_MARK.length;
  if (!isLowerHex(text, start)) {
    return null;
  }
  if (text.charAt(start + 64) !== '}' || text.charAt(start + 65) !== '}') {
    return null;
  }
  return text.slice(start, start + 64);
}

type Step = { text: string; size: number; open: number };

function closeSpan(open: number): Step {
  if (open > 0) {
    return { text: CLOZE_CLOSE, size: CLOZE_CLOSE.length, open: open - 1 };
  }
  return { text: '&lt;/span&gt;', size: CLOZE_CLOSE.length, open };
}

function takeMark(text: string, at: number, open: number): Step | null {
  if (text.startsWith(CLOZE_OPEN, at)) {
    return { text: CLOZE_OPEN, size: CLOZE_OPEN.length, open: open + 1 };
  }
  if (text.startsWith(CLOZE_CLOSE, at)) {
    return closeSpan(open);
  }
  if (text.startsWith('<br>', at) || text.startsWith('<hr>', at)) {
    return { text: text.slice(at, at + 4), size: 4, open };
  }
  const hex = mediaHex(text, at);
  if (hex === null) {
    return null;
  }
  return {
    text: `<img src="/api/media/${hex}" alt="">`,
    size: MEDIA_MARK.length + 66,
    open,
  };
}

function scan(input: string): string {
  let out = '';
  let open = 0;
  let index = 0;
  while (index < input.length) {
    const mark = takeMark(input, index, open);
    const next = mark ?? { text: escapeChar(input.charAt(index)), size: 1, open };
    out += next.text;
    open = next.open;
    index += next.size;
    if (out.length > MAX_HTML) {
      return escapePrefix(input);
    }
  }
  return out;
}

export function sanitizeCardHtml(input: string): string {
  if (input.length > MAX_HTML) {
    return escapePrefix(input);
  }
  return scan(input);
}
