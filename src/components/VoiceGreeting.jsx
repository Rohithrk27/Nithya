import { useEffect, useRef } from 'react';
import { speakWithFemaleVoice } from '@/lib/voice';

const SESSION_KEY_PREFIX = 'Nithya_greeted_session_v3:';
const PERSISTED_KEY_PREFIX = 'Nithya_greeted_once_v3:';

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
 *   userId: string — authenticated user id
 *   name: string — user's first name
 *   isFirstTime: bool — true if newly registered
 *   voiceEnabled: bool — from user preference
 *   onGlowPulse: fn — callback to trigger avatar glow
 */
export default function VoiceGreeting({ userId, name, isFirstTime, voiceEnabled, onGlowPulse }) {
  const spokenRef = useRef(false);

  useEffect(() => {
    spokenRef.current = false;
  }, [userId]);

  useEffect(() => {
    if (!voiceEnabled) return;
    if (spokenRef.current) return;
    if (!name) return;
    if (!('speechSynthesis' in window)) return;

    const keyScope = String(userId || '').trim() || 'anon';
    const sessionKey = `${SESSION_KEY_PREFIX}${keyScope}`;
    const persistedKey = `${PERSISTED_KEY_PREFIX}${keyScope}`;

    try {
      if (sessionStorage.getItem(sessionKey)) return;
    } catch (_) {
      // Continue without session storage guard if browser blocks access.
    }

    let hasWelcomedBefore = false;
    try {
      hasWelcomedBefore = localStorage.getItem(persistedKey) === '1';
    } catch (_) {
      hasWelcomedBefore = false;
    }

    spokenRef.current = true;

    const speak = () => {
      try {
        const firstName = pickSpeakableName(name) || 'Hunter';
        const shouldWelcomeBack = hasWelcomedBefore || !isFirstTime;
        const greeting = shouldWelcomeBack
          ? `Welcome back to Nithya, ${firstName}.`
          : `Welcome to Nithya, ${firstName}.`;
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
          try {
            sessionStorage.setItem(sessionKey, '1');
          } catch (_) {
            // Non-blocking storage fallback.
          }
          try {
            localStorage.setItem(persistedKey, '1');
          } catch (_) {
            // Non-blocking storage fallback.
          }
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
  }, [name, isFirstTime, userId, voiceEnabled]);

  return null; // No UI
}

