import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
)

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    if (import.meta.env.PROD) {
      let hasRefreshedForNewWorker = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (hasRefreshedForNewWorker) return;
        hasRefreshedForNewWorker = true;
        window.location.reload();
      });

      navigator.serviceWorker.register('/sw.js')
        .then((reg) => {
          void reg.update();

          if (reg.waiting) {
            reg.waiting.postMessage({ type: 'SKIP_WAITING' });
          }

          reg.addEventListener('updatefound', () => {
            const nextWorker = reg.installing;
            if (!nextWorker) return;
            nextWorker.addEventListener('statechange', () => {
              if (nextWorker.state === 'installed' && navigator.serviceWorker.controller) {
                nextWorker.postMessage({ type: 'SKIP_WAITING' });
              }
            });
          });
        })
        .catch(() => {});
      return;
    }

    // Dev mode: avoid stale caches/scripts during rapid local iteration.
    navigator.serviceWorker.getRegistrations()
      .then((regs) => Promise.all(regs.map((r) => r.unregister())))
      .catch(() => {});

    if ('caches' in window) {
      caches.keys()
        .then((keys) => Promise.all(keys.filter((k) => k.startsWith('nithya-')).map((k) => caches.delete(k))))
        .catch(() => {});
    }
  });
}
