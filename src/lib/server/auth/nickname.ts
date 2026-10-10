import { isShortText } from '#lib/server/auth/short-text.js';

// Returns the trimmed nickname, or null when it is not valid.
export function normalizeNickname(input: string): string | null {
  const nickname = input.trim();
  if (!isShortText(nickname)) {
    return null;
  }
  return nickname;
}
