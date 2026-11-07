// Loads the Leptos WASM bundle when present; shows a stub otherwise.
async function boot() {
  const root = document.getElementById('root');
  try {
    const wasm = await import('/pkg/srep_ui.js');
    if (typeof wasm.hydrate === 'function') {
      await wasm.default('/pkg/srep_ui_bg.wasm');
      wasm.hydrate();
      return;
    }
  } catch {
    /* WASM not built yet */
  }
  root.innerHTML =
    '<main style="padding:2rem;max-width:40rem"><h1>srep v2</h1><p>Rust API is running. Build the Leptos frontend with <code>cargo build -p srep-ui --target wasm32-unknown-unknown</code>.</p></main>';
}
boot();
