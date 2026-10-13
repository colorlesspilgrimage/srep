<script lang="ts">
  import type { Snippet } from 'svelte';

  // Contract: a dialog. Escape and Close call onClose. Tab stays on Close.

  type Props = {
    title: string;
    open: boolean;
    titleId: string;
    onClose: () => void;
    children: Snippet;
  };

  let { title, open, titleId, onClose, children }: Props = $props();

  function focusOnMount(node: HTMLElement): void {
    node.focus();
  }

  function onDialogKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
    }
  }
</script>

{#if open}
  <div
    class="tui-modal"
    role="dialog"
    tabindex="-1"
    aria-modal="true"
    aria-labelledby={titleId}
    onkeydown={onDialogKey}
  >
    <h2 id={titleId}>{title}</h2>
    {@render children()}
    <button type="button" use:focusOnMount onclick={onClose}>Close</button>
  </div>
{/if}
