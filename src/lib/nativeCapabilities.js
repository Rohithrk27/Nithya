import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { Keyboard } from '@capacitor/keyboard';
import { Network } from '@capacitor/network';
import { isNativeAndroid } from '@/lib/authRedirect';
import { toastInfo } from '@/lib/toast';

const NATIVE_ONLINE_KEY = '__NITHYA_NATIVE_ONLINE__';

const setNativeOnline = (connected) => {
  if (typeof window === 'undefined') return;
  window[NATIVE_ONLINE_KEY] = !!connected;
  window.dispatchEvent(new CustomEvent('nithya-network-status', {
    detail: { connected: !!connected },
  }));
};

const notifyHaptic = (type = 'light') => {
  switch (type) {
    case 'success':
      return Haptics.notification({ type: NotificationType.Success });
    case 'warning':
      return Haptics.notification({ type: NotificationType.Warning });
    case 'error':
      return Haptics.notification({ type: NotificationType.Error });
    case 'medium':
      return Haptics.impact({ style: ImpactStyle.Medium });
    case 'heavy':
      return Haptics.impact({ style: ImpactStyle.Heavy });
    default:
      return Haptics.impact({ style: ImpactStyle.Light });
  }
};

const setupNativeTapHaptics = () => {
  if (typeof document === 'undefined') return () => {};

  let lastImpactTs = 0;
  const onPointerDown = (event) => {
    const target = event?.target;
    if (!(target instanceof Element)) return;
    const interactive = target.closest('button, a, [role="button"], .tap-target');
    if (!interactive) return;

    const now = Date.now();
    if (now - lastImpactTs < 65) return;
    lastImpactTs = now;
    void notifyHaptic('light').catch(() => {});
  };

  const onCustomHaptic = (event) => {
    const kind = String(event?.detail?.type || 'light').toLowerCase();
    void notifyHaptic(kind).catch(() => {});
  };

  document.addEventListener('pointerdown', onPointerDown, { passive: true });
  window.addEventListener('nithya-haptic', onCustomHaptic);

  return () => {
    document.removeEventListener('pointerdown', onPointerDown);
    window.removeEventListener('nithya-haptic', onCustomHaptic);
  };
};

const setupNativeKeyboard = () => {
  if (typeof document === 'undefined') return () => {};

  const cleanups = [];
  const onShow = () => document.body?.classList.add('keyboard-open');
  const onHide = () => document.body?.classList.remove('keyboard-open');

  Promise.resolve(Keyboard.addListener('keyboardDidShow', onShow))
    .then((handle) => {
      if (handle?.remove) cleanups.push(() => { void handle.remove(); });
    })
    .catch(() => {});

  Promise.resolve(Keyboard.addListener('keyboardDidHide', onHide))
    .then((handle) => {
      if (handle?.remove) cleanups.push(() => { void handle.remove(); });
    })
    .catch(() => {});

  // Keep input fields visible and avoid iOS-like accessory overlays in APK.
  void Keyboard.setResizeMode({ mode: 'body' }).catch(() => {});
  void Keyboard.setAccessoryBarVisible({ isVisible: false }).catch(() => {});

  return () => {
    document.body?.classList.remove('keyboard-open');
    cleanups.forEach((fn) => fn());
  };
};

const setupNativeNetwork = () => {
  let listenerHandle = null;
  let hasInitialState = false;
  let previousConnected = null;

  const applyStatus = (connected) => {
    setNativeOnline(connected);
    if (!hasInitialState) {
      hasInitialState = true;
      previousConnected = connected;
      return;
    }

    if (previousConnected === connected) return;
    previousConnected = connected;
    toastInfo(connected ? 'Back online.' : 'You are offline. Some features may be limited.', {
      ttl: 2600,
    });
  };

  void Network.getStatus()
    .then((status) => applyStatus(!!status?.connected))
    .catch(() => {});

  void Promise.resolve(Network.addListener('networkStatusChange', (status) => {
    applyStatus(!!status?.connected);
  }))
    .then((handle) => {
      listenerHandle = handle;
    })
    .catch(() => {});

  return () => {
    if (listenerHandle?.remove) {
      void listenerHandle.remove();
    }
  };
};

