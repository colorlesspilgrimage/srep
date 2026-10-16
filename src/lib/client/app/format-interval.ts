// Contract: format a review interval in minutes for a rate button.
// A non-integer or a negative value returns 0m.
// Under 60 minutes, return Nm. Under 1440, return Nh when the value divides by 60.
// At 1440 and above, return Nd when the value divides by 1440. Otherwise return Nm.
// No I/O.

export function formatInterval(minutes: number): string {
  if (!Number.isInteger(minutes) || minutes < 0) {
    return '0m';
  }
  if (minutes < 60) {
    return `${minutes}m`;
  }
  if (minutes < 1440) {
    return minutes % 60 === 0 ? `${minutes / 60}h` : `${minutes}m`;
  }
  return minutes % 1440 === 0 ? `${minutes / 1440}d` : `${minutes}m`;
}
