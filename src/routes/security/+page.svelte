<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { onMount } from 'svelte';
  import { apiFetch } from '#lib/client/api.js';
  import { enroll, signOut, type Kind } from '#lib/client/ceremonies.js';
  import { messageFor } from '#lib/client/messages.js';

  type Credential = {
    id: string;
    nickname: string;
    kind: Kind;
    createdAt: number;
    lastUsedAt: number | null;
  };

  let credentials = $state<Credential[]>([]);
  let error = $state('');
  let status = $state('');
  let confirmingId = $state<string | null>(null);
  let editingId = $state<string | null>(null);
  let editValue = $state('');
  let newNickname = $state('');
  let busy = $state(false);

  function formatTime(value: number | null): string {
    return value === null ? 'never' : new Date(value).toLocaleString();
  }

  async function load(): Promise<void> {
    const result = await apiFetch<{ credentials: Credential[] }>('/api/auth/credentials');
    if (result.ok) {
      credentials = result.body.credentials;
    } else {
      error = messageFor(result.error);
    }
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
    status = 'Credential removed.';
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
    status = '';
    const result = await enroll('/api/auth/credentials', { kind, nickname: newNickname });
    busy = false;
    if (result.ok) {
      newNickname = '';
      status = 'Credential added.';
      await load();
    } else {
      error = result.message;
    }
  }

  async function logOut(everywhere: boolean): Promise<void> {
    await signOut(everywhere);
    await goto(resolve('/login'), { invalidateAll: true });
  }

  onMount(load);
</script>

<svelte:head><title>srep security</title></svelte:head>
<main>
  <h1>Security</h1>
  <p><a href={resolve('/')}>Home</a></p>
  {#if credentials.length === 1}
    <p role="status">You have one credential. Add a second one.</p>
  {/if}
  <table>
    <thead>
      <tr><th>Nickname</th><th>Type</th><th>Created</th><th>Last used</th><th>Actions</th></tr>
    </thead>
    <tbody>
      {#each credentials as credential (credential.id)}
        <tr>
          <td>
            {#if editingId === credential.id}
              <label>
                New nickname
                <input type="text" maxlength="64" bind:value={editValue} />
              </label>
            {:else}
              {credential.nickname}
            {/if}
          </td>
          <td>{credential.kind === 'passkey' ? 'Passkey' : 'Security key'}</td>
          <td>{formatTime(credential.createdAt)}</td>
          <td>{formatTime(credential.lastUsedAt)}</td>
          <td>
            {#if editingId === credential.id}
              <button type="button" onclick={() => saveRename(credential.id)}>Save</button>
              <button type="button" onclick={() => (editingId = null)}>Cancel</button>
            {:else}
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
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
  {#if error !== ''}<p class="error" role="alert">{error}</p>{/if}
  {#if status !== ''}<p role="status">{status}</p>{/if}

  <h2>Add a credential</h2>
  <label class="field">
    Nickname for the new credential
    <input type="text" autocomplete="off" maxlength="64" bind:value={newNickname} />
  </label>
  <button type="button" disabled={busy} onclick={() => add('passkey')}>Add a passkey</button>
  <button type="button" disabled={busy} onclick={() => add('security_key')}>
    Add a security key
  </button>

  <h2>Session</h2>
  <button type="button" onclick={() => logOut(false)}>Log out</button>
  <button type="button" onclick={() => logOut(true)}>Log out everywhere</button>
</main>
