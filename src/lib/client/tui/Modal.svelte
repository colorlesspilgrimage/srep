<script lang="ts">
  import type { Snippet } from 'svelte';
  import { modalKeyAction } from './modal-key.js';

  // Contract: a dialog. Escape and Close call onClose. Tab stays on Close.
  // The key listener is on the window. Focus cannot move to the page behind.

  type Props = {
    title: string;
    open: boolean;
    titleId: string;
    onClose: () => void;
    children: Snippet;
  };

  let { title, open, titleId, onClose, children }: Props = $props();
  let closeButton = $state<HTMLButtonElement | null>(null);

  function focusOnMount(node: HTMLElement): void {
    node.focus();
  }

  function onWindowKey(event: KeyboardEvent): void {
    const action = modalKeyAction(event.key);
    if (action === 'none') {
      return;
    }
    event.preventDefault();
    if (action === 'close') {
      onClose();
      return;
    }
    closeButton?.focus();
  }

  $effect(() => {
    if (!open) {
      return;
    }
    window.addEventListener('keydown', onWindowKey, true);
    return () => {
      window.removeEventListener('keydown', onWindowKey, true);
    };
  });
</script>

{#if open}
  <div class="tui-modal" role="dialog" tabindex="-1" aria-modal="true" aria-labelledby={titleId}>
    <h2 id={titleId}>{title}</h2>
    {@render children()}
    <button type="button" bind:this={closeButton} use:focusOnMount onclick={onClose}>Close</button>
  </div>
{/if}
