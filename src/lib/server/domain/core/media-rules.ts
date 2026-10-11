// Media rules. Only the listed binary formats are allowed. SVG, HTML and all
// other types are refused, because they can carry active content (CWE-434, CWE-79).

export const ALLOWED_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'audio/wav',
  'audio/ogg',
  'audio/mpeg',
  'audio/mp4',
] as const;

export type AllowedMime = (typeof ALLOWED_MIME_TYPES)[number];

const SHA256_HEX = /^[0-9a-f]{64}$/;
const MAX_ORIGINAL_NAME = 255;

function startsWith(bytes: Uint8Array, prefix: number[], offset = 0): boolean {
  if (bytes.length < offset + prefix.length) {
    return false;
  }
  return prefix.every((value, i) => bytes[offset + i] === value);
}

const ascii = (text: string): number[] => Array.from(text, (c) => c.charCodeAt(0));

function sniffRiff(bytes: Uint8Array): AllowedMime | null {
  if (!startsWith(bytes, ascii('RIFF'))) {
    return null;
  }
  if (startsWith(bytes, ascii('WEBP'), 8)) {
    return 'image/webp';
  }
  return startsWith(bytes, ascii('WAVE'), 8) ? 'audio/wav' : null;
}

// Finds the type from the magic bytes. Returns null for a type that is not allowed.
export function sniffMime(bytes: Uint8Array): AllowedMime | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return 'image/png';
  }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return 'image/jpeg';
  }
  if (startsWith(bytes, ascii('GIF87a')) || startsWith(bytes, ascii('GIF89a'))) {
    return 'image/gif';
  }
  const riff = sniffRiff(bytes);
  if (riff !== null) {
    return riff;
  }
  if (startsWith(bytes, ascii('OggS'))) {
    return 'audio/ogg';
  }
  const first = bytes[0];
  const second = bytes[1];
  if (
    startsWith(bytes, ascii('ID3')) ||
    (first === 0xff && second !== undefined && (second & 0xe0) === 0xe0)
  ) {
    return 'audio/mpeg';
  }
  return startsWith(bytes, ascii('ftyp'), 4) ? 'audio/mp4' : null;
}

// Lower case, without parameters such as `; charset=x`.
export function normalizeDeclaredMime(header: string): string {
  const semicolon = header.indexOf(';');
  return (semicolon === -1 ? header : header.slice(0, semicolon)).trim().toLowerCase();
}

// The name is metadata only. It is never used to build a path or a header.
export function sanitizeOriginalName(name: string): string {
  const cleaned = Array.from(name.normalize('NFC'), (c) => (/[\p{Cc}/\\]/u.test(c) ? '_' : c)).join(
    '',
  );
  const cut = Array.from(cleaned.trim()).slice(0, MAX_ORIGINAL_NAME).join('').trim();
  return cut.length === 0 ? 'file' : cut;
}

// The hash comes from the server. Check it before it goes into a path (CWE-22).
export function isSha256Hex(value: string): boolean {
  return SHA256_HEX.test(value);
}

function isLowerHex(code: number): boolean {
  return (code >= 48 && code <= 57) || (code >= 97 && code <= 102);
}

// Finds `{{media:<64 lower-case hex>}}` tokens with one linear scan.
// A malformed token is literal text.
export function findMediaTokens(text: string): string[] {
  const found: string[] = [];
  const marker = '{{media:';
  for (let at = text.indexOf(marker); at !== -1; at = text.indexOf(marker, at + 1)) {
    const start = at + marker.length;
    let end = start;
    while (end < text.length && end - start < 64 && isLowerHex(text.charCodeAt(end))) {
      end += 1;
    }
    if (end - start === 64 && text.startsWith('}}', end)) {
      found.push(text.slice(start, end));
    }
  }
  return found;
}
