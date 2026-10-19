<script lang="ts">
  import { nextTrapIndex } from '#lib/client/tui/palette-focus.js';
  import { dialogKeyAction } from './dialog-focus.js';

  // Contract: confirm dialog for bulk delete.
  // Escape closes and does not delete. Enter on Confirm delete deletes.
  // Tab and Shift+Tab stay inside. Close returns focus to the opener.

  type Props = {
    busy: boolean;
    onClose: () => void;
    onConfirm: () => void;
  };

  let { busy, onClose, onConfirm }: Props = $props();
  let dialog = $state<HTMLElement | null>(null);

  const FOCUSABLE = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
  ].join(', ');

  const BLOCKED = new Set([
    'ArrowDown',
    'ArrowUp',
    'ArrowLeft',
    'ArrowRight',
    'Home',
    'End',
    'PageUp',
    'PageDown',
    'j',
    'k',
    'h',
    'l',
  ]);

  function focusDialog(node: HTMLElement): { destroy: () => void } {
    const previous = document.activeElement;
    const returnFocus = previous instanceof HTMLElement && previous !== node ? previous : null;
    node.focus();
    return {
      destroy(): void {
        if (returnFocus !== null && returnFocus.isConnected) {
          returnFocus.focus();
        }
      },
    };
  }

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

  function trapTab(shiftKey: boolean): void {
    const root = dialog;
    if (root === null) {
      return;
    }
    const items = focusableItems(root);
    const current = items.indexOf(document.activeElement as HTMLElement);
    const next = nextTrapIndex(items.length, current, shiftKey);
    const target = next === null ? undefined : items[next];
    if (target !== undefined) {
      target.focus();
    }
  }

  function activatesControl(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) {
      return false;
    }
    const tag = target.tagName;
    return tag === 'BUTTON' || tag === 'SELECT' || tag === 'INPUT';
  }

  function onKey(event: KeyboardEvent): void {
    if (BLOCKED.has(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const action = dialogKeyAction(event.key, event.shiftKey, activatesControl(event.target));
    if (action.type === 'none') {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (action.type === 'close') {
      onClose();
      return;
    }
    if (action.type === 'tab') {
      trapTab(action.shift);
    }
  }

  $effect(() => {
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
    };
  });
</script>

<div
  class="tui-modal app-dialog"
  role="dialog"
  aria-modal="true"
  aria-labelledby="browse-delete-title"
  tabindex="-1"
  bind:this={dialog}
  use:focusDialog
>
  <h2 id="browse-delete-title">Delete selected notes</h2>
  <p>Trash the selected notes.</p>
  <button type="button" disabled={busy} onclick={onClose}>Cancel</button>
  <button type="button" disabled={busy} onclick={onConfirm}>Confirm delete</button>
</div>
