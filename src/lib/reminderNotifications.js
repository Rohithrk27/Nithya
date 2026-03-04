import { supabase } from '@/lib/supabase';
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';

const DEFAULT_ICON = '/logo/logo.png';
const NATIVE_REMINDER_CHANNEL_ID = 'nithya-reminders';
const NATIVE_DAILY_REMINDER_ID = 9001;
const HABITS_DEEP_LINK_PATH = '/dashboard?open=habits';
const EXACT_ALARM_PROMPT_STORAGE_KEY = 'nithya_exact_alarm_prompted_android_v1';
let nativePermissionCache = 'default';

const getCapacitorRuntime = () => {
  if (typeof window !== 'undefined' && window?.Capacitor) return window.Capacitor;
  return Capacitor;
};

const isNativeAndroid = () => {
  try {
    const cap = getCapacitorRuntime();
    const platform = typeof cap?.getPlatform === 'function' ? String(cap.getPlatform() || '') : '';
    const nativePlatform = typeof cap?.isNativePlatform === 'function' ? !!cap.isNativePlatform() : false;
    return nativePlatform && platform === 'android';
  } catch (_) {
    return false;
  }
};

const mapNativePermission = (value) => {
  if (value === 'granted') return 'granted';
  if (value === 'denied') return 'denied';
  return 'default';
};

const ensureReminderChannel = async () => {
  if (!isNativeAndroid()) return;
  try {
    await LocalNotifications.createChannel({
      id: NATIVE_REMINDER_CHANNEL_ID,
      name: 'Habit Reminders',
      description: 'Daily habit and discipline reminders',
      importance: 5,
      visibility: 1,
      lights: true,
      vibration: true,
      sound: 'default',
    });
  } catch (_) {
    // Channel may already exist; ignore.
  }
};

const parseReminderTime = (value) => {
  const parts = String(value || '').split(':').map(Number);
  if (parts.length < 2 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1])) return null;
  const hours = Math.max(0, Math.min(23, parts[0]));
  const minutes = Math.max(0, Math.min(59, parts[1]));
  return { hours, minutes };
};

const hasPromptedExactAlarm = () => {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(EXACT_ALARM_PROMPT_STORAGE_KEY) === '1';
  } catch (_) {
    return false;
  }
};

const markPromptedExactAlarm = () => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(EXACT_ALARM_PROMPT_STORAGE_KEY, '1');
  } catch (_) {
    // Ignore storage failures.
  }
};

const nextNativeNotificationId = () => Math.floor((Date.now() % 1000000000) + 1000);

export const checkNotificationPermission = async () => {
  if (isNativeAndroid()) {
    try {
      const res = await LocalNotifications.checkPermissions();
      const mapped = mapNativePermission(res?.display);
      nativePermissionCache = mapped;
      return mapped;
    } catch (_) {
      return nativePermissionCache;
    }
  }

  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission;
};

export const getNotificationPermission = () => {
  if (isNativeAndroid()) return nativePermissionCache;
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission;
};

export const isNotificationGranted = () => getNotificationPermission() === 'granted';

export const requestNotificationPermission = async () => {
  if (isNativeAndroid()) {
    try {
      const res = await LocalNotifications.requestPermissions();
      const mapped = mapNativePermission(res?.display);
      nativePermissionCache = mapped;
      return mapped;
    } catch (_) {
      return nativePermissionCache;
    }
  }

  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  try {
    return await Notification.requestPermission();
  } catch (_) {
    return Notification.permission;
  }
};

export const checkExactAlarmPermission = async () => {
  if (!isNativeAndroid()) return 'unsupported';
  if (typeof LocalNotifications?.checkExactNotificationSetting !== 'function') return 'unsupported';
  try {
    const result = await LocalNotifications.checkExactNotificationSetting();
    return mapNativePermission(result?.exact_alarm);
  } catch (_) {
    return 'default';
  }
};

