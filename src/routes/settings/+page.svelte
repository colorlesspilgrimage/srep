<script lang="ts">
  import { untrack } from 'svelte';
  import type { PageData } from './$types';
  import AppShell from '#lib/client/app/AppShell.svelte';
  import SettingsScreen from '#lib/client/app/SettingsScreen.svelte';
  import TuiPage from '#lib/client/app/TuiPage.svelte';
  import type { DisplayPrefs } from '#lib/client/app/display-prefs.js';
  import type { KeybindMap } from '#lib/client/tui/keymap.js';

  // Contract: the signed-in settings route. Guests stay on the auth pages.
  // Theme, keybinds, and display stay local so panes can preview without a reload.

  let { data }: { data: PageData } = $props();
  let paletteOpen = $state(false);
  let keyCapture = $state(false);
  let themeId = $state(untrack(() => data.themeId));
  let keybinds = $state<KeybindMap>(untrack(() => data.keybinds));
  let display = $state<DisplayPrefs>(untrack(() => data.display));
</script>

<TuiPage />
<svelte:head><title>Settings</title></svelte:head>

<AppShell {themeId} {keybinds} {display} {keyCapture} bind:paletteOpen mode="SETTINGS">
  <SettingsScreen
    {themeId}
    {keybinds}
    {display}
    onThemeId={(id) => {
      themeId = id;
    }}
    onKeybinds={(map) => {
      keybinds = map;
    }}
    onDisplay={(next) => {
      display = next;
    }}
    onCapturing={(active) => {
      keyCapture = active;
    }}
  />
</AppShell>
