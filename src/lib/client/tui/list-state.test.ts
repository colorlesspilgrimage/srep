import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { listKeyEffect, listKeyIndex } from './list-state.js';

function arrowKeysOnlyMove(): void {
  expect(listKeyEffect('ArrowDown')).toBe('move');
  expect(listKeyEffect('ArrowUp')).toBe('move');
  expect(listKeyEffect('Home')).toBe('move');
  expect(listKeyEffect('End')).toBe('move');
  expect(listKeyEffect('Enter')).toBe('run');
  expect(listKeyEffect('a')).toBeNull();
  expect(listKeyEffect('Tab')).toBeNull();
}

describe('listKeyIndex', () => {
  it('arrow keys move a row and Enter runs it', arrowKeysOnlyMove);
  it('moves down and up and stops at the ends', () => {
    expect(listKeyIndex(3, 0, 'ArrowDown')).toBe(1);
    expect(listKeyIndex(3, 2, 'ArrowDown')).toBe(2);
    expect(listKeyIndex(3, 0, 'ArrowUp')).toBe(0);
    expect(listKeyIndex(3, 2, 'ArrowUp')).toBe(1);
    expect(listKeyIndex(3, 1, 'Home')).toBe(0);
    expect(listKeyIndex(3, 1, 'End')).toBe(2);
    expect(listKeyIndex(3, 1, 'Enter')).toBe(1);
  });

  it('ignores keys when the list is empty', () => {
    expect(listKeyIndex(0, 0, 'ArrowDown')).toBeNull();
    expect(listKeyIndex(0, 0, 'Enter')).toBeNull();
    expect(listKeyIndex(3, 0, 'a')).toBeNull();
    expect(listKeyIndex(1.5, 0, 'Enter')).toBeNull();
  });

  it('does not return a bad Enter index', () => {
    expect(listKeyIndex(3, 5, 'Enter')).toBeNull();
    expect(listKeyIndex(3, -1, 'Enter')).toBeNull();
    expect(listKeyIndex(3, Number.NaN, 'Enter')).toBeNull();
  });

  it('turns a bad index into a real row on ArrowDown', () => {
    const next = listKeyIndex(3, Number.NaN, 'ArrowDown');
    expect(Number.isInteger(next)).toBe(true);
    expect(next).toBeGreaterThanOrEqual(0);
    expect(next).toBeLessThan(3);
  });

  it('the list component uses listKeyIndex', () => {
    const text = readFileSync(new URL('./List.svelte', import.meta.url), 'utf8');
    expect(text).toContain('listKeyIndex');
  });
});
