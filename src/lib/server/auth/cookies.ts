export type CookieOptions = {
  path: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'strict';
  maxAge: number;
};

// The __Host- prefix needs Secure, Path=/ and no Domain.
export function sessionCookieName(secure: boolean): string {
  return secure ? '__Host-srep_session' : 'srep_session';
}

export function sessionCookieOptions(secure: boolean, maxAgeSec: number): CookieOptions {
  return { path: '/', httpOnly: true, secure, sameSite: 'strict', maxAge: maxAgeSec };
}

// Header text for a cookie that the browser must drop. The text is fixed (CWE-113).
export function clearCookieHeader(secure: boolean): string {
  const attrs = ['Path=/', 'Max-Age=0', 'HttpOnly', 'SameSite=Strict'];
  if (secure) {
    attrs.push('Secure');
  }
  return `${sessionCookieName(secure)}=; ${attrs.join('; ')}`;
}
