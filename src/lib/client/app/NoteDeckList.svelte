<script lang="ts">
  import { deckListKey } from './note-deck-keys.js';
  import type { EditorDeck } from './note-editor-parse.js';

  // Contract: the deck listbox for one note.
  // Keys are handled here. ArrowDown and j move down and stop on the last row.
  // Enter does not save. Escape blurs the list. Tab leaves the list.
  // Space, digits, h, and l do not change the deck.

  type Props = {
    decks: readonly EditorDeck[];
    index: number;
    locked?: boolean;
    onIndex: (index: number) => void;
  };

  let { decks, index, locked = false, onIndex }: Props = $props();

  const activeId = $derived.by(() => {
    const deck = decks[index];
    if (deck === undefined) {
      return undefined;
    }
    return `note-deck-${deck.id}`;
  });

  function onKey(event: KeyboardEvent): void {
    if (locked || event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }
    const effect = deckListKey(event.key, index, decks.length);
    if (effect.type === 'none') {
      if (event.key === ' ') {
        event.preventDefault();
      }
      return;
    }
    event.preventDefault();
    if (effect.type === 'blur') {
      const target = event.currentTarget;
      if (target instanceof HTMLElement) {
        target.blur();
      }
      return;
    }
    if (effect.type === 'select') {
      onIndex(effect.index);
    }
  }

  function onOptionDown(event: MouseEvent, next: number): void {
    event.preventDefault();
    if (locked) {
      return;
    }
    const node = event.currentTarget;
    if (node instanceof HTMLElement) {
      node.parentElement?.focus();
    }
    onIndex(next);
  }
</script>

<div
  class="note-deck"
  role="listbox"
  aria-label="Deck"
  aria-disabled={locked}
  tabindex={locked ? -1 : 0}
  aria-activedescendant={activeId}
  onkeydown={onKey}
>
  {#each decks as deck, row (deck.id)}
    <div
      role="option"
      id="note-deck-{deck.id}"
      tabindex="-1"
      aria-selected={row === index}
      onmousedown={(event) => onOptionDown(event, row)}
    >
      {deck.name}
    </div>
  {/each}
</div>
