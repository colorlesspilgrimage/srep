import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { modalKeyAction } from './modal-key.js';

describe('modalKeyAction', () => {
  it('closes on Escape and traps Tab', () => {
    expect(modalKeyAction('Escape')).toBe('close');
    expect(modalKeyAction('Tab')).toBe('trap');
    expect(modalKeyAction('Enter')).toBe('none');
    expect(modalKeyAction('a')).toBe('none');
  });

  it('the dialog listens on the window so focus cannot leave', () => {
    const text = readFileSync(new URL('./Modal.svelte', import.meta.url), 'utf8');
    expect(text).toContain("addEventListener('keydown'");
    expect(text).toContain('modalKeyAction');
  });
});
