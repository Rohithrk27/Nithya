import { lazy } from 'react';

const CHUNK_RELOAD_FLAG = '__nithya_chunk_retry_reloaded__';
const CACHE_PREFIX = 'nithya-';

const readReloadFlag = () => {
  try {
    return window.sessionStorage?.getItem(CHUNK_RELOAD_FLAG) === '1';
  } catch (_) {
    return false;
  }
};

const markReloadFlag = () => {
  try {
    window.sessionStorage?.setItem(CHUNK_RELOAD_FLAG, '1');
  } catch (_) {
    // Ignore storage availability issues.
  }
};

const clearReloadFlag = () => {
  try {
    window.sessionStorage?.removeItem(CHUNK_RELOAD_FLAG);
  } catch (_) {
    // Ignore storage availability issues.
  }
};

const isChunkLoadError = (error) => {
  const message = String(error?.message || '').toLowerCase();
  return (
    message.includes('failed to fetch dynamically imported module')
    || message.includes('importing a module script failed')
    || message.includes('loading chunk')
    || message.includes('chunkloaderror')
  );
};

const clearAppCaches = async () => {
  if (typeof window === 'undefined' || !('caches' in window)) return;
  try {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => String(key || '').startsWith(CACHE_PREFIX))
        .map((key) => caches.delete(key))
    );
  } catch (_) {
    // Best-effort cache cleanup.
  }
};

const unregisterServiceWorkers = async () => {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((reg) => reg.unregister()));
  } catch (_) {
    // Best-effort SW cleanup.
  }
};

const hardReloadWithBypass = () => {
  if (typeof window === 'undefined') return;
  try {
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set('__nithya_reload', String(Date.now()));
    window.location.replace(nextUrl.toString());
  } catch (_) {
    window.location.reload();
  }
};

export function lazyWithRetry(importer) {
  return lazy(async () => {
    try {
      const mod = await importer();
      if (typeof window !== 'undefined') clearReloadFlag();
      return mod;
    } catch (error) {
      if (typeof window === 'undefined' || !isChunkLoadError(error)) {
        throw error;
      }

      const alreadyRetried = readReloadFlag();
      if (!alreadyRetried) {
        markReloadFlag();
        await Promise.allSettled([
          clearAppCaches(),
          unregisterServiceWorkers(),
        ]);
        hardReloadWithBypass();
        return new Promise(() => {});
      }

      throw error;
    }
  });
}
