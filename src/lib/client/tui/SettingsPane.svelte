<script lang="ts">
  import List from './List.svelte';

  // Contract: the theme settings pane. This file does not call the network.

  type Props = {
    items: readonly string[];
    selectedIndex: number;
    onSelect: (index: number) => void;
    onSave: () => void;
    statusText: string;
  };

  let { items, selectedIndex, onSelect, onSave, statusText }: Props = $props();
</script>

<List label="Theme setting" {items} {selectedIndex} {onSelect} />
<button type="button" onclick={onSave}>Save theme</button>
<p role="status" aria-label="Theme save status">{statusText}</p>
