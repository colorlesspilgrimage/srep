<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { onMount } from 'svelte';
  import { apiFetch } from '#lib/client/api.js';
  import { enroll, signOut, type Kind } from '#lib/client/ceremonies.js';
  import { messageFor } from '#lib/client/messages.js';

  // Contract: lean credentials + recovery count + logout. Reuses apiFetch/ceremonies.

  type Credential = { id: string; nickname: string; kind: Kind };

  let credentials = $state<Credential[]>([]);
  let unusedCount = $state<number | null>(null);
  let error = $state('');
  let confirmingId = $state<string | null>(null);
  let editingId = $state<string | null>(null);
  let editValue = $state('');
  let newNickname = $state('');
  let busy = $state(false);
  let ready = $state(false);

  async function load(): Promise<void> {
    const [creds, recovery] = await Promise.all([
      apiFetch<{ credentials: Credential[] }>('/api/auth/credentials'),
      apiFetch<{ unusedCount: number }>('/api/auth/recovery'),
    ]);
    if (creds.ok) {
      credentials = creds.body.credentials;
    } else {
      error = messageFor(creds.error);
    }
    unusedCount = recovery.ok ? recovery.body.unusedCount : null;
    ready = true;
  }

  async function revoke(id: string): Promise<void> {
    if (confirmingId !== id) {
      confirmingId = id;
      return;
    }
    confirmingId = null;
    error = '';
    const result = await apiFetch('/api/auth/credentials/' + id, { method: 'DELETE' });
    if (!result.ok) {
      error = messageFor(result.error);
      return;
    }
    await load();
  }

  async function saveRename(id: string): Promise<void> {
    error = '';
    const result = await apiFetch('/api/auth/credentials/' + id, {
      method: 'PATCH',
      body: { nickname: editValue },
    });
    if (!result.ok) {
      error = messageFor(result.error);
      return;
    }
    editingId = null;
    await load();
  }

  async function add(kind: Kind): Promise<void> {
    busy = true;
    error = '';
    const result = await enroll('/api/auth/credentials', { kind, nickname: newNickname });
    busy = false;
    if (result.ok) {
      newNickname = '';
      await load();
    } else {
      error = result.message;
    }
  }

  async function logOut(everywhere: boolean): Promise<void> {
    await signOut(everywhere);
    await goto(resolve('/login'), { invalidateAll: true });
  }

  onMount(() => {
    void load();
  });
</script>

{#if ready}
  {#if credentials.length === 1}
    <p role="status">You have one credential. Add a second one.</p>
  {/if}
  <ul aria-label="Credentials">
    {#each credentials as credential (credential.id)}
      <li>
        {#if editingId === credential.id}
          <label>
            New nickname
            <input type="text" maxlength="64" bind:value={editValue} />
          </label>
          <button type="button" onclick={() => saveRename(credential.id)}>Save</button>
          <button type="button" onclick={() => (editingId = null)}>Cancel</button>
        {:else}
          <span>{credential.nickname}</span>
          <button
            type="button"
            aria-label={'Rename ' + credential.nickname}
            onclick={() => {
              editingId = credential.id;
              editValue = credential.nickname;
            }}>Rename</button
          >
          <button
            type="button"
            aria-label={(confirmingId === credential.id ? 'Confirm revoke ' : 'Revoke ') +
              credential.nickname}
            onclick={() => revoke(credential.id)}
            >{confirmingId === credential.id ? 'Confirm revoke' : 'Revoke'}</button
          >
        {/if}
      </li>
    {/each}
  </ul>
  {#if unusedCount !== null}
    <p role="status" aria-label="Recovery codes">Unused recovery codes: {unusedCount}</p>
  {/if}
  {#if error !== ''}<p class="error" role="alert">{error}</p>{/if}
  <div class="tui-form">
    <label for="settings-cred-nickname">Nickname for the new credential</label>
    <input
      id="settings-cred-nickname"
      type="text"
      autocomplete="off"
      maxlength="64"
      bind:value={newNickname}
    />
    <button type="button" disabled={busy} onclick={() => add('passkey')}>Add a passkey</button>
    <button type="button" disabled={busy} onclick={() => add('security_key')}
      >Add a security key</button
    >
    <button type="button" onclick={() => logOut(false)}>Log out</button>
    <button type="button" onclick={() => logOut(true)}>Log out everywhere</button>
  </div>
{:else}
  <p>Loading security…</p>
{/if}
