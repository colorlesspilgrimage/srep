import { blankToUnset, type Env } from '#lib/server/env.js';

export type AuthConfig = {
  origin: string;
  rpId: string;
  rpName: string;
  secureCookies: boolean;
};

export type RpConfigResult = { value: AuthConfig } | { errors: string[] };

const DEFAULT_ORIGIN = 'http://localhost:3000';
const DEFAULT_RP_NAME = 'srep';
// Control characters are the Unicode category Cc: U+0000 to U+001F and U+007F to U+009F.
const CONTROL_CHARS = /\p{Cc}/u;

function isIpHost(hostname: string): boolean {
  if (hostname.startsWith('[')) {
    return true;
  }
  return /^\d+(\.\d+){3}$/.test(hostname);
}

function parseOrigin(raw: string): { url: URL } | { error: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { error: 'SREP_ORIGIN: must be a valid URL' };
  }
  const isLocalHttp = url.protocol === 'http:' && url.hostname === 'localhost';
  if (url.protocol !== 'https:' && !isLocalHttp) {
    return { error: 'SREP_ORIGIN: must use https, or http on localhost' };
  }
  const hasExtra =
    (url.pathname !== '/' && url.pathname !== '') ||
    url.search !== '' ||
    url.hash !== '' ||
    url.username !== '' ||
    url.password !== '';
  if (hasExtra) {
    return { error: 'SREP_ORIGIN: must be an origin without path, query or credentials' };
  }
  if (isIpHost(url.hostname)) {
    return { error: 'SREP_ORIGIN: host must be a domain name, not an IP address' };
  }
  return { url };
}

function parseRpId(raw: string | undefined, host: string): { rpId: string } | { error: string } {
  if (raw === undefined) {
    return { rpId: host };
  }
  const mismatch = `SREP_RP_ID: "${raw}" does not match SREP_ORIGIN host "${host}". The RP ID must equal the host or be a parent domain.`;
  const rpId = raw;
  if (rpId !== rpId.toLowerCase() || /[/:?#@\s]/.test(rpId)) {
    return { error: mismatch };
  }
  if (host !== rpId && !host.endsWith(`.${rpId}`)) {
    return { error: mismatch };
  }
  if (!rpId.includes('.') && rpId !== 'localhost') {
    return { error: `SREP_RP_ID: "${rpId}" must contain a dot, or be localhost` };
  }
  return { rpId };
}

function parseRpName(raw: string | undefined): { rpName: string } | { error: string } {
  const rpName = (raw ?? DEFAULT_RP_NAME).trim();
  if (rpName.length < 1 || rpName.length > 64 || CONTROL_CHARS.test(rpName)) {
    return { error: 'SREP_RP_NAME: must be 1 to 64 characters without control characters' };
  }
  return { rpName };
}

export function parseRpConfig(env: Env): RpConfigResult {
  const errors: string[] = [];
  const originResult = parseOrigin(blankToUnset(env.SREP_ORIGIN) ?? DEFAULT_ORIGIN);
  const nameResult = parseRpName(blankToUnset(env.SREP_RP_NAME));
  if ('error' in nameResult) {
    errors.push(nameResult.error);
  }
  if ('error' in originResult) {
    errors.push(originResult.error);
    return { errors };
  }
  const { url } = originResult;
  const idResult = parseRpId(blankToUnset(env.SREP_RP_ID), url.hostname);
  if ('error' in idResult) {
    errors.push(idResult.error);
  }
  if ('error' in idResult || 'error' in nameResult) {
    return { errors };
  }
  return {
    value: {
      origin: url.origin,
      rpId: idResult.rpId,
      rpName: nameResult.rpName,
      secureCookies: url.protocol === 'https:',
    },
  };
}
