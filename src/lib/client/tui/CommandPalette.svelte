<script lang="ts">
  import './palette.css';
  import { commandsFor } from './keymap.js';
  import List from './List.svelte';

  // Contract: the command palette. Enter on a row runs that command and closes.
  // This file does not call the network. It does not trap focus.

  type Props = {
    open: boolean;
    onClose: () => void;
    onRun: (name: string) => void;
  };

  let { open, onClose, onRun }: Props = $props();
  let filter = $state('');

  const names = $derived(filter.trim() === '' ? [] : commandsFor(filter));

  function focusOnMount(node: HTMLInputElement): void {
    filter = '';
    node.focus();
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

  function bindRowEnter(node: HTMLElement): { destroy: () => void } {
    function onKey(event: KeyboardEvent): void {
      if (event.key !== 'Enter') {
        return;
      }
      const index = optionIndex(event.target);
      if (index === null) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      choose(index);
    }
    node.addEventListener('keydown', onKey, true);
    return {
      destroy(): void {
        node.removeEventListener('keydown', onKey, true);
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
    use:bindRowEnter
  >
    <h2 id="tui-command-title">Commands</h2>
    <label for="tui-command-filter">Command</label>
    <input
      id="tui-command-filter"
      type="text"
      maxlength="40"
      autocomplete="off"
      bind:value={filter}
      use:focusOnMount
    />
    <List label="Commands" items={names} selectedIndex={0} onSelect={choose} />
    <button type="button" onclick={onClose}>Close</button>
  </div>
{/if}
