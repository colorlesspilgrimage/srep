// Contract: format a wait time for the study screen.
// The locale is en-US. A non-finite number returns an empty string.
// A time outside the Date range returns an empty string.
// A bad time zone returns an empty string.
// timeZone is optional so a test can pin the zone. The screen omits it.
// No I/O.

const MAX_DATE_MS = 8_640_000_000_000_000;

const UNTIL_OPTIONS: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
};

export function formatUntil(ms: number, timeZone?: string): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) {
    return '';
  }
  if (ms > MAX_DATE_MS || ms < -MAX_DATE_MS) {
    return '';
  }
  try {
    const options: Intl.DateTimeFormatOptions = { ...UNTIL_OPTIONS };
    if (timeZone !== undefined) {
      options.timeZone = timeZone;
    }
    return new Intl.DateTimeFormat('en-US', options).format(new Date(ms));
  } catch {
    return '';
  }
}
