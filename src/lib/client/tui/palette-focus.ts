// Contract: Tab cycles inside the command palette.
// Focus does not move to the page behind the dialog (WCAG 2.1.2).

export function nextTrapIndex(count: number, current: number, shiftKey: boolean): number | null {
  if (!Number.isInteger(count) || count < 1) {
    return null;
  }
  const index = Number.isInteger(current) ? current : -1;
  if (shiftKey) {
    if (index <= 0) {
      return count - 1;
    }
    return index - 1;
  }
  if (index < 0 || index >= count - 1) {
    return 0;
  }
  return index + 1;
}
