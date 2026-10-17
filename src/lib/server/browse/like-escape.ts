// Contract: LIKE pattern helpers. Pure. No I/O.
// escapeLike makes `\`, `%`, and `_` literal under ESCAPE '\'.
// asciiLower folds A to Z only, so it matches SQLite lower(). It is not a Unicode fold.

export function escapeLike(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
}

export function asciiLower(value: string): string {
  return value.replace(/[A-Z]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 32));
}
