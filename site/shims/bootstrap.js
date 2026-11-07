// Loads the Leptos WASM bundle when present; shows a stub otherwise.
function wireCredentialRename() {
  document.body.addEventListener('click', async (ev) => {
    const el = ev.target?.closest?.('.srep-rename-save');
    if (!el || !globalThis.srepClient?.renameCredential) return;
    const id = el.id?.startsWith('rename-btn-') ? el.id.slice('rename-btn-'.length) : '';
    const input = document.getElementById('cred-rename-input');
    const nick = input?.value?.trim() ?? '';
    if (!id || !nick) return;
    const result = await globalThis.srepClient.renameCredential(id, nick);
    if (result.ok) {
      globalThis.location.reload();
      return;
    }
    const host = document.querySelector('[role=tabpanel][aria-label="Security"] .error[role=alert]');
    if (host) {
      host.textContent = result.message;
    }
  });
}

async function boot() {
  const root = document.getElementById('root');
  try {
    await import('/shims/srep-client.mjs');
    wireCredentialRename();
  } catch (e) {
    console.error('client bundle failed', e);
  }
  try {
    const wasm = await import('/pkg/srep_ui.js');
    if (typeof wasm.hydrate === 'function') {
      const response = await fetch('/pkg/srep_ui_bg.wasm');
      const bytes = await response.arrayBuffer();
      await wasm.default(bytes);
      wasm.hydrate();
      return;
    }
  } catch (e) {
    console.error('WASM bundle failed', e);
  }
  root.innerHTML =
    '<main style="padding:2rem;max-width:40rem"><h1>srep v2</h1><p>Rust API is running. Build the Leptos frontend with <code>cargo build -p srep-ui --target wasm32-unknown-unknown</code>.</p></main>';
}
boot();
