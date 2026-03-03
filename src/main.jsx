import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'
import { App as CapacitorApp } from '@capacitor/app'
import { LocalNotifications } from '@capacitor/local-notifications'
import { supabase } from '@/lib/supabase'
import { AUTH_CALLBACK_PATH, isAuthCallbackUrl, isNativeAndroid, normalizeAppPath, resolveNextPathFromCallback } from '@/lib/authRedirect'
import { setupNativeCapabilities } from '@/lib/nativeCapabilities'

const OAUTH_NATIVE_HANDOFF_KEY = '__nithya_native_oauth_handoff__';

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

const tryHandoffWebCallbackToNative = (urlLike) => {
  if (typeof window === 'undefined') return false;
  if (isNativeAndroid()) return false;

  const ua = String(navigator?.userAgent || '').toLowerCase();
  if (!ua.includes('android')) return false;

  const callbackUrl = asWebCallbackUrl(urlLike);
  if (!callbackUrl) return false;
  if (callbackUrl.pathname !== AUTH_CALLBACK_PATH) return false;

  const hasOAuthPayload = callbackUrl.searchParams.has('code')
    || callbackUrl.hash.includes('access_token=')
    || callbackUrl.searchParams.has('error')
    || callbackUrl.searchParams.has('error_description');
  if (!hasOAuthPayload) return false;

  // Web login callbacks always include next=... in this app.
  // If next is missing on Android browser, this likely came from app OAuth fallback.
  if (callbackUrl.searchParams.has('next')) return false;

  try {
    const previousAttempt = window.sessionStorage?.getItem(OAUTH_NATIVE_HANDOFF_KEY);
    if (previousAttempt === callbackUrl.toString()) return false;
    window.sessionStorage?.setItem(OAUTH_NATIVE_HANDOFF_KEY, callbackUrl.toString());
  } catch (_) {
    // Best effort only.
  }

  const nativeCallback = new URL('com.rohith.nitya://auth/callback');
  nativeCallback.search = callbackUrl.search;
  nativeCallback.hash = callbackUrl.hash;
  window.location.replace(nativeCallback.toString());
  return true;
};

const finishOAuthCallback = async (urlLike) => {
  const callbackUrl = asWebCallbackUrl(urlLike);
  if (!callbackUrl) return false;
  if (!isAuthCallbackUrl(callbackUrl.toString())) return false;
  try {
    window.sessionStorage?.removeItem(OAUTH_NATIVE_HANDOFF_KEY);
  } catch (_) {
    // Best effort only.
  }

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

    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData?.session) {
      throw new Error('OAuth callback did not create a session.');
    }
  } catch (_) {
    window.history.replaceState({}, '', '/login?oauth_error=callback_failed');
    window.dispatchEvent(new PopStateEvent('popstate'));
    return true;
  }

  window.dispatchEvent(new CustomEvent('nithya-auth-complete'));
  window.history.replaceState({}, '', normalizeAppPath(nextPath, '/dashboard'));
  window.dispatchEvent(new PopStateEvent('popstate'));
  return true;
};

const setupNativeDeepLinkListener = () => {
  if (!isNativeAndroid()) return;
  if (typeof CapacitorApp?.addListener !== 'function') return;
  CapacitorApp.addListener('appUrlOpen', ({ url }) => {
    if (!url) return;
    void finishOAuthCallback(url);
  });
};

const setupNativeBackButtonHandler = () => {
  if (!isNativeAndroid()) return;
  if (typeof CapacitorApp?.addListener !== 'function') return;

  CapacitorApp.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack || window.history.length > 1) {
      window.history.back();
      return;
    }
    if (typeof CapacitorApp.exitApp === 'function') {
      CapacitorApp.exitApp();
    }
  });
};

const setupLocalNotificationRouting = () => {
  if (!isNativeAndroid()) return;
  if (typeof LocalNotifications?.addListener !== 'function') return;
  LocalNotifications.addListener('localNotificationActionPerformed', () => {
    window.history.replaceState({}, '', '/dashboard');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
};

const processNativeLaunchUrl = async () => {
  if (!isNativeAndroid()) return false;
  if (typeof CapacitorApp?.getLaunchUrl !== 'function') return false;
  try {
    const launchData = await CapacitorApp.getLaunchUrl();
    if (!launchData?.url) return false;
    return finishOAuthCallback(launchData.url);
  } catch (_) {
    return false;
  }
};

const registerServiceWorker = () => {
  if (isNativeAndroid()) return;
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
  let disposeNativeCapabilities = () => {};
  if (typeof window !== 'undefined') {
    if (isNativeAndroid()) {
      document.body?.classList.add('native-app');
      disposeNativeCapabilities = setupNativeCapabilities();
    } else {
      document.body?.classList.remove('native-app');
    }

    const url = new URL(window.location.href);
    if (url.searchParams.has('__nithya_reload')) {
      url.searchParams.delete('__nithya_reload');
      const cleaned = `${url.pathname}${url.search}${url.hash}`;
      window.history.replaceState({}, '', cleaned);
    }

    setupNativeDeepLinkListener();
    setupNativeBackButtonHandler();
    setupLocalNotificationRouting();
    const handledLaunchUrl = await processNativeLaunchUrl();
    if (handledLaunchUrl) {
      // Launch URL consumed. No need to re-handle current href.
      // Continue normal app bootstrap.
    } else if (tryHandoffWebCallbackToNative(window.location.href)) {
      return;
    }
    if (!handledLaunchUrl) {
      await finishOAuthCallback(window.location.href);
    }
  }

  ReactDOM.createRoot(document.getElementById('root')).render(
    <App />
  );

  registerServiceWorker();

  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', () => {
      disposeNativeCapabilities();
    }, { once: true });
  }
};

void bootstrap();
