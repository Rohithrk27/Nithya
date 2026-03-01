import { useEffect, useRef } from 'react';
import { speakWithFemaleVoice } from '@/lib/voice';

const SESSION_KEY = 'Nithya_greeted';

/**
 * Plays a one-time-per-session voice greeting using Web Speech API.
 * Props:
 *   name: string — user's first name
 *   isFirstTime: bool — true if newly registered
 *   voiceEnabled: bool — from user preference
 *   onGlowPulse: fn — callback to trigger avatar glow
 */
export default function VoiceGreeting({ name, isFirstTime, voiceEnabled, onGlowPulse }) {
  const spokenRef = useRef(false);

  useEffect(() => {
    if (!voiceEnabled) return;
    if (spokenRef.current) return;
    if (sessionStorage.getItem(SESSION_KEY)) return;
    if (!name) return;
    if (!('speechSynthesis' in window)) return;

    spokenRef.current = true;

    const speak = () => {
      try {
        const firstName = name.split(' ')[0];
        const greeting = isFirstTime
          ? `Welcome to Nithya, ${firstName}.`
          : `Welcome back to Nithya, ${firstName}.`;
        if (onGlowPulse) onGlowPulse(true);
        speakWithFemaleVoice(greeting, {
          rate: 0.9,
          pitch: 1.28,
          volume: 1,
          cancel: true,
        });
        setTimeout(() => {
          if (onGlowPulse) onGlowPulse(false);
          sessionStorage.setItem(SESSION_KEY, '1');
        }, 1800);
      } catch (_) {
        // Fail silently
        if (onGlowPulse) onGlowPulse(false);
      }
    };

    // Voices may not be loaded yet — wait for them
    if (window.speechSynthesis.getVoices().length > 0) {
      setTimeout(speak, 800);
    } else {
      window.speechSynthesis.addEventListener('voiceschanged', () => setTimeout(speak, 800), { once: true });
    }
  }, [name, isFirstTime, voiceEnabled]);

  return null; // No UI
}

