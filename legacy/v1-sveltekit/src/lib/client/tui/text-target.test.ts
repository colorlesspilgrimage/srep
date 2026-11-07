import { beforeEach, describe, expect, it } from 'vitest';
import { targetIsTextField } from './text-target.js';

class FakeElement {
  tagName: string;
  isContentEditable: boolean;

  constructor(tagName: string, isContentEditable = false) {
    this.tagName = tagName;
    this.isContentEditable = isContentEditable;
  }
}

describe('targetIsTextField', () => {
  beforeEach(() => {
    (globalThis as { HTMLElement?: unknown }).HTMLElement = FakeElement;
  });

  it('rejects null and a plain object', () => {
    expect(targetIsTextField(null)).toBe(false);
    expect(targetIsTextField({} as EventTarget)).toBe(false);
  });

  it('accepts a field tag and an editable node', () => {
    expect(targetIsTextField(new FakeElement('INPUT') as unknown as EventTarget)).toBe(true);
    expect(targetIsTextField(new FakeElement('DIV', true) as unknown as EventTarget)).toBe(true);
    expect(targetIsTextField(new FakeElement('BUTTON') as unknown as EventTarget)).toBe(false);
  });
});
