<script lang="ts">
  import { onMount } from 'svelte';
  import List from '../tui/List.svelte';
  import {
    BLANK_PRESET_DRAFT,
    copyDraft,
    draftFromPreset,
    parsePresetBody,
    parsePresetsBody,
    presetMessageFor,
    type PresetDraft,
    type PresetRow,
  } from './preset-form.js';
  import { createPresetsClient } from './presets-client.js';

  // Contract: list / create / edit / delete presets. API errors surface in status.

  const client = createPresetsClient();

  let presets = $state<PresetRow[]>([]);
  let selectedIndex = $state(0);
  let editingId = $state<string | null>(null);
  let draft = $state<PresetDraft>(copyDraft(BLANK_PRESET_DRAFT));
  let status = $state('');
  let pending = $state(false);
  let ready = $state(false);

  const names = $derived(presets.map((p) => p.name));

  function apply(p: PresetRow): void {
    editingId = p.id;
    draft = draftFromPreset(p);
  }

  function choose(index: number): void {
    const next = presets[index];
    if (next === undefined) {
      return;
    }
    selectedIndex = index;
    apply(next);
    status = '';
  }

  function startNew(): void {
    editingId = null;
    selectedIndex = -1;
    draft = copyDraft(BLANK_PRESET_DRAFT);
    status = '';
  }

  async function load(preferId: string | null = null): Promise<void> {
    const result = await client.listPresets();
    const listed = result.ok ? parsePresetsBody(result.body) : null;
    if (listed === null) {
      status = 'Could not load presets.';
      ready = true;
      return;
    }
    presets = listed;
    if (listed.length === 0) {
      startNew();
      ready = true;
      return;
    }
    const prefer = preferId === null ? -1 : listed.findIndex((r) => r.id === preferId);
    const index = prefer >= 0 ? prefer : Math.min(Math.max(selectedIndex, 0), listed.length - 1);
    selectedIndex = index;
    const row = listed[index];
    if (row !== undefined) {
      apply(row);
    }
    ready = true;
  }

  async function save(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (pending) {
      return;
    }
    pending = true;
    status = '';
    try {
      const result =
        editingId === null
          ? await client.createPreset(draft)
          : await client.updatePreset(editingId, draft);
      if (!result.ok) {
        status = presetMessageFor(result.error);
        return;
      }
      const saved = parsePresetBody(result.body);
      if (saved === null) {
        status = 'Could not save the preset.';
        return;
      }
      status = 'Saved.';
      await load(saved.id);
    } finally {
      pending = false;
    }
  }

  async function remove(): Promise<void> {
    if (pending || editingId === null) {
      return;
    }
    pending = true;
    status = '';
    try {
      const result = await client.deletePreset(editingId);
      if (!result.ok) {
        status = presetMessageFor(result.error);
        return;
      }
      status = 'Deleted.';
      selectedIndex = 0;
      await load(null);
    } finally {
      pending = false;
    }
  }

  onMount(() => {
    void load();
  });
</script>

{#if ready}
  <List label="Presets" items={names} {selectedIndex} onSelect={choose} />
  <button type="button" disabled={pending} onclick={startNew}>New preset</button>
  <form class="tui-form" method="post" onsubmit={save}>
    <label for="settings-preset-name">Name</label>
    <input
      id="settings-preset-name"
      type="text"
      maxlength="100"
      bind:value={draft.name}
      disabled={pending}
    />
    <label for="settings-preset-new-per-day">New per day</label>
    <input
      id="settings-preset-new-per-day"
      type="text"
      inputmode="numeric"
      bind:value={draft.newPerDayText}
      disabled={pending}
    />
    <label for="settings-preset-reviews-per-day">Reviews per day</label>
    <input
      id="settings-preset-reviews-per-day"
      type="text"
      inputmode="numeric"
      bind:value={draft.reviewsPerDayText}
      disabled={pending}
    />
    <label for="settings-preset-retention">Desired retention</label>
    <input
      id="settings-preset-retention"
      type="text"
      inputmode="decimal"
      bind:value={draft.desiredRetentionText}
      disabled={pending}
    />
    <label for="settings-preset-learning">Learning steps</label>
    <input
      id="settings-preset-learning"
      type="text"
      bind:value={draft.learningStepsText}
      disabled={pending}
    />
    <label for="settings-preset-relearning">Relearning steps</label>
    <input
      id="settings-preset-relearning"
      type="text"
      bind:value={draft.relearningStepsText}
      disabled={pending}
    />
    <label for="settings-preset-max-interval">Max interval</label>
    <input
      id="settings-preset-max-interval"
      type="text"
      inputmode="numeric"
      bind:value={draft.maxIntervalText}
      disabled={pending}
    />
    <label>
      <input type="checkbox" bind:checked={draft.burySiblings} disabled={pending} />
      Bury siblings
    </label>
    <label for="settings-preset-new-order">New order</label>
    <select id="settings-preset-new-order" bind:value={draft.newOrder} disabled={pending}>
      <option value="added">added</option>
      <option value="random">random</option>
    </select>
    <button type="submit" aria-busy={pending}>Save preset</button>
    <button type="button" disabled={pending || editingId === null} onclick={remove}
      >Delete preset</button
    >
  </form>
  {#if status !== ''}
    <p role="status" aria-label="Presets status">{status}</p>
  {/if}
{:else}
  <p>Loading presets…</p>
{/if}
