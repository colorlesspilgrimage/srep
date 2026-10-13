<script lang="ts">
  import './tui.css';
  import Form from './Form.svelte';
  import List from './List.svelte';
  import Modal from './Modal.svelte';
  import Pane from './Pane.svelte';
  import StatusLine from './StatusLine.svelte';

  // Contract: the gallery shell. One tree shows the side list or the tab bar.
  // The side list is not a second frame.

  const SECTIONS = [
    { id: 'panes', label: 'Panes' },
    { id: 'list', label: 'List' },
    { id: 'form', label: 'Form' },
    { id: 'modal', label: 'Modal' },
  ] as const;

  type SectionId = (typeof SECTIONS)[number]['id'];

  const SECTION_LABELS = SECTIONS.map((item) => item.label);
  const SAMPLE_ITEMS = ['Alpha', 'Beta', 'Gamma'];
  const STATUS_HINTS = ['Esc close'];

  let section = $state<SectionId>('panes');
  let sampleIndex = $state(0);
  let formValue = $state('');
  let modalOpen = $state(false);
  let openModalButton = $state<HTMLButtonElement | null>(null);

  const sectionIndex = $derived(SECTIONS.findIndex((item) => item.id === section));

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
</script>

<div class="tui-root tui-theme-phosphor-green">
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
      </div>
    </div>
  </main>
  <StatusLine mode="GALLERY" hints={STATUS_HINTS} />
</div>
