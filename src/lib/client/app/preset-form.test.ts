import { describe, expect, it } from 'vitest';
import {
  BLANK_PRESET_DRAFT,
  acceptPreset,
  draftFromPreset,
  parsePresetBody,
  parsePresetsBody,
  presetMessageFor,
} from './preset-form.js';

// Contract: bad preset text does not become a request body.

const valid = {
  ...BLANK_PRESET_DRAFT,
  name: 'Fast',
};

describe('preset-form', () => {
  it('accepts a valid draft', () => {
    expect(acceptPreset(valid)).toEqual({
      ok: true,
      preset: {
        name: 'Fast',
        newPerDay: 20,
        reviewsPerDay: 200,
        desiredRetention: 0.9,
        learningSteps: [1, 10],
        relearningSteps: [10],
        maxInterval: 36_500,
        fsrsParams: null,
        burySiblings: false,
        newOrder: 'added',
      },
    });
  });

  it('rejects bad name, counts, retention, and steps', () => {
    expect(acceptPreset({ ...valid, name: '' })).toEqual({
      ok: false,
      error: 'Enter a preset name (1 to 100 characters).',
    });
    expect(acceptPreset({ ...valid, newPerDayText: '10000' })).toEqual({
      ok: false,
      error: 'New per day must be 0 to 9999.',
    });
    expect(acceptPreset({ ...valid, desiredRetentionText: '0.5' })).toEqual({
      ok: false,
      error: 'Desired retention must be 0.7 to 0.99.',
    });
    expect(acceptPreset({ ...valid, learningStepsText: '0' })).toEqual({
      ok: false,
      error: 'Learning steps must be up to 10 positive minutes.',
    });
    expect(acceptPreset({ ...valid, fsrsParams: [1, 2] })).toEqual({
      ok: false,
      error: 'FSRS params must be empty or 19 to 21 numbers.',
    });
  });

  it('maps API error codes', () => {
    expect(presetMessageFor('builtin_protected')).toBe('The default preset cannot be deleted.');
    expect(presetMessageFor('in_use')).toBe('That preset is in use by a deck.');
    expect(presetMessageFor('name_taken')).toBe('That preset name is already used.');
    expect(presetMessageFor('nope')).toBe('The request failed.');
  });

  it('parses list and single preset replies', () => {
    const accepted = acceptPreset(valid);
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) {
      return;
    }
    const row = { id: '00000000-0000-4000-8000-000000000099', ...accepted.preset };
    expect(parsePresetsBody({ presets: [row] })).toEqual([row]);
    expect(parsePresetBody({ preset: row })).toEqual(row);
    expect(parsePresetsBody(null)).toBeNull();
    expect(draftFromPreset(accepted.preset).name).toBe('Fast');
  });
});
