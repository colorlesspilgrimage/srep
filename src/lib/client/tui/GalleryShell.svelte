<script lang="ts">
  import './tui.css';
  import './themes.css';
  import { apiFetch } from '#lib/client/api.js';
  import Form from './Form.svelte';
  import List from './List.svelte';
  import Modal from './Modal.svelte';
  import Pane from './Pane.svelte';
  import SettingsPane from './SettingsPane.svelte';
  import StatusLine from './StatusLine.svelte';
  import {
    beginThemeSave,
    finishThemeSave,
    statusAfterChoice,
    themeSaveMatches,
  } from './theme-save-state.js';
  import { DEFAULT_THEME_ID, PREMADE_THEMES, themeById, themeClass } from './themes.js';

  // Contract: the gallery shell. One tree shows the side list or the tab bar.
  // The side list is not a second frame.
  // The Themes list does not save. Only Save theme writes the choice.

  const SECTIONS = [
    { id: 'panes', label: 'Panes' },
    { id: 'list', label: 'List' },
    { id: 'form', label: 'Form' },
    { id: 'modal', label: 'Modal' },
    { id: 'settings', label: 'Settings' },
  ] as const;

  type SectionId = (typeof SECTIONS)[number]['id'];
  type Props = { themeId: string };

  const SECTION_LABELS = SECTIONS.map((item) => item.label);
  const SAMPLE_ITEMS = ['Alpha', 'Beta', 'Gamma'];
  const THEME_NAMES = PREMADE_THEMES.map((theme) => theme.name);

  let { themeId }: Props = $props();
  let section = $state<SectionId>('panes');
  let sampleIndex = $state(0);
  let formValue = $state('');
  let modalOpen = $state(false);
  let openModalButton = $state<HTMLButtonElement | null>(null);
  let pickedId = $state<string | null>(null);
  let statusText = $state('');
  let saveSerial = $state(0);
  let savePending = $state(false);

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
  const STATUS_HINTS = $derived(['Esc close', active.name]);

  function chooseSection(index: number): void {
    const next = SECTIONS[index];
    if (next !== undefined) {
      section = next.id;
    }
  }

  function chooseSample(index: number): void {
    sampleIndex = index;
  }

  function submitSample(value: string): void {
    formValue = value;
  }

  function openModal(): void {
    modalOpen = true;
  }

  function closeModal(): void {
    modalOpen = false;
    openModalButton?.focus();
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
      const result = await apiFetch<{ id: string }>('/api/settings/theme', {
        method: 'PUT',
        body: { id },
      });
      const saved = themeSaveMatches(result.ok ? result.body : null, id);
      const finished = finishThemeSave({ serial: saveSerial, statusText }, started.serial, saved);
      saveSerial = finished.serial;
      statusText = finished.statusText;
    } finally {
      savePending = false;
    }
  }
</script>

<div class="tui-root {themeClass(active.id)}">
  <main>
    <h1>Gallery</h1>
    <div class="tui-tabbar" role="tablist" aria-label="Gallery sections">
      {#each SECTIONS as item, index (item.id)}
        <button
          type="button"
          role="tab"
          id={`tui-tab-${item.id}`}
          aria-controls={`tui-panel-${item.id}`}
          aria-selected={section === item.id}
          onclick={() => chooseSection(index)}
        >
          {item.label}
        </button>
      {/each}
    </div>
    <div class="tui-layout">
      <div class="tui-side tui-only-desktop">
        <List
          label="Specimens"
          items={SECTION_LABELS}
          selectedIndex={sectionIndex}
          onSelect={chooseSection}
        />
      </div>
      <div class="tui-main">
        <div
          id="tui-panel-panes"
          role="tabpanel"
          aria-labelledby="tui-tab-panes"
          hidden={section !== 'panes'}
        >
          <Pane label="Sample pane" title="Pane">Pane body</Pane>
          <List
            label="Themes"
            items={THEME_NAMES}
            selectedIndex={themeIndex}
            onSelect={chooseTheme}
          />
        </div>
        <div
          id="tui-panel-list"
          role="tabpanel"
          aria-labelledby="tui-tab-list"
          hidden={section !== 'list'}
        >
          <List
            label="Sample list"
            items={SAMPLE_ITEMS}
            selectedIndex={sampleIndex}
            onSelect={chooseSample}
          />
        </div>
        <div
          id="tui-panel-form"
          role="tabpanel"
          aria-labelledby="tui-tab-form"
          hidden={section !== 'form'}
        >
          <Form idPrefix="gallery" name="sample" onSubmit={submitSample} />
          <p>Value: {formValue}</p>
        </div>
        <div
          id="tui-panel-modal"
          role="tabpanel"
          aria-labelledby="tui-tab-modal"
          hidden={section !== 'modal'}
        >
          <button type="button" id="tui-open-modal" bind:this={openModalButton} onclick={openModal}>
            Open modal
          </button>
          <Modal
            title="Sample modal"
            open={modalOpen}
            titleId="tui-modal-title"
            onClose={closeModal}
          >
            Modal body
          </Modal>
        </div>
        <div
          id="tui-panel-settings"
          role="tabpanel"
          aria-labelledby="tui-tab-settings"
          hidden={section !== 'settings'}
        >
          <SettingsPane
            items={THEME_NAMES}
            selectedIndex={themeIndex}
            onSelect={chooseTheme}
            onSave={saveTheme}
            {savePending}
            {statusText}
          />
        </div>
      </div>
    </div>
  </main>
  <StatusLine mode="GALLERY" hints={STATUS_HINTS} />
</div>
