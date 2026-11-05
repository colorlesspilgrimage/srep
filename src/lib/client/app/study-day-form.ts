// Contract: pure study-day form values. No I/O.
// A bad hour or timezone does not become a request body (CWE-20).

export type StudyDaySettings = { rolloverHour: number; timezone: string };

const TIMEZONE_PATTERN = /^[A-Za-z0-9_/+-]{1,64}$/;

export function isClientTimezone(name: string): boolean {
  if (!TIMEZONE_PATTERN.test(name)) {
    return false;
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

export function parseRolloverHour(raw: string): number | null {
  if (!/^\d{1,2}$/.test(raw)) {
    return null;
  }
  const hour = Number(raw);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    return null;
  }
  return hour;
}

export function acceptStudyDay(input: {
  timezone: string;
  rolloverText: string;
}): { ok: true; settings: StudyDaySettings } | { ok: false; error: string } {
  const timezone = input.timezone.trim();
  if (!isClientTimezone(timezone)) {
    return { ok: false, error: 'Enter a valid timezone.' };
  }
  const rolloverHour = parseRolloverHour(input.rolloverText.trim());
  if (rolloverHour === null) {
    return { ok: false, error: 'Rollover hour must be 0 to 23.' };
  }
  return { ok: true, settings: { timezone, rolloverHour } };
}

export function parseStudySettings(body: unknown): StudyDaySettings | null {
  if (typeof body !== 'object' || body === null || !('settings' in body)) {
    return null;
  }
  const settings = body.settings;
  if (typeof settings !== 'object' || settings === null) {
    return null;
  }
  if (!('rolloverHour' in settings) || !('timezone' in settings)) {
    return null;
  }
  if (typeof settings.rolloverHour !== 'number' || typeof settings.timezone !== 'string') {
    return null;
  }
  if (
    !Number.isInteger(settings.rolloverHour) ||
    settings.rolloverHour < 0 ||
    settings.rolloverHour > 23
  ) {
    return null;
  }
  if (!isClientTimezone(settings.timezone)) {
    return null;
  }
  return { rolloverHour: settings.rolloverHour, timezone: settings.timezone };
}
