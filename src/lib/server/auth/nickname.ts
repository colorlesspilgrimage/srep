// Control characters are the Unicode category Cc: U+0000 to U+001F and U+007F to U+009F.
const CONTROL_CHARS = /\p{Cc}/u;

// Returns the trimmed nickname, or null when it is not valid.
export function normalizeNickname(input: string): string | null {
  const nickname = input.trim();
  if (nickname.length < 1 || nickname.length > 64 || CONTROL_CHARS.test(nickname)) {
    return null;
  }
  return nickname;
}
