const CONTROL_CHARS = /\p{Cc}/u;

export function isShortText(value: string): boolean {
  return value.length >= 1 && value.length <= 64 && !CONTROL_CHARS.test(value);
}
