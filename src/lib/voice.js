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

const toLower = (value) => String(value || '').toLowerCase();

const isFemaleLikeVoice = (voice) => {
  const name = toLower(voice?.name);
  return FEMALE_VOICE_HINTS.some((hint) => name.includes(hint));
};

export function pickPreferredFemaleVoice(voices = []) {
  const list = Array.isArray(voices) ? voices : [];
  if (!list.length) return null;

  const englishIndianFemale = list.find((voice) => (
    toLower(voice?.lang).startsWith('en-in') && isFemaleLikeVoice(voice)
  ));
  if (englishIndianFemale) return englishIndianFemale;

  const englishFemale = list.find((voice) => (
    toLower(voice?.lang).startsWith('en') && isFemaleLikeVoice(voice)
  ));
  if (englishFemale) return englishFemale;

  const anyFemale = list.find((voice) => isFemaleLikeVoice(voice));
  if (anyFemale) return anyFemale;

  const englishIndian = list.find((voice) => toLower(voice?.lang).startsWith('en-in'));
  if (englishIndian) return englishIndian;

  const english = list.find((voice) => toLower(voice?.lang).startsWith('en'));
  if (english) return english;

  return list[0] || null;
}

export function speakWithFemaleVoice(text, options = {}) {
  if (typeof window === 'undefined') return false;
  if (!('speechSynthesis' in window)) return false;

  const spokenText = String(text || '').trim();
  if (!spokenText) return false;

  const synth = window.speechSynthesis;
  const utter = new SpeechSynthesisUtterance(spokenText);
  utter.rate = Number.isFinite(options.rate) ? options.rate : 0.95;
  utter.pitch = Number.isFinite(options.pitch) ? options.pitch : 1.2;
  utter.volume = Number.isFinite(options.volume) ? options.volume : 1;

  const run = () => {
    const preferred = pickPreferredFemaleVoice(synth.getVoices());
    if (preferred) utter.voice = preferred;
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
