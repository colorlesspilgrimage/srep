<script lang="ts">
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import KeymapForm from '../tui/KeymapForm.svelte';
  import List from '../tui/List.svelte';
  import SettingsPane from '../tui/SettingsPane.svelte';
  import AppIcon from './AppIcon.svelte';
  import {
    beginThemeSave,
    finishThemeSave,
    statusAfterChoice,
    themeSaveMatches,
  } from '../tui/theme-save-state.js';
  import { DEFAULT_THEME_ID, PREMADE_THEMES, themeById } from '../tui/themes.js';
  import type { KeybindMap } from '../tui/keymap.js';
  import { acceptDisplay, copyDisplayPrefs, type DisplayPrefs } from './display-prefs.js';
  import PresetsPanel from './PresetsPanel.svelte';
  import { createSettingsClient } from './settings-client.js';
  import { settingsSectionFromParam, type SettingsSectionId } from './settings-section.js';
  import { acceptStudyDay, parseStudySettings } from './study-day-form.js';

  // Contract: Appearance through Data panes against APIs.
  // Theme list does not save. Only Save theme writes. KeymapForm, display form,
  // study form, and PresetsPanel own their network saves.
  // Security and Data load via dynamic import to keep the settings chunk lean.

  const SECTIONS = [
    { id: 'appearance', label: 'Appearance' },
    { id: 'display', label: 'Display' },
    { id: 'study-day', label: 'Study day' },
    { id: 'presets', label: 'Presets' },
    { id: 'security', label: 'Security' },
    { id: 'data', label: 'Data' },
  ] as const;

  type Props = {
    themeId: string;
    keybinds: KeybindMap;
    display: DisplayPrefs;
    onThemeId: (id: string) => void;
    onKeybinds: (map: KeybindMap) => void;
    onDisplay: (prefs: DisplayPrefs) => void;
    onCapturing: (active: boolean) => void;
  };

  let { themeId, keybinds, display, onThemeId, onKeybinds, onDisplay, onCapturing }: Props =
    $props();

  const client = createSettingsClient();
  const LABELS = SECTIONS.map((item) => item.label);
  const THEME_NAMES = PREMADE_THEMES.map((theme) => theme.name);

  const fromUrl = settingsSectionFromParam(page.url.searchParams.get('section'));
  let section = $state<SettingsSectionId>(fromUrl ?? 'appearance');
  let pickedId = $state<string | null>(null);
  let statusText = $state('');
  let saveSerial = $state(0);
  let savePending = $state(false);
  let draft = $state<KeybindMap | null>(null);

  let timezone = $state('UTC');
  let rolloverText = $state('4');
  let studyStatus = $state('');
  let studyPending = $state(false);
  let studyReady = $state(false);

  let fontSizeText = $state('16');
  let reducedMotion = $state(false);
  let displayStatus = $state('');
  let displayPending = $state(false);
  let displayReady = $state(false);

  const binds = $derived(draft ?? keybinds);
  const sectionIndex = $derived(SECTIONS.findIndex((item) => item.id === section));
  const active = $derived.by(() => {
    const found = themeById(pickedId ?? themeId);
    if (found !== undefined) {
      return found;
    }
    const fallback = themeById(DEFAULT_THEME_ID);
    if (fallback === undefined) {
      throw new Error('bad_theme');
    }
    return fallback;
  });
  const themeIndex = $derived.by(() => {
    const index = PREMADE_THEMES.findIndex((theme) => theme.id === active.id);
    if (index < 0) {
      return 0;
    }
    return index;
  });

  function chooseSection(index: number): void {
    const next = SECTIONS[index];
    if (next !== undefined) {
      section = next.id;
    }
  }

  function chooseTheme(index: number): void {
    const next = PREMADE_THEMES[index];
    if (next === undefined) {
      return;
    }
    const nextState = statusAfterChoice({ serial: saveSerial, statusText }, active.id, next.id);
    saveSerial = nextState.serial;
    statusText = nextState.statusText;
    pickedId = next.id;
    onThemeId(next.id);
  }

  function applyBinds(next: KeybindMap): void {
    draft = next;
    onKeybinds(next);
  }

  function previewDisplay(): void {
    const accepted = acceptDisplay({
      fontSizeText,
      reducedMotion,
      scanline: false,
      cursorBlink: false,
    });
    if (accepted.ok) {
      onDisplay(accepted.display);
    }
  }

  async function saveKeys(next: KeybindMap): Promise<boolean> {
    const result = await client.putKeybinds(next);
    if (result.ok) {
      draft = result.body.keybinds;
      onKeybinds(result.body.keybinds);
    }
    return result.ok;
  }

  async function saveTheme(): Promise<void> {
    if (savePending) {
      return;
    }
    const id = active.id;
    const started = beginThemeSave({ serial: saveSerial, statusText });
    saveSerial = started.state.serial;
    savePending = true;
    try {
      const result = await client.putTheme(id);
      const saved = themeSaveMatches(result.ok ? result.body : null, id);
      const finished = finishThemeSave({ serial: saveSerial, statusText }, started.serial, saved);
      saveSerial = finished.serial;
      statusText = finished.statusText;
      if (saved) {
        onThemeId(id);
      }
    } finally {
      savePending = false;
    }
  }

  async function loadStudy(): Promise<void> {
    const result = await client.getStudy();
    const settings = result.ok ? parseStudySettings(result.body) : null;
    if (settings === null) {
      studyStatus = 'Could not load the study day.';
      studyReady = true;
      return;
    }
    timezone = settings.timezone;
    rolloverText = String(settings.rolloverHour);
    studyStatus = '';
    studyReady = true;
  }

  function applyLoadedDisplay(prefs: DisplayPrefs): void {
    fontSizeText = String(prefs.fontSize);
    reducedMotion = prefs.reducedMotion;
    onDisplay(copyDisplayPrefs({ ...prefs, scanline: false, cursorBlink: false }));
  }

  async function loadDisplay(): Promise<void> {
    const result = await client.getDisplay();
    if (!result.ok) {
      applyLoadedDisplay(display);
      displayStatus = 'Could not load display settings.';
      displayReady = true;
      return;
    }
    applyLoadedDisplay(result.body.display);
    displayStatus = '';
    displayReady = true;
  }

  async function saveStudy(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (studyPending) {
      return;
    }
    const accepted = acceptStudyDay({ timezone, rolloverText });
    if (!accepted.ok) {
      studyStatus = accepted.error;
      return;
    }
    studyPending = true;
    try {
      const result = await client.putStudy({
        timezone: accepted.settings.timezone,
        rolloverText: String(accepted.settings.rolloverHour),
      });
      if (!result.ok) {
        studyStatus = 'Could not save the study day.';
        return;
      }
      const settings = parseStudySettings(result.body);
      if (settings === null) {
        studyStatus = 'Could not save the study day.';
        return;
      }
      timezone = settings.timezone;
      rolloverText = String(settings.rolloverHour);
      studyStatus = 'Saved.';
    } finally {
      studyPending = false;
    }
  }

  async function saveDisplay(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (displayPending) {
      return;
    }
    const accepted = acceptDisplay({
      fontSizeText,
      reducedMotion,
      scanline: false,
      cursorBlink: false,
    });
    if (!accepted.ok) {
      displayStatus = accepted.error;
      return;
    }
    displayPending = true;
    try {
      const result = await client.putDisplay({
        fontSizeText: String(accepted.display.fontSize),
        reducedMotion: accepted.display.reducedMotion,
        scanline: false,
        cursorBlink: false,
      });
      if (!result.ok) {
        displayStatus = 'Could not save display settings.';
        return;
      }
      applyLoadedDisplay(result.body.display);
      displayStatus = 'Saved.';
    } finally {
      displayPending = false;
    }
  }

  onMount(() => {
    void loadStudy();
    void loadDisplay();
  });
