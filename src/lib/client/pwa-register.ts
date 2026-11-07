export function registerPwaServiceWorker(): void {
  if (!('serviceWorker' in navigator)) {
    return;
  }
  void navigator.serviceWorker.register('/service-worker.js').catch(() => {});
}
