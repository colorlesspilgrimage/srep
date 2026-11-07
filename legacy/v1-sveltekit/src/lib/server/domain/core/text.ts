import { sha256Hex } from '#lib/server/auth/tokens.js';

export { sha256Hex };

export function stripTags(text: string): string {
  let out = '';
  let index = 0;
  while (index < text.length) {
    const open = text.indexOf('<', index);
    if (open === -1) {
      return out + text.slice(index);
    }
    const close = text.indexOf('>', open + 1);
    if (close === -1) {
      return out + text.slice(index);
    }
    out += text.slice(index, open);
    index = close + 1;
  }
  return out;
}

export function isBlank(text: string): boolean {
  return stripTags(text).replaceAll('&nbsp;', ' ').trim().length === 0;
}

export function fieldChecksum(field: string): string {
  return sha256Hex(stripTags(field).trim());
}