const setupNativePullToRefresh = () => {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {};

  const MAX_PULL = 96;
  const TRIGGER_PULL = 68;
  const TRIGGER_COOLDOWN_MS = 1200;
  let startY = 0;
  let currentPull = 0;
  let pulling = false;
  let refreshing = false;
  let lastTriggerAt = 0;
  let fallbackTimeoutId = null;

  const indicator = document.createElement('div');
  indicator.id = 'nithya-native-ptr';
  indicator.setAttribute('aria-hidden', 'true');
  indicator.style.position = 'fixed';
  indicator.style.left = '50%';
  indicator.style.top = 'calc(env(safe-area-inset-top, 0px) + 8px)';
  indicator.style.transform = 'translate(-50%, -64px)';
  indicator.style.transition = 'transform 160ms ease, opacity 160ms ease';
  indicator.style.opacity = '0';
  indicator.style.zIndex = '9999';
  indicator.style.pointerEvents = 'none';
  indicator.style.padding = '6px 10px';
  indicator.style.borderRadius = '999px';
  indicator.style.border = '1px solid rgba(56,189,248,0.35)';
  indicator.style.background = 'rgba(8,47,73,0.88)';
  indicator.style.color = '#67E8F9';
  indicator.style.fontSize = '11px';
  indicator.style.fontWeight = '700';
  indicator.style.letterSpacing = '0.02em';
  indicator.style.backdropFilter = 'blur(8px)';
  indicator.textContent = 'Pull to refresh';
  document.body.appendChild(indicator);

  const getScrollTop = () => Math.max(
    Number(window.scrollY || 0),
    Number(document.documentElement?.scrollTop || 0),
    Number(document.body?.scrollTop || 0),
  );

  const setPull = (next) => {
    currentPull = Math.max(0, Math.min(MAX_PULL, Number(next || 0)));
    if (refreshing) {
      indicator.style.transform = `translate(-50%, ${Math.max(8, currentPull * 0.15)}px)`;
      indicator.style.opacity = '1';
      return;
    }
    if (currentPull <= 0) {
      indicator.style.transform = 'translate(-50%, -64px)';
      indicator.style.opacity = '0';
      indicator.textContent = 'Pull to refresh';
      return;
    }
    indicator.style.transform = `translate(-50%, ${Math.max(-8, -64 + currentPull)}px)`;
    indicator.style.opacity = String(Math.min(1, 0.18 + (currentPull / TRIGGER_PULL)));
    indicator.textContent = currentPull >= TRIGGER_PULL ? 'Release to refresh' : 'Pull to refresh';
  };

  const resetPull = () => {
    pulling = false;
    setPull(0);
  };

  const finishRefresh = () => {
    refreshing = false;
    if (fallbackTimeoutId) {
      clearTimeout(fallbackTimeoutId);
      fallbackTimeoutId = null;
    }
    indicator.textContent = 'Pull to refresh';
    setPull(0);
  };

  const onRefreshComplete = () => finishRefresh();

  const onTouchStart = (event) => {
    if (refreshing) return;
    if (!event?.touches || event.touches.length !== 1) return;
    if (getScrollTop() > 2) {
      pulling = false;
      return;
    }
    startY = Number(event.touches[0]?.clientY || 0);
    pulling = startY <= 140;
  };

  const onTouchMove = (event) => {
    if (!pulling || refreshing) return;
    if (!event?.touches || event.touches.length !== 1) return;

    if (getScrollTop() > 2) {
      resetPull();
      return;
    }

    const y = Number(event.touches[0]?.clientY || startY);
    const delta = y - startY;
    if (delta <= 0) {
      setPull(0);
      return;
    }

    // Dampen drag distance for native-like pull resistance.
    const eased = Math.min(MAX_PULL, delta * 0.45);
    setPull(eased);
    if (eased > 0 && typeof event.preventDefault === 'function') {
      event.preventDefault();
    }
  };

  const onTouchEnd = () => {
    if (!pulling) return;
    pulling = false;

    const now = Date.now();
    const canTrigger = currentPull >= TRIGGER_PULL && (now - lastTriggerAt) > TRIGGER_COOLDOWN_MS;
    if (!canTrigger) {
      setPull(0);
      return;
    }

    lastTriggerAt = now;
    refreshing = true;
    indicator.textContent = 'Refreshing...';
    setPull(TRIGGER_PULL);
    void notifyHaptic('medium').catch(() => {});

    const refreshEvent = new CustomEvent('nithya-pull-refresh', {
      cancelable: true,
      detail: { source: 'gesture' },
    });
    const handled = !window.dispatchEvent(refreshEvent);
    if (!handled) {
      window.location.reload();
      return;
    }

    fallbackTimeoutId = setTimeout(() => {
      finishRefresh();
    }, 6500);
  };

  window.addEventListener('touchstart', onTouchStart, { passive: true });
  window.addEventListener('touchmove', onTouchMove, { passive: false });
  window.addEventListener('touchend', onTouchEnd, { passive: true });
  window.addEventListener('touchcancel', onTouchEnd, { passive: true });
  window.addEventListener('nithya-pull-refresh-complete', onRefreshComplete);

  return () => {
    window.removeEventListener('touchstart', onTouchStart);
    window.removeEventListener('touchmove', onTouchMove);
    window.removeEventListener('touchend', onTouchEnd);
    window.removeEventListener('touchcancel', onTouchEnd);
    window.removeEventListener('nithya-pull-refresh-complete', onRefreshComplete);
    if (fallbackTimeoutId) clearTimeout(fallbackTimeoutId);
    if (indicator.parentNode) indicator.parentNode.removeChild(indicator);
  };
};

export const setupNativeCapabilities = () => {
  if (!isNativeAndroid()) return () => {};

  const cleanups = [
    setupNativeTapHaptics(),
    setupNativeKeyboard(),
    setupNativeNetwork(),
    setupNativePullToRefresh(),
  ];

  return () => {
    cleanups.forEach((fn) => {
      try {
        fn();
      } catch (_) {
        // No-op cleanup guard.
      }
    });
  };
};
