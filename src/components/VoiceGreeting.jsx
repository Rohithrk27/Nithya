import { useEffect, useRef } from 'react';

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
        window.speechSynthesis.cancel();

        const firstName = name.split(' ')[0];
        const greeting = isFirstTime
          ? `Welcome to Nithya, ${firstName}.`
          : `Welcome back to Nithya, ${firstName}.`;

        const utter = new SpeechSynthesisUtterance(greeting);
        utter.rate = 0.9;
        utter.pitch = 1.3;
        utter.volume = 1;

        // Prefer Indian English first, then female-sounding English voices
        const voices = window.speechSynthesis.getVoices();
        const preferredIndianFemale = voices.find((v) => {
          const voiceName = v.name.toLowerCase();
          return v.lang.toLowerCase().startsWith('en-in') && (
            voiceName.includes('female') ||
            voiceName.includes('woman') ||
            voiceName.includes('girl') ||
            voiceName.includes('samantha') ||
            voiceName.includes('victoria') ||
            voiceName.includes('zira') ||
            voiceName.includes('karen') ||
            voiceName.includes('moira') ||
            voiceName.includes('susan') ||
            voiceName.includes('ava') ||
            voiceName.includes('aria') ||
            voiceName.includes('jenny') ||
            voiceName.includes('nancy')
          );
        });
        const preferredIndian = voices.find((v) => v.lang.toLowerCase().startsWith('en-in'));
        const preferredEnglishFemale = voices.find((v) => {
          const voiceName = v.name.toLowerCase();
          return v.lang.startsWith('en') && (
            voiceName.includes('female') ||
            voiceName.includes('woman') ||
            voiceName.includes('girl') ||
            voiceName.includes('samantha') ||
            voiceName.includes('victoria') ||
            voiceName.includes('zira') ||
            voiceName.includes('karen') ||
            voiceName.includes('moira') ||
            voiceName.includes('susan') ||
            voiceName.includes('ava') ||
            voiceName.includes('aria') ||
            voiceName.includes('jenny') ||
            voiceName.includes('nancy')
          );
        });
        const preferred = preferredIndianFemale || preferredIndian || preferredEnglishFemale || voices.find((v) => v.lang.startsWith('en')) || null;
        if (preferred) utter.voice = preferred;

        utter.onstart = () => {
          if (onGlowPulse) onGlowPulse(true);
        };
        utter.onend = () => {
          if (onGlowPulse) onGlowPulse(false);
          sessionStorage.setItem(SESSION_KEY, '1');
        };
        utter.onerror = () => {
          if (onGlowPulse) onGlowPulse(false);
        };

        window.speechSynthesis.speak(utter);
      } catch (_) {
        // Fail silently
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

