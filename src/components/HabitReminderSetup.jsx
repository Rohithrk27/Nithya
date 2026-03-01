import React, { useState } from 'react';
import { Bell, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { speakWithFemaleVoice } from '@/lib/voice';

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

// Schedules a browser notification at a given time string "HH:MM"
function scheduleReminder(time, habits) {
  if (typeof window === 'undefined') return;
  if (!time || habits.length === 0) return;

  const [h, m] = time.split(':').map(Number);
  const now = new Date();
  const target = new Date();
  target.setHours(h, m, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1); // next day if past

  const msUntil = target.getTime() - now.getTime();
  const win = /** @type {any} */ (window);

  // Clear any existing timer
  if (win._habitReminderTimer) clearTimeout(win._habitReminderTimer);

  win._habitReminderTimer = setTimeout(() => {
    const incompleteHabits = habits.map(h => h.title).join(', ');
    const reminderText = `Reminder. Time to check in. Today's habits: ${incompleteHabits}`;
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('⚡ Habit Reminder', {
        body: `Time to check in! Today's habits: ${incompleteHabits}`,
        icon: '/favicon.ico',
        badge: '/favicon.ico',
        tag: 'habit-reminder',
      });
    }
    playHabitReminderCue(reminderText);
    // Re-schedule for the next day
    scheduleReminder(time, habits);
  }, msUntil);
}

export function initHabitReminders(reminderTime, habits) {
  scheduleReminder(reminderTime, habits);
}

export default function HabitReminderSetup({ reminderTime, habits, onTimeChange }) {
  const [permission, setPermission] = useState(
    'Notification' in window ? Notification.permission : 'unsupported'
  );
  const [saved, setSaved] = useState(false);

  const requestPermission = async () => {
    if (!('Notification' in window)) return;
    const result = await Notification.requestPermission();
    setPermission(result);
    if (result === 'granted') {
      scheduleReminder(reminderTime, habits);
    }
  };

  const handleSaveTime = () => {
    if (permission === 'granted') {
      scheduleReminder(reminderTime, habits);
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    onTimeChange && onTimeChange(reminderTime);
  };

  if (permission === 'unsupported') return null;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {permission !== 'granted' ? (
        <Button
          size="sm"
          onClick={requestPermission}
          className="bg-[#334155] hover:bg-[#475569] text-[#F8FAFC] gap-2"
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
            className="bg-[#0F172A] border border-[#334155] text-[#F8FAFC] rounded px-2 py-1 text-sm"
          />
          <Button
            size="sm"
            onClick={handleSaveTime}
            className={`transition-all ${saved ? 'bg-green-600 hover:bg-green-600' : 'bg-[#3B82F6] hover:bg-[#3B82F6]/90'}`}
          >
            {saved ? <><Check className="w-3 h-3 mr-1" /> Saved</> : 'Save'}
          </Button>
        </>
      )}
    </div>
  );
}
