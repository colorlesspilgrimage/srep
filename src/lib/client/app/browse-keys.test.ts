import { describe, expect, it } from 'vitest';
import { browseKeyAction, type BrowseKeyInput, type BrowseRegion } from './browse-keys.js';

// Contract: every browse key from the browse-screen plan.

function input(region: BrowseRegion, patch: Partial<BrowseKeyInput> = {}): BrowseKeyInput {
  return {
    key: 'x',
    region,
    modalOpen: false,
    paletteOpen: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    queryEmpty: true,
    hasSelection: false,
    ...patch,
  };
}

describe('browse keys in the search field', () => {
  it('lets letters, spaces, colon, and digits type', () => {
    for (const key of ['g', ' ', ':', '1', '2', '3', '4']) {
      expect(browseKeyAction(input('query', { key }))).toEqual({ type: 'none' });
    }
  });

  it('does not move the row for arrows, j, or k', () => {
    for (const key of ['ArrowDown', 'ArrowUp', 'j', 'k']) {
      expect(browseKeyAction(input('query', { key }))).toEqual({ type: 'none' });
    }
  });

  it('runs search on Enter', () => {
    expect(browseKeyAction(input('query', { key: 'Enter' }))).toEqual({ type: 'search' });
  });

  it('clears a filled field and blurs an empty field', () => {
    expect(browseKeyAction(input('query', { key: 'Escape', queryEmpty: false }))).toEqual({
      type: 'clear-query',
    });
    expect(browseKeyAction(input('query', { key: 'Escape', queryEmpty: true }))).toEqual({
      type: 'blur',
    });
  });

  it('opens the palette on Ctrl+K and selects the field on Ctrl+A', () => {
    expect(browseKeyAction(input('query', { key: 'k', ctrlKey: true }))).toEqual({
      type: 'palette',
    });
    expect(browseKeyAction(input('query', { key: 'a', ctrlKey: true }))).toEqual({
      type: 'select-query',
    });
    expect(browseKeyAction(input('query', { key: 'a', metaKey: true }))).toEqual({
      type: 'select-query',
    });
    expect(browseKeyAction(input('query', { key: 'a', altKey: true }))).toEqual({ type: 'none' });
  });
});

describe('browse keys in the grid', () => {
  it('moves and stops through the plan action', () => {
    expect(browseKeyAction(input('grid', { key: 'ArrowDown' }))).toEqual({
      type: 'move',
      move: 'next',
    });
    expect(browseKeyAction(input('grid', { key: 'j' }))).toEqual({ type: 'move', move: 'next' });
    expect(browseKeyAction(input('grid', { key: 'ArrowUp' }))).toEqual({
      type: 'move',
      move: 'prev',
    });
    expect(browseKeyAction(input('grid', { key: 'k' }))).toEqual({ type: 'move', move: 'prev' });
    expect(browseKeyAction(input('grid', { key: 'Home' }))).toEqual({
      type: 'move',
      move: 'first',
    });
    expect(browseKeyAction(input('grid', { key: 'End' }))).toEqual({ type: 'move', move: 'last' });
  });

  it('toggles on Space, opens on Enter, and tabs to the bulk controls', () => {
    expect(browseKeyAction(input('grid', { key: ' ' }))).toEqual({ type: 'toggle' });
    expect(browseKeyAction(input('grid', { key: 'Enter' }))).toEqual({ type: 'open' });
    expect(browseKeyAction(input('grid', { key: 'Tab' }))).toEqual({ type: 'tab', shift: false });
    expect(browseKeyAction(input('grid', { key: 'Tab', shiftKey: true }))).toEqual({
      type: 'tab',
      shift: true,
    });
  });

  it('clears a selection on Escape and blurs when none exists', () => {
    expect(browseKeyAction(input('grid', { key: 'Escape', hasSelection: true }))).toEqual({
      type: 'clear-selection',
    });
    expect(browseKeyAction(input('grid', { key: 'Escape' }))).toEqual({ type: 'blur' });
  });

  it('does nothing for digits, h, l, page keys, Delete, and Backspace', () => {
    for (const key of ['1', '2', '3', '4', 'h', 'l', 'PageUp', 'PageDown', 'Delete', 'Backspace']) {
      expect(browseKeyAction(input('grid', { key }))).toEqual({ type: 'none' });
    }
  });

  it('selects the page on Ctrl+A and opens the palette on Ctrl+K', () => {
    expect(browseKeyAction(input('grid', { key: 'a', ctrlKey: true }))).toEqual({
      type: 'select-page',
    });
    expect(browseKeyAction(input('grid', { key: 'k', ctrlKey: true }))).toEqual({
      type: 'palette',
    });
    expect(browseKeyAction(input('grid', { key: 'k', ctrlKey: true, shiftKey: true }))).toEqual({
      type: 'none',
    });
  });
});

describe('browse keys in the delete dialog', () => {
  it('closes on Escape and does not move the grid', () => {
    expect(browseKeyAction(input('dialog', { key: 'Escape' }))).toEqual({ type: 'close-dialog' });
    expect(browseKeyAction(input('dialog', { key: 'ArrowDown' }))).toEqual({ type: 'none' });
    expect(browseKeyAction(input('dialog', { key: 'Enter' }))).toEqual({ type: 'none' });
  });

  it('does nothing when a dialog or the palette is open over the grid', () => {
    expect(browseKeyAction(input('grid', { key: 'j', modalOpen: true }))).toEqual({ type: 'none' });
    expect(browseKeyAction(input('grid', { key: 'j', paletteOpen: true }))).toEqual({
      type: 'none',
    });
    expect(browseKeyAction(input('query', { key: 'Enter', paletteOpen: true }))).toEqual({
      type: 'none',
    });
  });
});
