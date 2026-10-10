// Control characters are code points 0 to 31 and 127.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

// Returns the trimmed nickname, or null when it is not valid.
export function normalizeNickname(input: string): string | null {
  const nickname = input.trim();
  if (nickname.length < 1 || nickname.length > 64 || CONTROL_CHARS.test(nickname)) {
    return null;
  }
  return nickname;
}
