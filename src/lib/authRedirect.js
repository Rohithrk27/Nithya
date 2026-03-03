import { Capacitor } from '@capacitor/core';

export const CANONICAL_WEB_ORIGIN = 'https://nithya.fit';
export const AUTH_CALLBACK_PATH = '/auth/callback';
export const NATIVE_AUTH_CALLBACK = 'com.rohith.nitya://auth/callback';

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

export const isNativeAndroid = () => {
  try {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
  } catch (_) {
    return false;
  }
};

export const buildOAuthRedirect = (nextPath = '/dashboard') => {
  const safeNext = ensurePath(nextPath, '/dashboard');

  if (isNativeAndroid()) {
    const nativeUrl = new URL(NATIVE_AUTH_CALLBACK);
    nativeUrl.searchParams.set('next', safeNext);
    return nativeUrl.toString();
  }

  const webUrl = new URL(`${CANONICAL_WEB_ORIGIN}${AUTH_CALLBACK_PATH}`);
  webUrl.searchParams.set('next', safeNext);
  return webUrl.toString();
};

export const buildResetPasswordRedirect = () => `${CANONICAL_WEB_ORIGIN}/reset-password`;

export const isAuthCallbackUrl = (urlLike) => {
  if (!urlLike) return false;
  try {
    const parsed = new URL(urlLike);
    const isNative = parsed.protocol === 'com.rohith.nitya:' && parsed.host === 'auth' && parsed.pathname === '/callback';
    const isWeb = parsed.pathname === AUTH_CALLBACK_PATH;
    return isNative || isWeb;
  } catch (_) {
    return false;
  }
};

export const resolveNextPathFromCallback = (urlLike, fallback = '/dashboard') => {
  try {
    const parsed = new URL(urlLike);
    const next = parsed.searchParams.get('next');
    return ensurePath(next, fallback);
  } catch (_) {
    return fallback;
  }
};
