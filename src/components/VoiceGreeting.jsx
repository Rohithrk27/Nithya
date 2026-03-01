import { useEffect, useRef } from 'react';
import { speakWithFemaleVoice } from '@/lib/voice';

const SESSION_KEY = 'Nithya_greeted_v2';

const normalizeSpeechNameToken = (token) => {
  const cleaned = String(token || '')
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  if (/^[A-Z]{2,}$/.test(cleaned)) {
    return `${cleaned.slice(0, 1)}${cleaned.slice(1).toLowerCase()}`;
  }
  return cleaned;
};

const pickSpeakableName = (rawName) => {
  const text = String(rawName || '')
    .replace(/[^\p{L}\p{M}\s'._-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  const parts = text.split(' ').map((part) => normalizeSpeechNameToken(part)).filter(Boolean);
  if (!parts.length) return '';
  if (parts.length >= 2 && parts.every((part) => part.length === 1)) {
    const merged = parts.join('');
    return `${merged.slice(0, 1)}${merged.slice(1).toLowerCase()}`;
  }

  const preferredWord = parts.find((part) => part.length >= 3) || parts[0];
  return preferredWord;
};

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
        const firstName = pickSpeakableName(name) || 'Hunter';
        const greeting = isFirstTime
          ? `Welcome to Nithya, ${firstName}.`
          : `Welcome back to Nithya, ${firstName}.`;
        if (onGlowPulse) onGlowPulse(true);
        speakWithFemaleVoice(greeting, {
          rate: 0.9,
          pitch: 1.28,
          volume: 1,
          lang: 'en-IN',
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

