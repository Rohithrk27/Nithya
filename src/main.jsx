import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'
import { supabase } from '@/lib/supabase'
import { AUTH_CALLBACK_PATH, isAuthCallbackUrl, normalizeAppPath, resolveNextPathFromCallback } from '@/lib/authRedirect'

const asWebCallbackUrl = (urlLike) => {
  if (!urlLike) return null;
  try {
    const parsed = new URL(urlLike);
    if (parsed.protocol === 'com.rohith.nitya:' && parsed.host === 'auth' && parsed.pathname === '/callback') {
      return new URL(`${AUTH_CALLBACK_PATH}${parsed.search}${parsed.hash}`, window.location.origin);
    }
    return parsed;
  } catch (_) {
    return null;
  }
};

const finishOAuthCallback = async (urlLike) => {
  const callbackUrl = asWebCallbackUrl(urlLike);
  if (!callbackUrl) return false;
  if (!isAuthCallbackUrl(callbackUrl.toString())) return false;

  const nextPath = resolveNextPathFromCallback(callbackUrl.toString(), '/dashboard');
  const code = callbackUrl.searchParams.get('code');
  const oauthError = callbackUrl.searchParams.get('error_description') || callbackUrl.searchParams.get('error');

  if (oauthError) {
    const loginPath = `/login?oauth_error=${encodeURIComponent(oauthError)}`;
    window.history.replaceState({}, '', loginPath);
    window.dispatchEvent(new PopStateEvent('popstate'));
    return true;
  }

  try {
    if (code) {
      await supabase.auth.exchangeCodeForSession(code);
    } else {
      const hashParams = new URLSearchParams(String(callbackUrl.hash || '').replace(/^#/, ''));
      const access_token = hashParams.get('access_token');
      const refresh_token = hashParams.get('refresh_token');
      if (access_token && refresh_token) {
        await supabase.auth.setSession({ access_token, refresh_token });
      }
    }
  } catch (_) {
    window.history.replaceState({}, '', '/login?oauth_error=callback_failed');
    window.dispatchEvent(new PopStateEvent('popstate'));
    return true;
  }

  window.history.replaceState({}, '', normalizeAppPath(nextPath, '/dashboard'));
  window.dispatchEvent(new PopStateEvent('popstate'));
  return true;
};

const setupNativeDeepLinkListener = () => {
  const addListener = window?.Capacitor?.Plugins?.App?.addListener;
  if (typeof addListener !== 'function') return;
  addListener('appUrlOpen', ({ url }) => {
    if (!url) return;
    void finishOAuthCallback(url);
  });
};

const setupNativeBackButtonHandler = () => {
  const appPlugin = window?.Capacitor?.Plugins?.App;
  if (typeof appPlugin?.addListener !== 'function') return;

  appPlugin.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack || window.history.length > 1) {
      window.history.back();
      return;
    }
    if (typeof appPlugin.exitApp === 'function') {
      appPlugin.exitApp();
    }
  });
};

const registerServiceWorker = () => {
  if (!('serviceWorker' in navigator)) return;

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

    navigator.serviceWorker.getRegistrations()
      .then((regs) => Promise.all(regs.map((r) => r.unregister())))
      .catch(() => {});

    if ('caches' in window) {
      caches.keys()
        .then((keys) => Promise.all(keys.filter((k) => k.startsWith('nithya-')).map((k) => caches.delete(k))))
        .catch(() => {});
    }
  });
};

const bootstrap = async () => {
  if (typeof window !== 'undefined') {
    const url = new URL(window.location.href);
    if (url.searchParams.has('__nithya_reload')) {
      url.searchParams.delete('__nithya_reload');
      const cleaned = `${url.pathname}${url.search}${url.hash}`;
      window.history.replaceState({}, '', cleaned);
    }

    setupNativeDeepLinkListener();
    setupNativeBackButtonHandler();
    await finishOAuthCallback(window.location.href);
  }

  ReactDOM.createRoot(document.getElementById('root')).render(
    <App />
  );

  registerServiceWorker();
};

void bootstrap();
