<script lang="ts">
  import './palette.css';
  import { commandsFor } from './keymap.js';
  import { listKeyEffect, listKeyIndex } from './list-state.js';
  import { nextTrapIndex } from './palette-focus.js';
  import List from './List.svelte';

  // Contract: the command palette. Enter on a row runs that command and closes.
  // Arrow keys only move the row. This file does not call the network.

  type Props = {
    open: boolean;
    onClose: () => void;
    onRun: (name: string) => void;
  };

  let { open, onClose, onRun }: Props = $props();
  let filter = $state('');
  let picked = $state(0);

  const names = $derived(filter.trim() === '' ? [] : commandsFor(filter));
  const rowIndex = $derived(names.length === 0 ? 0 : Math.min(picked, names.length - 1));

  function focusOnMount(node: HTMLInputElement): void {
    filter = '';
    picked = 0;
    node.focus();
  }

  function resetPick(): void {
    picked = 0;
  }

  function choose(index: number): void {
    const name = names[index];
    if (name === undefined) {
      return;
    }
    onRun(name);
    onClose();
  }

  function optionIndex(target: EventTarget | null): number | null {
    if (!(target instanceof HTMLElement) || target.getAttribute('role') !== 'option') {
      return null;
    }
    const list = target.closest('[role="listbox"]');
    if (list === null) {
      return null;
    }
    const options = list.querySelectorAll('[role="option"]');
    const index = Array.prototype.indexOf.call(options, target);
    if (index < 0) {
      return null;
    }
    return index;
  }

  function optionAt(root: HTMLElement, index: number): HTMLElement | null {
    const node = root.querySelectorAll('[role="option"]')[index];
    if (!(node instanceof HTMLElement)) {
      return null;
    }
    return node;
  }

  function inCommandList(target: EventTarget | null): boolean {
    return target instanceof HTMLElement && target.closest('[role="listbox"]') !== null;
  }

  function inCommandField(target: EventTarget | null): boolean {
    return target instanceof HTMLInputElement;
  }

  function runRow(index: number, event: KeyboardEvent): void {
    if (names[index] === undefined) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    choose(index);
  }

  function moveRow(root: HTMLElement, event: KeyboardEvent): void {
    const next = listKeyIndex(names.length, rowIndex, event.key);
    if (next === null) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    picked = next;
    optionAt(root, next)?.focus();
  }

  const FOCUSABLE = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]',
  ].join(', ');

  function focusableItems(root: HTMLElement): HTMLElement[] {
    const found: HTMLElement[] = [];
    for (const node of root.querySelectorAll<HTMLElement>(FOCUSABLE)) {
      if (node.tabIndex < 0 || node.closest('[hidden]') !== null) {
        continue;
      }
      found.push(node);
    }
    return found;
  }

  function trapTab(root: HTMLElement, event: KeyboardEvent): void {
    const items = focusableItems(root);
    const current = items.indexOf(document.activeElement as HTMLElement);
    const next = nextTrapIndex(items.length, current, event.shiftKey);
    if (next === null) {
      return;
    }
    const target = items[next];
    if (target === undefined) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    target.focus();
  }

  function bindPaletteKeys(node: HTMLElement): { destroy: () => void } {
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Tab') {
        trapTab(node, event);
        return;
      }
      const effect = listKeyEffect(event.key);
      const inList = inCommandList(event.target);
      const inField = inCommandField(event.target);
      if (effect === null || (!inList && !inField)) {
        return;
      }
      if (effect === 'move') {
        moveRow(node, event);
        return;
      }
      const focused = optionIndex(event.target);
      runRow(focused ?? rowIndex, event);
    }
    window.addEventListener('keydown', onKey, true);
    return {
      destroy(): void {
        window.removeEventListener('keydown', onKey, true);
      },
    };
  }
</script>

{#if open}
  <div
    class="tui-palette tui-modal"
    role="dialog"
    aria-modal="true"
    aria-labelledby="tui-command-title"
    use:bindPaletteKeys
  >
    <h2 id="tui-command-title">Commands</h2>
    <label for="tui-command-filter">Command</label>
    <input
      id="tui-command-filter"
      type="text"
      maxlength="40"
      autocomplete="off"
      bind:value={filter}
      oninput={resetPick}
      use:focusOnMount
    />
    <List label="Commands" items={names} selectedIndex={rowIndex} onSelect={choose} />
    <button type="button" onclick={onClose}>Close</button>
  </div>
{/if}
