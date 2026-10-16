// Contract: format a wait time for the study screen.
// The locale is en-US. A non-finite number returns an empty string.
// timeZone is optional so a test can pin the zone. The screen omits it.
// No I/O.

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
  const options: Intl.DateTimeFormatOptions = { ...UNTIL_OPTIONS };
  if (timeZone !== undefined) {
    options.timeZone = timeZone;
  }
  return new Intl.DateTimeFormat('en-US', options).format(new Date(ms));
}
