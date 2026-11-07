import { describe, expect, it } from 'vitest';
import {
  acceptStudyDay,
  isClientTimezone,
  parseRolloverHour,
  parseStudySettings,
} from './study-day-form.js';

describe('study-day-form', () => {
  it('accepts a valid timezone and hour', () => {
    expect(acceptStudyDay({ timezone: ' Europe/Berlin ', rolloverText: '4' })).toEqual({
      ok: true,
      settings: { timezone: 'Europe/Berlin', rolloverHour: 4 },
    });
    expect(parseRolloverHour('0')).toBe(0);
    expect(parseRolloverHour('23')).toBe(23);
    expect(isClientTimezone('UTC')).toBe(true);
  });

  it('rejects a bad hour or timezone', () => {
    expect(acceptStudyDay({ timezone: 'UTC', rolloverText: '24' })).toEqual({
      ok: false,
      error: 'Rollover hour must be 0 to 23.',
    });
    expect(acceptStudyDay({ timezone: 'UTC', rolloverText: '3.5' })).toEqual({
      ok: false,
      error: 'Rollover hour must be 0 to 23.',
    });
    expect(acceptStudyDay({ timezone: 'Mars/Base', rolloverText: '4' })).toEqual({
      ok: false,
      error: 'Enter a valid timezone.',
    });
    expect(acceptStudyDay({ timezone: '../etc', rolloverText: '4' })).toEqual({
      ok: false,
      error: 'Enter a valid timezone.',
    });
    expect(parseRolloverHour('-1')).toBeNull();
    expect(parseRolloverHour('')).toBeNull();
    expect(isClientTimezone('Mars/Base')).toBe(false);
  });

  it('parses a study settings reply', () => {
    expect(parseStudySettings({ settings: { rolloverHour: 4, timezone: 'UTC' } })).toEqual({
      rolloverHour: 4,
      timezone: 'UTC',
    });
    expect(parseStudySettings(null)).toBeNull();
    expect(parseStudySettings({ settings: { rolloverHour: 99, timezone: 'UTC' } })).toBeNull();
    expect(parseStudySettings({ settings: { rolloverHour: 4, timezone: 'Mars/Base' } })).toBeNull();
  });
});
