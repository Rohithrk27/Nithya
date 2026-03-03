import React, { useEffect, useState } from 'react';
import { Bell, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { speakWithFemaleVoice } from '@/lib/voice';
import {
  checkNotificationPermission,
  getLocalDateKey,
  getNotificationPermission,
  hasReminderFired,
  markReminderFired,
  requestNotificationPermission,
  syncWebPushSubscription,
  showReminderNotification,
} from '@/lib/reminderNotifications';

function playHabitReminderCue(message) {
  if (typeof window === 'undefined') return;
  const win = /** @type {any} */ (window);

  try {
    const AudioCtor = window.AudioContext || win.webkitAudioContext;
    if (AudioCtor) {
      const ctx = win.__nithyaHabitReminderAudioCtx || new AudioCtor();
      win.__nithyaHabitReminderAudioCtx = ctx;
      if (ctx.state === 'suspended') {
        void ctx.resume().catch(() => {});
      }

      const notes = [820, 690, 820];
      notes.forEach((freq, index) => {
        const start = ctx.currentTime + (index * 0.18);
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, start);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.22, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 0.16);
      });
    }
  } catch (_) {
    // Non-blocking audio reminder fallback.
  }

  try {
    speakWithFemaleVoice(message, {
      rate: 0.95,
      pitch: 1.2,
      volume: 1,
      cancel: true,
    });
  } catch (_) {
    // Non-blocking speech fallback.
  }
}

const parseTime = (value) => {
  const parts = String(value || '').split(':').map(Number);
  if (parts.length < 2 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1])) return null;
  return { hours: parts[0], minutes: parts[1] };
};

const buildReminderText = (habits) => {
  const incompleteHabits = habits.map((h) => h.title).join(', ');
  return {
    preview: incompleteHabits,
    spoken: `Reminder. Time to check in. Today's habits: ${incompleteHabits}`,
    body: `Time to check in! Today's habits: ${incompleteHabits}`,
  };
};

// Background-safe scheduler: interval + focus/visibility catch-up.
function scheduleReminder(time, habits) {
  if (typeof window === 'undefined') return () => {};
  if (!time || habits.length === 0) return () => {};

  const parsed = parseTime(time);
  if (!parsed) return () => {};

  const tag = 'profile_daily';
  let firing = false;
  const tick = async () => {
    if (firing) return;
    const now = new Date();
    const target = new Date(now);
    target.setHours(parsed.hours, parsed.minutes, 0, 0);
    if (now.getTime() < target.getTime()) return;

    const dateKey = getLocalDateKey(now);
    if (hasReminderFired(dateKey, tag)) return;

    firing = true;
    try {
      const message = buildReminderText(habits);
      await showReminderNotification({
        title: '⚡ Habit Reminder',
        body: message.body,
        tag: 'habit-reminder',
        data: { source: 'profile', dateKey, tag },
      });
      playHabitReminderCue(message.spoken);
      markReminderFired(dateKey, tag);
    } finally {
      firing = false;
    }
  };

  void tick();
  const intervalId = window.setInterval(() => { void tick(); }, 30000);
  const onVisibility = () => { void tick(); };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('focus', onVisibility);

  return () => {
    clearInterval(intervalId);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('focus', onVisibility);
  };
}

export function initHabitReminders(reminderTime, habits) {
  return scheduleReminder(reminderTime, habits);
}

export default function HabitReminderSetup({ reminderTime, habits, onTimeChange, userId = null }) {
  const [permission, setPermission] = useState(getNotificationPermission());
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const refreshPermission = async () => {
      const value = await checkNotificationPermission();
      if (!cancelled) setPermission(value);
    };
    void refreshPermission();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (permission !== 'granted') return undefined;
    if (userId) {
      void syncWebPushSubscription({ userId, reminderTime });
    }
    return scheduleReminder(reminderTime, habits);
  }, [permission, reminderTime, habits, userId]);

  const requestPermission = async () => {
    const result = await requestNotificationPermission();
    setPermission(result);
    if (result === 'granted' && userId) {
      void syncWebPushSubscription({ userId, reminderTime });
    }
  };

  const handleSaveTime = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    onTimeChange && onTimeChange(reminderTime);
  };

  if (permission === 'unsupported') return null;

  return (
    <div className="flex items-center gap-2 flex-wrap w-full">
      {permission !== 'granted' ? (
        <Button
          size="sm"
          onClick={requestPermission}
          className="bg-[#334155] hover:bg-[#475569] text-[#F8FAFC] gap-2 w-full sm:w-auto"
        >
          <Bell className="w-4 h-4 text-yellow-400" />
          Enable Reminders
        </Button>
      ) : (
        <>
          <Bell className="w-4 h-4 text-yellow-400 flex-shrink-0" />
          <input
            type="time"
            value={reminderTime}
            onChange={e => onTimeChange && onTimeChange(e.target.value)}
            className="bg-[#0F172A] border border-[#334155] text-[#F8FAFC] rounded px-2 py-1 text-sm min-w-0 w-full sm:w-auto"
          />
          <Button
            size="sm"
            onClick={handleSaveTime}
            className={`transition-all w-full sm:w-auto ${saved ? 'bg-green-600 hover:bg-green-600' : 'bg-[#3B82F6] hover:bg-[#3B82F6]/90'}`}
          >
            {saved ? <><Check className="w-3 h-3 mr-1" /> Saved</> : 'Save'}
          </Button>
        </>
      )}
    </div>
  );
}
