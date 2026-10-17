// Contract: LIKE pattern helpers. Pure. No I/O.
// escapeLike makes `\`, `%`, and `_` literal when the SQL clause is ESCAPE '\'.
// asciiLower folds A to Z only. It is not a Unicode case fold.
// SQLite lower() folds those same letters. The two sides stay in agreement.

export function escapeLike(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
}

export function asciiLower(value: string): string {
  return value.replace(/[A-Z]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 32));
}
