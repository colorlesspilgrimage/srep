import crypto from 'node:crypto';

export type RandomBytes = (size: number) => Buffer;

export function randomToken(bytes = 32, random: RandomBytes = crypto.randomBytes): string {
  return random(bytes).toString('base64url');
}

function sha256(value: string): Buffer {
  return crypto.createHash('sha256').update(value).digest();
}

export function sha256Hex(value: string): string {
  return sha256(value).toString('hex');
}

// Both inputs are hashed first, so the compared buffers always have equal length.
export function safeEqual(a: string, b: string): boolean {
  const left = sha256(a);
  const right = sha256(b);
  return crypto.timingSafeEqual(left, right);
}

// The session cookie is HttpOnly. The server gives this token to the page.
export function csrfTokenFor(rawSessionToken: string): string {
  return sha256(`srep-csrf:${rawSessionToken}`).toString('base64url');
}
