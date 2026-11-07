<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { apiFetch } from '#lib/client/api.js';
  import { messageFor } from '#lib/client/messages.js';
  import AppIcon from './AppIcon.svelte';
  import { pairingQrDataUrl } from './pairing-qr.js';

  // Contract: mint a short-lived pairing code + QR, list and revoke paired devices.

  type Token = {
    id: string;
    name: string;
    createdAt: number;
    lastUsedAt: number | null;
    revokedAt: number | null;
  };

  type PairingResponse = {
    code: string;
    expiresAt: number;
    qrPayload: { v: 1; origin: string; code: string };
  };

  let tokens = $state<Token[]>([]);
  let error = $state('');
  let ready = $state(false);
  let busy = $state(false);
  let deviceName = $state('');
  let active: PairingResponse | null = $state(null);
  let qrUrl = $state('');
  let secondsLeft = $state(0);
  let confirmingId = $state<string | null>(null);
  let editingId = $state<string | null>(null);
  let editValue = $state('');
  let tick: ReturnType<typeof setInterval> | null = null;

  function clearTick(): void {
    if (tick !== null) {
      clearInterval(tick);
      tick = null;
    }
  }

  function startTick(expiresAt: number): void {
    clearTick();
    const update = () => {
      const left = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
      secondsLeft = left;
      if (left === 0) {
        clearTick();
        active = null;
        qrUrl = '';
      }
    };
    update();
    tick = setInterval(update, 1000);
  }

  async function loadTokens(): Promise<void> {
    const result = await apiFetch<{ tokens: Token[] }>('/api/auth/tokens');
    if (result.ok) {
      tokens = result.body.tokens;
    } else {
      error = messageFor(result.error);
    }
    ready = true;
  }

  async function startPairing(): Promise<void> {
    busy = true;
    error = '';
    const body = deviceName.trim() === '' ? {} : { name: deviceName.trim() };
    const result = await apiFetch<PairingResponse>('/api/auth/pairing/code', {
      method: 'POST',
      body,
    });
    busy = false;
    if (!result.ok) {
      error = messageFor(result.error);
      return;
    }
    active = result.body;
    qrUrl = pairingQrDataUrl(JSON.stringify(result.body.qrPayload));
    startTick(result.body.expiresAt);
  }

  async function revoke(id: string): Promise<void> {
    if (confirmingId !== id) {
      confirmingId = id;
      return;
    }
    confirmingId = null;
    error = '';
    const result = await apiFetch('/api/auth/tokens/' + id, { method: 'DELETE' });
    if (!result.ok) {
      error = messageFor(result.error);
      return;
    }
    await loadTokens();
  }

  async function saveRename(id: string): Promise<void> {
    error = '';
    const result = await apiFetch('/api/auth/tokens/' + id, {
      method: 'PATCH',
      body: { name: editValue },
    });
    if (!result.ok) {
      error = messageFor(result.error);
      return;
    }
    editingId = null;
    await loadTokens();
  }

  function formatWhen(ms: number | null): string {
    if (ms === null) {
      return 'never';
    }
    return new Date(ms).toLocaleString();
  }

  onMount(() => {
    void loadTokens();
  });

  onDestroy(() => {
    clearTick();
  });
</script>

{#if ready}
  <p class="app-lead">
    Pair an iOS app with this instance. The app scans the QR code (or types the code) and receives a
    long-lived API token. Revoke a device here to cut off its access.
  </p>

  <div class="tui-form">
    <label for="pair-device-name">Device name (optional)</label>
    <input
      id="pair-device-name"
      type="text"
      autocomplete="off"
      maxlength="64"
      bind:value={deviceName}
      placeholder="iPhone"
    />
    <button type="button" disabled={busy} onclick={() => startPairing()}>
      <AppIcon name="phone" size={15} />
      <span>{active ? 'New pairing code' : 'Generate pairing code'}</span>
    </button>
  </div>

  {#if active}
    <div class="pair-active" role="status" aria-live="polite">
      <p class="pair-code" aria-label="Pairing code">{active.code}</p>
      <p>Expires in {secondsLeft}s · origin {active.qrPayload.origin}</p>
      {#if qrUrl !== ''}
        <div class="pair-qr">
          <img src={qrUrl} alt="Pairing QR code" width="224" height="224" />
        </div>
      {/if}
      <p>In the app: scan the QR, or enter the instance URL and this code.</p>
    </div>
  {/if}

  {#if error !== ''}<p class="error" role="alert">{error}</p>{/if}

  <h2 class="pair-heading">Paired devices</h2>
  {#if tokens.filter((t) => t.revokedAt === null).length === 0}
    <p role="status">No paired devices yet.</p>
  {:else}
    <ul aria-label="Paired devices">
      {#each tokens.filter((t) => t.revokedAt === null) as token (token.id)}
        <li>
          {#if editingId === token.id}
            <label>
              New name
              <input type="text" maxlength="64" bind:value={editValue} />
            </label>
            <button type="button" onclick={() => saveRename(token.id)}>Save</button>
            <button type="button" onclick={() => (editingId = null)}>Cancel</button>
          {:else}
            <span>{token.name}</span>
            <span class="pair-meta">Last used {formatWhen(token.lastUsedAt)}</span>
            <button
              type="button"
              aria-label={'Rename ' + token.name}
              onclick={() => {
                editingId = token.id;
                editValue = token.name;
              }}>Rename</button
            >
            <button
              type="button"
              aria-label={(confirmingId === token.id ? 'Confirm revoke ' : 'Revoke ') + token.name}
              onclick={() => revoke(token.id)}
              >{confirmingId === token.id ? 'Confirm revoke' : 'Revoke'}</button
            >
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
{:else}
  <p>Loading pairing…</p>
{/if}

<style>
  .pair-active {
    margin: 1rem 0;
  }
  .pair-code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 1.75rem;
    letter-spacing: 0.08em;
    margin: 0.5rem 0;
  }
  .pair-qr {
    width: min(100%, 14rem);
    margin: 0.75rem 0;
    color: var(--tui-fg, #111);
    background: var(--tui-bg, #fff);
  }
  .pair-qr img {
    display: block;
    width: 100%;
    height: auto;
  }
  .pair-heading {
    font-size: 1rem;
    margin: 1.25rem 0 0.5rem;
  }
  .pair-meta {
    opacity: 0.7;
    margin-inline: 0.5rem;
    font-size: 0.9em;
  }
</style>
