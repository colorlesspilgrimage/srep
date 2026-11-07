// Contract: register the static-asset service worker after load. No offline API cache.
export function registerPwaServiceWorker(): void {
  if (!('serviceWorker' in navigator)) {
    return;
  }
  void navigator.serviceWorker.register('/service-worker.js').catch(() => {});
}
