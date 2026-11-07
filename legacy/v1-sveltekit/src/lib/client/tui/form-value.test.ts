import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { acceptFormValue, formIdsOk } from './form-value.js';

describe('acceptFormValue', () => {
  it('rejects an empty value and keeps markup as text', () => {
    expect(acceptFormValue('')).toEqual({ ok: false, error: 'Enter a value.' });
    expect(acceptFormValue('   ')).toEqual({ ok: false, error: 'Enter a value.' });
    expect(acceptFormValue('  <b>x</b>  ')).toEqual({ ok: true, value: '<b>x</b>' });
  });

  it('rejects a value longer than 80 characters', () => {
    expect(acceptFormValue('a'.repeat(80))).toEqual({ ok: true, value: 'a'.repeat(80) });
    expect(acceptFormValue('a'.repeat(81))).toEqual({
      ok: false,
      error: 'Use at most 80 characters.',
    });
  });

  it('accepts only a safe id prefix and name', () => {
    expect(formIdsOk('gallery', 'sample')).toBe(true);
    expect(formIdsOk('Gallery', 'sample')).toBe(false);
    expect(formIdsOk('', 'sample')).toBe(false);
    expect(formIdsOk('gallery', 'a/b')).toBe(false);
    expect(formIdsOk('a'.repeat(17), 'sample')).toBe(false);
  });

  it('the form posts and uses the value check', () => {
    const text = readFileSync(new URL('./Form.svelte', import.meta.url), 'utf8');
    expect(text).toContain('method="post"');
    expect(text).toContain('acceptFormValue');
    expect(text).toContain('formIdsOk');
  });
});
