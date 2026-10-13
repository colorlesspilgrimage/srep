<script lang="ts">
  import { onDestroy } from 'svelte';
  import {
    PALETTE_CLOSE,
    PALETTE_OPEN,
    PALETTE_OPEN_COLON,
    chordFromEvent,
    remap,
    type ActionId,
    type KeybindMap,
  } from './keymap.js';

  // Contract: edit the three gallery chords. This file does not call the network.
  // Hide this status when it has no text. The theme status is then the only status node.

  const ROWS = [
    { id: PALETTE_OPEN, label: 'Open palette', change: 'Change Open palette' },
    {
      id: PALETTE_OPEN_COLON,
      label: 'Open palette with colon',
      change: 'Change Open palette with colon',
    },
    { id: PALETTE_CLOSE, label: 'Close palette', change: 'Change Close palette' },
  ] as const;

  type Props = {
    map: KeybindMap;
    onChange: (map: KeybindMap) => void;
    onSave: (map: KeybindMap) => Promise<boolean>;
    onCapturing: (active: boolean) => void;
  };

  let { map, onChange, onSave, onCapturing }: Props = $props();
  let capturing = $state<ActionId | null>(null);
  let status = $state('');
  let snapshot = $state<KeybindMap | null>(null);
  let cancelButton = $state<HTMLButtonElement | null>(null);

  function currentMap(): KeybindMap {
    return {
      [PALETTE_OPEN]: map[PALETTE_OPEN],
      [PALETTE_OPEN_COLON]: map[PALETTE_OPEN_COLON],
      [PALETTE_CLOSE]: map[PALETTE_CLOSE],
    };
  }

  function focusOnMount(node: HTMLButtonElement): void {
    node.focus();
  }

  function listen(): void {
    window.addEventListener('keydown', onCaptureKey, true);
  }

  function unlisten(): void {
    if (typeof window === 'undefined') {
      return;
    }
    window.removeEventListener('keydown', onCaptureKey, true);
  }

  function begin(action: ActionId): void {
    unlisten();
    snapshot = currentMap();
    capturing = action;
    status = 'Press a key.';
    onCapturing(true);
    listen();
  }

  function endCapture(): void {
    unlisten();
    capturing = null;
    onCapturing(false);
  }

  function cancel(): void {
    const saved = snapshot ?? currentMap();
    endCapture();
    onChange(saved);
    status = '';
  }

  function onCaptureKey(event: KeyboardEvent): void {
    if (capturing === null || event.target !== cancelButton) {
      return;
    }
    const chord = chordFromEvent(event);
    event.preventDefault();
    if (chord === null) {
      return;
    }
    event.stopPropagation();
    const next = remap(currentMap(), capturing, chord);
    if (typeof next === 'string') {
      status = 'That key is already used.';
      return;
    }
    onChange(next);
    endCapture();
    status = '';
  }

  async function save(): Promise<void> {
    if (capturing !== null) {
      endCapture();
    }
    const ok = await onSave(currentMap());
    status = ok ? 'Saved.' : 'Could not save the keys.';
  }

  onDestroy(unlisten);
</script>

<div class="tui-keymap">
  {#each ROWS as row (row.id)}
    <p>{row.label} {map[row.id]}</p>
    <button type="button" onclick={() => begin(row.id)}>{row.change}</button>
  {/each}
  {#if capturing !== null}
    <button type="button" bind:this={cancelButton} use:focusOnMount onclick={cancel}>
      Cancel change
    </button>
  {/if}
  <button type="button" onclick={save}>Save keys</button>
  {#if status !== ''}
    <p role="status" aria-label="Key save status">{status}</p>
  {/if}
</div>
