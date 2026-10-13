import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Contract: the settings pane status uses its visible text as its name.

const source = readFileSync(path.join(import.meta.dirname, 'SettingsPane.svelte'), 'utf8');

describe('settings pane accessibility', () => {
  it('gives the status its visible text as the accessible name', () => {
    expect(source).toContain('<p role="status">{statusText}</p>');
    expect(source).not.toContain('aria-label');
    expect(source).toContain('>Save theme</button>');
    expect(source).toContain('type="button"');
    expect(source).not.toContain('style' + '=');
    expect(source).not.toContain('{@' + 'html');
  });
});
