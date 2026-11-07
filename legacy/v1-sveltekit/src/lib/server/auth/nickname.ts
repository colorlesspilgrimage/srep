import { isShortText } from '#lib/server/auth/short-text.js';

export function normalizeNickname(input: string): string | null {
  const nickname = input.trim();
  if (!isShortText(nickname)) {
    return null;
  }
  return nickname;
}
