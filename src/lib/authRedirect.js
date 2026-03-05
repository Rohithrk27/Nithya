import { Capacitor } from '@capacitor/core';

const FALLBACK_WEB_ORIGIN = 'https://nithya.fit';
const trimTrailingSlash = (value = '') => String(value).replace(/\/+$/, '');
const toOrigin = (value) => {
  if (!value) return '';
  try {
    return new URL(String(value)).origin;
  } catch (_) {
    return '';
  }
};
const configuredWebOrigin = toOrigin(trimTrailingSlash(
  (typeof import.meta !== 'undefined' && import.meta?.env?.VITE_PUBLIC_WEB_URL)
    ? import.meta.env.VITE_PUBLIC_WEB_URL
    : '',
));
export const CANONICAL_WEB_ORIGIN = configuredWebOrigin || FALLBACK_WEB_ORIGIN;
export const AUTH_CALLBACK_PATH = '/auth/callback';
export const NATIVE_APP_SCHEME = 'com.rohith.nithya';
export const NATIVE_AUTH_CALLBACK = `${NATIVE_APP_SCHEME}://auth/callback`;
const OAUTH_PENDING_NEXT_KEY = '__nithya_oauth_next_path__';

const getRuntimeOrigin = () => {
  if (typeof window === 'undefined') return '';
  try {
    return toOrigin(window.location.origin);
  } catch (_) {
    return '';
  }
};

const getPreferredWebOrigin = () => {
  const runtimeOrigin = getRuntimeOrigin();
  if (runtimeOrigin) return runtimeOrigin;
  return CANONICAL_WEB_ORIGIN;
};

const getAllowedWebOrigins = () => {
  const origins = new Set([CANONICAL_WEB_ORIGIN]);
  const runtimeOrigin = getRuntimeOrigin();
  if (runtimeOrigin) origins.add(runtimeOrigin);
  return origins;
};

const ensurePath = (value, fallback = '/dashboard') => {
  if (!value || typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  if (trimmed.startsWith('/')) return trimmed;

  try {
    const parsed = new URL(trimmed, CANONICAL_WEB_ORIGIN);
    if (!getAllowedWebOrigins().has(parsed.origin)) return fallback;
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

    if (platform === 'android') return true;
    if (isNative && platform === 'android') return true;
    if (typeof window !== 'undefined' && window.location.protocol === 'capacitor:' && isNative) return true;
    return false;
  } catch (_) {
    return false;
  }
};

export const buildOAuthRedirect = (nextPath = '/dashboard') => {
  const safeNext = ensurePath(nextPath, '/dashboard');
  const origin = getPreferredWebOrigin();

  if (isNativeAndroid()) {
    return NATIVE_AUTH_CALLBACK;
  }

  // Use origin root callback for web so localhost works even if only the origin
  // (not /auth/callback) is allow-listed in Supabase redirect URLs.
  const webUrl = new URL(`${origin}/`);
  webUrl.searchParams.set('next', safeNext);
  // Bridge origin helps recover local dev flow if provider callback is forced
  // to production by auth configuration.
  webUrl.searchParams.set('bridge_origin', origin);
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

export const buildResetPasswordRedirect = () => `${getPreferredWebOrigin()}/reset-password`;

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

    if (getAllowedWebOrigins().has(parsed.origin)) {
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
