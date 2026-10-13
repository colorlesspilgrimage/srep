// Contract: form field checks.
// The id parts stay in a safe set so the input id cannot break the label.

export const FORM_VALUE_MAX = 80;

export function formIdsOk(idPrefix: string, name: string): boolean {
  return /^[a-z]{1,16}$/.test(idPrefix) && /^[a-z0-9-]{1,32}$/.test(name);
}

export function acceptFormValue(
  value: string,
): { ok: false; error: string } | { ok: true; value: string } {
  const trimmed = value.trim();
  if (trimmed === '') {
    return { ok: false, error: 'Enter a value.' };
  }
  if (trimmed.length > FORM_VALUE_MAX) {
    return { ok: false, error: `Use at most ${FORM_VALUE_MAX} characters.` };
  }
  return { ok: true, value: trimmed };
}
