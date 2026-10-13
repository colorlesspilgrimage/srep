<script lang="ts">
  import List from './List.svelte';

  // Contract: the theme settings pane. This file does not call the network.

  type Props = {
    items: readonly string[];
    selectedIndex: number;
    onSelect: (index: number) => void;
    onSave: () => void;
    savePending: boolean;
    statusText: string;
  };

  let { items, selectedIndex, onSelect, onSave, savePending, statusText }: Props = $props();
</script>

<List label="Theme setting" {items} {selectedIndex} {onSelect} />
<button type="button" aria-busy={savePending} onclick={onSave}>Save theme</button>
<p role="status" aria-label={statusText}>{statusText}</p>
