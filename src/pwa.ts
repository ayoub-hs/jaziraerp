/**
 * PWA service-worker wiring. Production only.
 * - Kill switch: visiting /?nosw=1 unregisters the worker and clears its caches.
 * - Non-secure contexts (not https, not localhost): skip silently with one log line.
 * - Updates: never auto-applied; onUpdate callback shows a "reload" banner instead.
 */
export function initPwa(onUpdate: (reload: () => void) => void): void {
  if (typeof window === 'undefined') return;
  if (!import.meta.env.PROD) return;
  if (!('serviceWorker' in navigator)) return;

  const isSecure =
    window.location.protocol === 'https:' ||
    ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
  if (!isSecure) {
    console.log('[pwa] service worker skipped: page is not a secure context');
    return;
  }

  const params = new URLSearchParams(window.location.search);
  if (params.get('nosw') === '1') {
    navigator.serviceWorker
      .getRegistrations()
      .then(regs => Promise.all(regs.map(r => r.unregister())))
      .then(() => caches.keys())
      .then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => console.log('[pwa] service worker unregistered and caches cleared (?nosw=1)'))
      .catch(err => console.warn('[pwa] kill switch failed:', err));
    return;
  }

  navigator.serviceWorker
    .register('/sw.js')
    .then(reg => {
      const waiting = reg.waiting;
      if (waiting) {
        onUpdate(() => applyUpdate(reg));
        return;
      }
      reg.addEventListener('updatefound', () => {
        const worker = reg.installing;
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            onUpdate(() => applyUpdate(reg));
          }
        });
      });
    })
    .catch(err => console.warn('[pwa] service worker registration failed:', err));
}

function applyUpdate(reg: ServiceWorkerRegistration): void {
  const worker = reg.waiting;
  if (!worker) {
    window.location.reload();
    return;
  }
  const onControllerChange = () => {
    navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
    window.location.reload();
  };
  navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
  worker.postMessage({ type: 'SKIP_WAITING' });
}