export const requestExactAlarmPermission = async ({ force = false } = {}) => {
  if (!isNativeAndroid()) return 'unsupported';
  if (typeof LocalNotifications?.changeExactNotificationSetting !== 'function') return 'unsupported';

  const current = await checkExactAlarmPermission();
  if (current === 'granted') return current;
  if (!force && hasPromptedExactAlarm()) return current;

  markPromptedExactAlarm();
  try {
    const result = await LocalNotifications.changeExactNotificationSetting();
    return mapNativePermission(result?.exact_alarm);
  } catch (_) {
    return checkExactAlarmPermission();
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

export const syncWebPushSubscription = async ({
  userId,
  reminderTime = '21:00',
  strictExactAlarm = false,
} = {}) => {
  if (!userId) return { ok: false, reason: 'missing_user' };

  const permission = await checkNotificationPermission();
  if (permission !== 'granted') return { ok: false, reason: 'permission_not_granted' };

  // APK path: use native Android local notifications for reliable reminders.
  if (isNativeAndroid()) {
    const parsedTime = parseReminderTime(reminderTime);
    if (!parsedTime) return { ok: false, reason: 'invalid_time' };

    let exactAlarm = await checkExactAlarmPermission();
    if (strictExactAlarm && exactAlarm !== 'granted') {
      exactAlarm = await requestExactAlarmPermission();
    }

    try {
      await ensureReminderChannel();
      await LocalNotifications.cancel({
        notifications: [{ id: NATIVE_DAILY_REMINDER_ID }],
      });
      await LocalNotifications.schedule({
        notifications: [{
          id: NATIVE_DAILY_REMINDER_ID,
          title: 'Nithya Habit Reminder',
          body: 'Check in and complete your pending habits.',
          channelId: NATIVE_REMINDER_CHANNEL_ID,
          schedule: {
            on: {
              hour: parsedTime.hours,
              minute: parsedTime.minutes,
            },
            repeats: true,
            allowWhileIdle: true,
          },
          extra: {
            source: 'native_daily',
            reminder_time: String(reminderTime || '21:00').slice(0, 5),
            url: HABITS_DEEP_LINK_PATH,
          },
        }],
      });
      return { ok: true, native: true, exact_alarm: exactAlarm };
    } catch (error) {
      return { ok: false, reason: 'native_schedule_failed', error };
    }
  }

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
export const reminderCountStorageKey = (dateKey) => `nithya_habit_reminder_count_${dateKey}`;

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

export const getReminderSentCount = (dateKey) => {
  if (typeof window === 'undefined') return 0;
  try {
    const raw = localStorage.getItem(reminderCountStorageKey(dateKey));
    const parsed = Number(raw || 0);
    if (!Number.isFinite(parsed) || parsed < 0) return 0;
    return Math.floor(parsed);
  } catch (_) {
    return 0;
  }
};

export const incrementReminderSentCount = (dateKey) => {
  if (typeof window === 'undefined') return 0;
  try {
    const next = getReminderSentCount(dateKey) + 1;
    localStorage.setItem(reminderCountStorageKey(dateKey), String(next));
    return next;
  } catch (_) {
    return getReminderSentCount(dateKey);
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
  const permission = await checkNotificationPermission();
  if (permission !== 'granted') return false;
  const mergedData = {
    url: HABITS_DEEP_LINK_PATH,
    ...data,
  };

  if (isNativeAndroid()) {
    try {
      await ensureReminderChannel();
      await LocalNotifications.schedule({
        notifications: [{
          id: nextNativeNotificationId(),
          title,
          body,
          channelId: NATIVE_REMINDER_CHANNEL_ID,
          schedule: {
            at: new Date(Date.now() + 750),
            allowWhileIdle: true,
          },
          extra: {
            tag,
            ...mergedData,
          },
        }],
      });
      return true;
    } catch (_) {
      return false;
    }
  }

  const options = {
    body,
    tag,
    icon,
    badge,
    renotify,
    data: {
      ...mergedData,
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
