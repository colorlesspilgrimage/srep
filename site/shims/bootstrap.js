// Loads the Leptos WASM bundle when present; shows a stub otherwise.
async function boot() {
  const root = document.getElementById('root');
  try {
    await import('/shims/srep-client.mjs');
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
