import { Capacitor } from '@capacitor/core';
import { TextToSpeech } from '@capacitor-community/text-to-speech';

const FEMALE_VOICE_HINTS = [
  'female',
  'woman',
  'girl',
  'samantha',
  'victoria',
  'zira',
  'karen',
  'moira',
  'susan',
  'ava',
  'aria',
  'jenny',
  'nancy',
  'allison',
  'natasha',
  'veena',
  'heera',
];

const INDIAN_ENGLISH_LANG = 'en-IN';

const toLower = (value) => String(value || '').toLowerCase();

const isNativeAndroid = () => {
  try {
    const cap = (typeof window !== 'undefined' && window?.Capacitor) ? window.Capacitor : Capacitor;
    const platform = typeof cap?.getPlatform === 'function' ? String(cap.getPlatform() || '') : '';
    const nativePlatform = typeof cap?.isNativePlatform === 'function' ? !!cap.isNativePlatform() : false;
    return nativePlatform && platform === 'android';
  } catch (_) {
    return false;
  }
};

const isFemaleLikeVoice = (voice) => {
  const name = toLower(voice?.name);
  return FEMALE_VOICE_HINTS.some((hint) => name.includes(hint));
};

const isIndianEnglishVoice = (voice) => toLower(voice?.lang).startsWith('en-in');

export function pickPreferredFemaleVoice(voices = []) {
  const list = Array.isArray(voices) ? voices : [];
  if (!list.length) return null;

  const englishIndianFemale = list.find((voice) => (
    isIndianEnglishVoice(voice) && isFemaleLikeVoice(voice)
  ));
  if (englishIndianFemale) return englishIndianFemale;

  const englishIndian = list.find((voice) => isIndianEnglishVoice(voice));
  if (englishIndian) return englishIndian;

  return null;
}

export function speakWithFemaleVoice(text, options = {}) {
  const spokenText = String(text || '').trim();
  if (!spokenText) return false;

  if (isNativeAndroid()) {
    void (async () => {
      try {
        if (options.cancel !== false) {
          await TextToSpeech.stop();
        }
      } catch (_) {
        // Stop is best effort only.
      }

      try {
        await TextToSpeech.speak({
          text: spokenText,
          lang: INDIAN_ENGLISH_LANG,
          rate: Number.isFinite(options.rate) ? options.rate : 0.95,
          pitch: Number.isFinite(options.pitch) ? options.pitch : 1.2,
          volume: Number.isFinite(options.volume) ? options.volume : 1,
        });
      } catch (_) {
        // Fall back to browser speech API path below when available.
        if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
          const synth = window.speechSynthesis;
          const utter = new SpeechSynthesisUtterance(spokenText);
          utter.lang = INDIAN_ENGLISH_LANG;
          utter.rate = Number.isFinite(options.rate) ? options.rate : 0.95;
          utter.pitch = Number.isFinite(options.pitch) ? options.pitch : 1.2;
          utter.volume = Number.isFinite(options.volume) ? options.volume : 1;
          if (options.cancel !== false) synth.cancel();
          synth.speak(utter);
        }
      }
    })();
    return true;
  }

  if (typeof window === 'undefined') return false;
  if (!('speechSynthesis' in window)) return false;

  const synth = window.speechSynthesis;
  const utter = new SpeechSynthesisUtterance(spokenText);
  utter.lang = INDIAN_ENGLISH_LANG;
  utter.rate = Number.isFinite(options.rate) ? options.rate : 0.95;
  utter.pitch = Number.isFinite(options.pitch) ? options.pitch : 1.2;
  utter.volume = Number.isFinite(options.volume) ? options.volume : 1;

  const run = () => {
    const preferred = pickPreferredFemaleVoice(synth.getVoices());
    if (preferred) {
      utter.voice = preferred;
    }
    if (options.cancel !== false) synth.cancel();
    synth.speak(utter);
  };

  if (synth.getVoices().length > 0) {
    run();
  } else {
    synth.addEventListener('voiceschanged', run, { once: true });
    setTimeout(() => {
      try {
        if (!utter.voice) run();
      } catch (_) {
        // Non-blocking fallback when voices load late.
      }
    }, 700);
  }

  return true;
}
