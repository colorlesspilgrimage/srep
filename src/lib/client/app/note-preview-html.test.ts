import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sanitizeCardHtml } from '#lib/client/card/sanitize-card.js';
import { parsePreview } from './note-editor-parse.js';

// Contract: preview text is sanitized before display.
// The editor files do not assign raw HTML. CardHtml is the only site.

describe('preview HTML', () => {
  it('escapes a script in preview output and does not use a raw html tag', () => {
    const parsed = parsePreview({
      cards: [
        {
          templateName: 'Card 1',
          ordinal: 0,
          front: '<script>alert(1)</script>',
          back: '<img src=x onerror=alert(1)>',
        },
      ],
    });
    expect(parsed).not.toBeNull();
    if (parsed === null) {
      return;
    }
    const front = sanitizeCardHtml(parsed[0]?.front ?? '');
    const back = sanitizeCardHtml(parsed[0]?.back ?? '');
    expect(front.includes('<script')).toBe(false);
    expect(back.includes('<img')).toBe(false);
    expect(front).toContain('&lt;script&gt;');
    expect(back).toContain('&lt;img');
    for (const name of ['NotePreview.svelte', 'NoteEditor.svelte', 'NoteEditorForm.svelte']) {
      const text = readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');
      expect(text.includes('{@html')).toBe(false);
    }
    const preview = readFileSync(new URL('./NotePreview.svelte', import.meta.url), 'utf8');
    expect(preview).toContain('CardHtml');
    expect(preview).toContain('aria-live="polite"');
  });
});
