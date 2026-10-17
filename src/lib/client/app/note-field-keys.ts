// Contract: field keys. Alt+C asks the caller to wrap the next cloze.
// Escape blurs the field. Ctrl and Meta chords stay with the browser.

export type FieldKeyEffect = { type: 'pass' } | { type: 'blur' } | { type: 'cloze' };

export function fieldKeyEffect(input: {
  key: string;
  code?: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}): FieldKeyEffect {
  if (input.ctrlKey || input.metaKey) {
    return { type: 'pass' };
  }
  const clozeKey = input.key === 'c' || input.key === 'C' || input.code === 'KeyC';
  if (input.altKey && clozeKey) {
    return { type: 'cloze' };
  }
  if (!input.altKey && input.key === 'Escape') {
    return { type: 'blur' };
  }
  return { type: 'pass' };
}