</script>

<main class="app-screen">
  <header class="app-page-header">
    <p class="tui-eyebrow app-eyebrow-icon"><AppIcon name="settings" size={14} /> Preferences</p>
    <h1>Settings</h1>
    <p class="app-lead">Theme, keys, study day, presets, security, and data for this instance.</p>
  </header>
  <div class="tui-layout">
    <div class="tui-side">
      <List
        label="Settings sections"
        items={LABELS}
        selectedIndex={sectionIndex}
        onSelect={chooseSection}
      />
    </div>
    <div class="tui-main">
      <div
        id="settings-panel-appearance"
        role="tabpanel"
        aria-label="Appearance"
        hidden={section !== 'appearance'}
      >
        <SettingsPane
          items={THEME_NAMES}
          selectedIndex={themeIndex}
          onSelect={chooseTheme}
          onSave={saveTheme}
          {savePending}
          {statusText}
        />
        <KeymapForm map={binds} onChange={applyBinds} onSave={saveKeys} {onCapturing} />
      </div>
      <div
        id="settings-panel-display"
        role="tabpanel"
        aria-label="Display"
        hidden={section !== 'display'}
      >
        {#if displayReady}
          <form class="tui-form" method="post" onsubmit={saveDisplay}>
            <label for="settings-display-font-size">Font size</label>
            <input
              id="settings-display-font-size"
              name="fontSize"
              type="text"
              inputmode="numeric"
              autocomplete="off"
              bind:value={fontSizeText}
              disabled={displayPending}
              oninput={previewDisplay}
            />
            <label>
              <input
                type="checkbox"
                name="reducedMotion"
                bind:checked={reducedMotion}
                disabled={displayPending}
                onchange={previewDisplay}
              />
              Reduced motion
            </label>
            <button type="submit" aria-busy={displayPending}>Save display</button>
          </form>
          {#if displayStatus !== ''}
            <p role="status" aria-label="Display status">{displayStatus}</p>
          {/if}
        {:else}
          <p>Loading display…</p>
        {/if}
      </div>
      <div
        id="settings-panel-study-day"
        role="tabpanel"
        aria-label="Study day"
        hidden={section !== 'study-day'}
      >
        {#if studyReady}
          <form class="tui-form" method="post" onsubmit={saveStudy}>
            <label for="settings-study-timezone">Timezone</label>
            <input
              id="settings-study-timezone"
              name="timezone"
              type="text"
              autocomplete="off"
              bind:value={timezone}
              disabled={studyPending}
            />
            <label for="settings-study-rollover">Rollover hour</label>
            <input
              id="settings-study-rollover"
              name="rolloverHour"
              type="text"
              inputmode="numeric"
              autocomplete="off"
              bind:value={rolloverText}
              disabled={studyPending}
            />
            <button type="submit" aria-busy={studyPending}>Save study day</button>
          </form>
          {#if studyStatus !== ''}
            <p role="status" aria-label="Study day status">{studyStatus}</p>
          {/if}
        {:else}
          <p>Loading study day…</p>
        {/if}
      </div>
      <div
        id="settings-panel-presets"
        role="tabpanel"
        aria-label="Presets"
        hidden={section !== 'presets'}
      >
        <PresetsPanel />
      </div>
      <div
        id="settings-panel-security"
        role="tabpanel"
        aria-label="Security"
        hidden={section !== 'security'}
      >
        {#if section === 'security'}
          {#await import('./SecurityPanel.svelte') then { default: SecurityPanel }}
            <SecurityPanel />
          {/await}
        {/if}
      </div>
      <div id="settings-panel-data" role="tabpanel" aria-label="Data" hidden={section !== 'data'}>
        {#if section === 'data'}
          {#await import('./DataPanel.svelte') then { default: DataPanel }}
            <DataPanel />
          {/await}
        {/if}
      </div>
    </div>
  </div>
</main>
