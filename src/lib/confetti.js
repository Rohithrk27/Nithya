import confetti from 'canvas-confetti';

const FALLBACK_CLASS = 'nithya-confetti-fallback';
let fallbackStyleInjected = false;

const injectFallbackStyle = () => {
  if (fallbackStyleInjected || typeof document === 'undefined') return;
  const style = document.createElement('style');
  style.id = 'nithya-confetti-fallback-style';
  style.textContent = `
    .${FALLBACK_CLASS} {
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: 9999;
      overflow: hidden;
    }
    .${FALLBACK_CLASS} i {
      position: absolute;
      top: 46%;
      width: 8px;
      height: 14px;
      border-radius: 2px;
      opacity: 0;
      transform: translate3d(0, 0, 0) rotate(0deg);
      animation: nithyaConfettiDrop 1200ms ease-out forwards;
    }
    @keyframes nithyaConfettiDrop {
      0% { opacity: 1; transform: translate3d(0, 0, 0) rotate(0deg) scale(1); }
      100% { opacity: 0; transform: translate3d(var(--dx), var(--dy), 0) rotate(var(--rot)) scale(0.85); }
    }
  `;
  document.head.appendChild(style);
  fallbackStyleInjected = true;
};

const fallbackBurst = (colors = ['#38bdf8', '#22d3ee', '#ffffff']) => {
  if (typeof document === 'undefined') return false;
  injectFallbackStyle();

  const root = document.createElement('div');
  root.className = FALLBACK_CLASS;
  const pieceCount = 34;
  for (let i = 0; i < pieceCount; i += 1) {
    const piece = document.createElement('i');
    const color = colors[i % colors.length];
    const fromX = 50 + (Math.random() * 12 - 6);
    const dx = Math.round((Math.random() * 2 - 1) * 220);
    const dy = Math.round(140 + Math.random() * 260);
    const rot = Math.round((Math.random() * 2 - 1) * 500);
    piece.style.left = `${fromX}%`;
    piece.style.background = color;
    piece.style.setProperty('--dx', `${dx}px`);
    piece.style.setProperty('--dy', `${dy}px`);
    piece.style.setProperty('--rot', `${rot}deg`);
    piece.style.animationDelay = `${Math.round(Math.random() * 120)}ms`;
    root.appendChild(piece);
  }
  document.body.appendChild(root);
  window.setTimeout(() => {
    root.remove();
  }, 1500);
  return true;
};

export const burstConfetti = ({
  particleCount = 150,
  spread = 100,
  origin = { y: 0.5 },
  colors = ['#38bdf8', '#22d3ee', '#ffffff'],
  zIndex = 9999,
} = {}) => {
  try {
    confetti({ particleCount, spread, origin, colors, zIndex });
    return true;
  } catch (_) {
    return fallbackBurst(colors);
  }
};

