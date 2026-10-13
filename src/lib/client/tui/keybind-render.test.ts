import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Contract: chord text is a text node. The palette does not inject HTML (CWE-79).

const FILES = ['CommandPalette.svelte', 'KeymapForm.svelte', 'GalleryShell.svelte'];

describe('keybind render safety', () => {
  it('does not use raw HTML or an inline style', () => {
    for (const name of FILES) {
      const source = readFileSync(path.join(import.meta.dirname, name), 'utf8');
      expect(source).not.toContain('{@' + 'html');
      expect(source).not.toContain('style' + '=');
    }
  });

  it('the palette traps Tab on the window', () => {
    const source = readFileSync(path.join(import.meta.dirname, 'CommandPalette.svelte'), 'utf8');
    expect(source).toContain('nextTrapIndex');
    expect(source).toContain("event.key === 'Tab'");
    expect(source).toContain("window.addEventListener('keydown', onKey, true)");
  });
});
