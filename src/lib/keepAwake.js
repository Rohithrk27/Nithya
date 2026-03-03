import { KeepAwake } from '@capacitor-community/keep-awake';
import { isNativeAndroid } from '@/lib/authRedirect';

let webWakeLock = null;

const requestWebWakeLock = async () => {
  if (typeof navigator === 'undefined' || !navigator?.wakeLock?.request) return false;
  try {
    webWakeLock = await navigator.wakeLock.request('screen');
    webWakeLock.addEventListener?.('release', () => {
      webWakeLock = null;
    });
    return true;
  } catch (_) {
    return false;
  }
};

export const keepScreenAwake = async () => {
  if (isNativeAndroid()) {
    try {
      await KeepAwake.keepAwake();
      return true;
    } catch (_) {
      // Fall through to wake lock API fallback.
    }
  }
  return requestWebWakeLock();
};

export const releaseScreenAwake = async () => {
  if (isNativeAndroid()) {
    try {
      await KeepAwake.allowSleep();
    } catch (_) {
      // Ignore plugin errors and continue releasing web lock if any.
    }
  }

  if (webWakeLock) {
    try {
      await webWakeLock.release();
    } catch (_) {
      // Ignore.
    } finally {
      webWakeLock = null;
    }
  }
};

