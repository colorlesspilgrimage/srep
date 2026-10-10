import crypto from 'node:crypto';

export type RandomBytes = (size: number) => Buffer;

export function randomToken(bytes = 32, random: RandomBytes = crypto.randomBytes): string {
  return random(bytes).toString('base64url');
}

export function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

// Both inputs are hashed first, so the compared buffers always have equal length.
export function safeEqual(a: string, b: string): boolean {
  const left = crypto.createHash('sha256').update(a).digest();
  const right = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(left, right);
}

// The session cookie is HttpOnly. The server gives this token to the page.
export function csrfTokenFor(rawSessionToken: string): string {
  return crypto.createHash('sha256').update(`srep-csrf:${rawSessionToken}`).digest('base64url');
}
