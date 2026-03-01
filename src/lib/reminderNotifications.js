import { supabase } from '@/lib/supabase';

const DEFAULT_ICON = '/logo/logo.png';

export const getNotificationPermission = () => {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission;
};

export const isNotificationGranted = () => getNotificationPermission() === 'granted';

export const requestNotificationPermission = async () => {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  try {
    return await Notification.requestPermission();
  } catch (_) {
    return Notification.permission;
  }
};

const getRegistration = async () => {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.getRegistration();
  } catch (_) {
    return null;
  }
};

const isPushSupported = () => (
  typeof window !== 'undefined'
  && 'serviceWorker' in navigator
  && 'PushManager' in window
);

const getPushPublicKey = () => String(import.meta.env.VITE_WEB_PUSH_PUBLIC_KEY || '').trim();

const toUint8Array = (base64String) => {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
};

const buildPushSubscriptionRow = ({ userId, subscription, reminderTime = '21:00' }) => {
  const json = subscription?.toJSON ? subscription.toJSON() : null;
  const endpoint = subscription?.endpoint || json?.endpoint || null;
  const p256dh = json?.keys?.p256dh || null;
  const auth = json?.keys?.auth || null;
  if (!userId || !endpoint || !p256dh || !auth) return null;
  return {
    user_id: userId,
    endpoint,
    p256dh,
    auth,
    content_encoding: json?.contentEncoding || null,
    reminder_time: String(reminderTime || '21:00').slice(0, 5),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    is_active: true,
    last_seen_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
};

export const syncWebPushSubscription = async ({ userId, reminderTime = '21:00' } = {}) => {
  if (!userId) return { ok: false, reason: 'missing_user' };
  if (!isNotificationGranted()) return { ok: false, reason: 'permission_not_granted' };
  if (!isPushSupported()) return { ok: false, reason: 'push_unsupported' };

  const publicKey = getPushPublicKey();
  if (!publicKey) return { ok: false, reason: 'missing_vapid_public_key' };

  const registration = (await navigator.serviceWorker.ready.catch(() => null))
    || (await getRegistration());
  if (!registration?.pushManager) return { ok: false, reason: 'missing_push_manager' };

  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: toUint8Array(publicKey),
    });
  }
  if (!subscription) return { ok: false, reason: 'subscription_failed' };

  const row = buildPushSubscriptionRow({ userId, subscription, reminderTime });
  if (!row) return { ok: false, reason: 'invalid_subscription' };

  const { error } = await supabase
    .from('web_push_subscriptions')
    .upsert(row, { onConflict: 'user_id,endpoint' });

  if (error) return { ok: false, reason: 'db_error', error };
  return { ok: true, subscription };
};

export const getLocalDateKey = (date = new Date()) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

export const reminderStorageKey = (dateKey, tag) => `nithya_habit_reminder_${dateKey}_${tag}`;

export const hasReminderFired = (dateKey, tag) => {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(reminderStorageKey(dateKey, tag)) === '1';
  } catch (_) {
    return false;
  }
};

export const markReminderFired = (dateKey, tag) => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(reminderStorageKey(dateKey, tag), '1');
  } catch (_) {
    // Ignore storage failures.
  }
};

export const showReminderNotification = async ({
  title,
  body,
  tag,
  icon = DEFAULT_ICON,
  badge = DEFAULT_ICON,
  renotify = false,
  data = {},
}) => {
  if (!isNotificationGranted()) return false;

  const options = {
    body,
    tag,
    icon,
    badge,
    renotify,
    data: {
      url: '/dashboard',
      ...data,
    },
  };

  const registration = await getRegistration();
  if (registration?.showNotification) {
    try {
      await registration.showNotification(title, options);
      return true;
    } catch (_) {
      // Fall through to direct Notification API.
    }
  }

  try {
    const note = new Notification(title, options);
    note.onerror = () => {};
    return true;
  } catch (_) {
    return false;
  }
};
