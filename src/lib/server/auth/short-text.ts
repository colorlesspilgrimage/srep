// Control characters are the Unicode category Cc: U+0000 to U+001F and U+007F to U+009F.
const CONTROL_CHARS = /\p{Cc}/u;

// True for 1 to 64 characters with no control characters. Used for nicknames and RP names.
export function isShortText(value: string): boolean {
  return value.length >= 1 && value.length <= 64 && !CONTROL_CHARS.test(value);
}
