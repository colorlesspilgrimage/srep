<script lang="ts">
  import { onMount } from 'svelte';
  import { apiFetch, csrfHeaders } from '#lib/client/api.js';
  import { encodedUuid } from './deck-id.js';

  type TrashNote = { id: string; preview: string; deletedAt: number };
  type DryRunReport = {
    format: string;
    summary: string;
    warnings: string[];
    conflicts: string[];
    wouldImport: Record<string, number>;
    importToken: string;
  };

  let notes = $state<TrashNote[]>([]);
  let status = $state('');
  let pending = $state(false);
  let ready = $state(false);
  let importReport = $state<DryRunReport | null>(null);
  let fileInput = $state<HTMLInputElement | null>(null);

  async function load(): Promise<void> {
    const result = await apiFetch<{ notes: TrashNote[] }>('/api/notes/trash');
    if (!result.ok) {
      status = 'Could not load the trash.';
      ready = true;
      return;
    }
    notes = result.body.notes;
    ready = true;
  }

  async function restore(id: string): Promise<void> {
    if (pending) {
      return;
    }
    const encoded = encodedUuid(id);
    if (encoded === null) {
      status = 'The request failed.';
      return;
    }
    pending = true;
    status = '';
    try {
      const result = await apiFetch(`/api/notes/${encoded}/restore`, { method: 'POST', body: {} });
      if (!result.ok) {
        status =
          result.error === 'deck_required'
            ? 'Pick a deck before restoring this note.'
            : 'The request failed.';
        return;
      }
      status = 'Restored.';
      await load();
    } finally {
      pending = false;
    }
  }

  async function dryRunImport(file: File): Promise<void> {
    pending = true;
    status = '';
    importReport = null;
    try {
      const bytes = await file.arrayBuffer();
      const response = await fetch('/api/import/dry-run', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          ...csrfHeaders(),
          'content-type': file.type || 'application/octet-stream',
        },
        body: bytes,
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        status = 'Import preview failed.';
        return;
      }
      importReport = (body as { report: DryRunReport }).report;
    } finally {
      pending = false;
    }
  }

  async function applyImport(): Promise<void> {
    if (importReport === null || pending) {
      return;
    }
    pending = true;
    status = '';
    try {
      const result = await apiFetch('/api/import/apply', {
        method: 'POST',
        body: { importToken: importReport.importToken },
      });
      if (!result.ok) {
        status = 'Import failed.';
        return;
      }
      status = 'Import complete.';
      importReport = null;
    } finally {
      pending = false;
    }
  }

  function onFileChange(event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (file !== undefined) {
      void dryRunImport(file);
    }
  }

  async function downloadExport(format: string): Promise<void> {
    const response = await fetch(`/api/export?format=${encodeURIComponent(format)}`, {
      credentials: 'same-origin',
    });
    if (!response.ok) {
      status = 'Export failed.';
      return;
    }
    const blob = await response.blob();
    const link = document.createElement('a');
    const disposition = response.headers.get('content-disposition') ?? '';
    const nameMatch = /filename="([^"]+)"/.exec(disposition);
    link.download = nameMatch?.[1] ?? `export.${format}`;
    link.href = URL.createObjectURL(blob);
    link.click();
    URL.revokeObjectURL(link.href);
    status = 'Export started.';
  }

  onMount(() => {
    void load();
  });
</script>

{#if ready}
  <h2>Trash</h2>
  {#if notes.length === 0}
    <p role="status">Trash is empty.</p>
  {:else}
    <ul aria-label="Trashed notes">
      {#each notes as note (note.id)}
        <li>
          <span>{note.preview === '' ? '(empty)' : note.preview}</span>
          <button
            type="button"
            disabled={pending}
            aria-label={'Restore ' + (note.preview === '' ? note.id : note.preview)}
            onclick={() => restore(note.id)}>Restore</button
          >
        </li>
      {/each}
    </ul>
  {/if}
  <h2>Import / export</h2>
  <p>
    Import Anki <code>.apkg</code> packages, native <code>.zip</code> archives, or CSV/TSV. Export uses
    the same formats.
  </p>
  <label>
    Choose a file
    <input
      type="file"
      accept=".apkg,.zip,.csv,.tsv,text/csv"
      disabled={pending}
      bind:this={fileInput}
      onchange={onFileChange}
    />
  </label>
  {#if importReport !== null}
    <section aria-label="Import preview">
      <p>{importReport.summary}</p>
      <ul>
        {#each Object.entries(importReport.wouldImport) as [key, value] (key)}
          <li>{key}: {value}</li>
        {/each}
      </ul>
      {#if importReport.warnings.length > 0}
        <ul aria-label="Import warnings">
          {#each importReport.warnings as warning, index (index)}
            <li>{warning}</li>
          {/each}
        </ul>
      {/if}
      {#if importReport.conflicts.length > 0}
        <p role="alert">Conflicts: {importReport.conflicts.join('; ')}</p>
      {:else}
        <button type="button" disabled={pending} onclick={() => applyImport()}>Import</button>
      {/if}
    </section>
  {/if}
  <div aria-label="Export formats">
    <button type="button" disabled={pending} onclick={() => downloadExport('native')}>
      Export native (.zip)
    </button>
    <button type="button" disabled={pending} onclick={() => downloadExport('apkg')}>
      Export .apkg
    </button>
    <button type="button" disabled={pending} onclick={() => downloadExport('csv')}>
      Export CSV
    </button>
    <button type="button" disabled={pending} onclick={() => downloadExport('text')}>
      Export text
    </button>
  </div>
  {#if status !== ''}
    <p role="status" aria-label="Data status">{status}</p>
  {/if}
{:else}
  <p>Loading data…</p>
{/if}
