// Contract: code-unit order and note tag lists. Pure. No I/O.

export function compareCodeUnit(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function groupNoteTags(
  ids: readonly string[],
  rows: readonly { noteId: string; tag: string }[],
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const id of ids) map.set(id, []);
  for (const row of rows) {
    const list = map.get(row.noteId);
    if (list !== undefined) list.push(row.tag);
  }
  return map;
}
