export const MAX_TAG_LENGTH = 100;
export const MAX_TAGS = 100;
const BAD_TAG_CHAR = /[\s\p{Cc}]/u;

export function normalizeTags(input: string[]): string[] | null {
  const tags = new Set<string>();
  for (const raw of input) {
    const tag = raw.trim().normalize('NFC').toLowerCase();
    if (tag.length < 1 || tag.length > MAX_TAG_LENGTH || BAD_TAG_CHAR.test(tag)) {
      return null;
    }
    tags.add(tag);
  }
  if (tags.size > MAX_TAGS) {
    return null;
  }
  return [...tags].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
