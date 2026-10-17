// Contract: keys for a note field textarea.
// Alt+C asks the caller to wrap the selection with the next cloze.
// Escape blurs the field when no modifier is held.
// Arrow keys, letters, digits, Space, Enter, Tab, and colon stay with the field.
// Ctrl and Meta chords stay with the browser and the command palette.
// No I/O.

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
