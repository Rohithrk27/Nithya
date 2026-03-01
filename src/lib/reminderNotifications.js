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
    data,
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
