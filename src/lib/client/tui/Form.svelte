<script lang="ts">
  // Contract: one text field. An empty value does not call onSubmit.

  type Props = {
    idPrefix: string;
    name: string;
    onSubmit: (value: string) => void;
  };

  let { idPrefix, name, onSubmit }: Props = $props();

  let value = $state('');
  let error = $state('');

  const fieldsOk = $derived(/^[a-z]{1,16}$/.test(idPrefix) && /^[a-z0-9-]{1,32}$/.test(name));
  const inputId = $derived(`tui-form-${idPrefix}-${name}`);
  const errorId = $derived(`${inputId}-error`);

  function submitForm(event: SubmitEvent): void {
    event.preventDefault();
    const trimmed = value.trim();
    if (trimmed === '') {
      error = 'Enter a value.';
      return;
    }
    error = '';
    onSubmit(trimmed);
  }
</script>

{#if fieldsOk}
  <form class="tui-form" onsubmit={submitForm}>
    <label for={inputId}>Value</label>
    <input
      id={inputId}
      type="text"
      {name}
      maxlength="80"
      autocomplete="off"
      bind:value
      aria-invalid={error !== ''}
      aria-describedby={error === '' ? undefined : errorId}
    />
    {#if error !== ''}
      <p id={errorId} role="alert">{error}</p>
    {/if}
    <button type="submit">Submit</button>
  </form>
{/if}
