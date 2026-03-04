import { Capacitor } from '@capacitor/core';

export const CANONICAL_WEB_ORIGIN = 'https://nithya.fit';
export const AUTH_CALLBACK_PATH = '/auth/callback';
export const NATIVE_APP_SCHEME = 'com.rohith.nithya';
export const NATIVE_AUTH_CALLBACK = `${NATIVE_APP_SCHEME}://auth/callback`;
const OAUTH_PENDING_NEXT_KEY = '__nithya_oauth_next_path__';

const ensurePath = (value, fallback = '/dashboard') => {
  if (!value || typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  if (trimmed.startsWith('/')) return trimmed;

  try {
    const parsed = new URL(trimmed, CANONICAL_WEB_ORIGIN);
    if (parsed.origin !== CANONICAL_WEB_ORIGIN) return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch (_) {
    return fallback;
  }
};

export const normalizeAppPath = (value, fallback = '/dashboard') => ensurePath(value, fallback);

const getCapacitorRuntime = () => {
  if (typeof window !== 'undefined' && window?.Capacitor) {
    return window.Capacitor;
  }
  return Capacitor;
};

export const isNativeAndroid = () => {
  try {
    const cap = getCapacitorRuntime();
    const platform = typeof cap?.getPlatform === 'function' ? String(cap.getPlatform() || '') : '';
    const isNative = typeof cap?.isNativePlatform === 'function' ? !!cap.isNativePlatform() : false;
    const ua = typeof navigator !== 'undefined' ? String(navigator.userAgent || '').toLowerCase() : '';
    const androidUa = ua.includes('android');
    const localHostApp = typeof window !== 'undefined'
      && (window.location.hostname === 'localhost' || window.location.protocol === 'capacitor:');

    if (platform === 'android') return true;
    if (isNative && platform && platform !== 'web' && androidUa) return true;
    if (androidUa && localHostApp && !!(typeof window !== 'undefined' && window?.Capacitor)) return true;
    return false;
  } catch (_) {
    return false;
  }
};

export const buildOAuthRedirect = (nextPath = '/dashboard') => {
  const safeNext = ensurePath(nextPath, '/dashboard');

  if (isNativeAndroid()) {
    return NATIVE_AUTH_CALLBACK;
  }

  const webUrl = new URL(`${CANONICAL_WEB_ORIGIN}${AUTH_CALLBACK_PATH}`);
  webUrl.searchParams.set('next', safeNext);
  return webUrl.toString();
};

export const rememberOAuthNextPath = (nextPath = '/dashboard') => {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage?.setItem(OAUTH_PENDING_NEXT_KEY, ensurePath(nextPath, '/dashboard'));
  } catch (_) {
    // Best effort only.
  }
};

export const consumeRememberedOAuthNextPath = (fallback = '/dashboard') => {
  if (typeof window === 'undefined') return fallback;
  try {
    const value = window.sessionStorage?.getItem(OAUTH_PENDING_NEXT_KEY);
    window.sessionStorage?.removeItem(OAUTH_PENDING_NEXT_KEY);
    return ensurePath(value, fallback);
  } catch (_) {
    return fallback;
  }
};

export const buildResetPasswordRedirect = () => `${CANONICAL_WEB_ORIGIN}/reset-password`;

export const isAuthCallbackUrl = (urlLike) => {
  if (!urlLike) return false;
  try {
    const parsed = new URL(urlLike);
    const isNative = parsed.protocol === `${NATIVE_APP_SCHEME}:` && parsed.host === 'auth' && parsed.pathname === '/callback';
    const isWeb = parsed.pathname === AUTH_CALLBACK_PATH;
    return isNative || isWeb;
  } catch (_) {
    return false;
  }
};

const sanitizePathSegment = (value) => {
  const raw = String(value || '').replace(/^\/+/, '').split('/')[0].trim();
  if (!raw) return '';
  try {
    return encodeURIComponent(decodeURIComponent(raw));
  } catch (_) {
    return encodeURIComponent(raw);
  }
};

export const resolveInAppPathFromUrl = (urlLike) => {
  if (!urlLike) return null;
  try {
    const parsed = new URL(urlLike);

    if (parsed.protocol === `${NATIVE_APP_SCHEME}:`) {
      if (parsed.host === 'auth' && parsed.pathname === '/callback') return null;

      if (parsed.host === 'profile') {
        const username = sanitizePathSegment(parsed.pathname)
          || sanitizePathSegment(parsed.searchParams.get('username'));
        if (!username) return '/profile';
        return `/profile/${username}`;
      }

      const hostPart = parsed.host ? `/${parsed.host}` : '';
      const rawPath = `${hostPart}${parsed.pathname || ''}${parsed.search || ''}${parsed.hash || ''}`;
      return normalizeAppPath(rawPath, '/dashboard');
    }

    if (parsed.origin === CANONICAL_WEB_ORIGIN) {
      return normalizeAppPath(`${parsed.pathname}${parsed.search}${parsed.hash}`, '/dashboard');
    }
  } catch (_) {
    return null;
  }
  return null;
};

export const resolveNextPathFromCallback = (urlLike, fallback = '/dashboard') => {
  try {
    const parsed = new URL(urlLike);
    const next = parsed.searchParams.get('next');
    if (next) return ensurePath(next, fallback);
    return consumeRememberedOAuthNextPath(fallback);
  } catch (_) {
    return consumeRememberedOAuthNextPath(fallback);
  }
};
