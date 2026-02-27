import React, { useEffect, useRef, useState } from 'react';
import confetti from 'canvas-confetti';

const XP_PER_LEVEL = 500;

// Returns a gradient pair based on current level
function getLevelGradient(level) {
  if (level >= 20) return ['#a855f7', '#ec4899']; // purple → pink (Elite)
  if (level >= 10) return ['#3b82f6', '#8b5cf6']; // blue → violet (Athlete)
  if (level >= 5)  return ['#10b981', '#3b82f6'];  // green → blue (Disciplined)
  return ['#6366f1', '#3b82f6'];                   // indigo → blue (Beginner)
}

export default function XPProgressBar({ totalXp, levelUp }) {
  const currentLevel = Math.floor(totalXp / XP_PER_LEVEL) + 1;
  const xpInLevel = totalXp % XP_PER_LEVEL;
  const progressPct = (xpInLevel / XP_PER_LEVEL) * 100;
  const xpToNext = XP_PER_LEVEL - xpInLevel;

  const [displayPct, setDisplayPct] = useState(0);
  const [colors] = useState(() => getLevelGradient(currentLevel));
  const prevLevelUp = useRef(false);

  // Animate fill on mount and when xp changes
  useEffect(() => {
    const t = setTimeout(() => setDisplayPct(progressPct), 80);
    return () => clearTimeout(t);
  }, [progressPct]);

  // Trigger confetti on level-up
  useEffect(() => {
    if (levelUp && !prevLevelUp.current) {
      confetti({
        particleCount: 120,
        spread: 80,
        origin: { y: 0.5 },
        colors: ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ec4899'],
        zIndex: 9999,
      });
    }
    prevLevelUp.current = levelUp;
  }, [levelUp]);

  const [c1, c2] = colors;

  return (
    <div className="w-full">
      <div className="flex justify-between items-center mb-1.5">
        <span className="text-xs font-semibold" style={{ color: c1 }}>
          Level {currentLevel}
        </span>
        <span className="text-xs text-[#475569]">
          {xpInLevel} / {XP_PER_LEVEL} XP
        </span>
        <span className="text-xs text-[#475569]">
          {xpToNext} to Lv {currentLevel + 1}
        </span>
      </div>

      {/* Track */}
      <div className="relative h-3 rounded-full bg-[#1E293B] overflow-hidden border border-[#334155]">
        {/* Animated fill */}
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-all duration-700 ease-out"
          style={{
            width: `${displayPct}%`,
            background: `linear-gradient(90deg, ${c1}, ${c2})`,
            boxShadow: `0 0 8px ${c1}88`,
          }}
        />
        {/* Shimmer overlay */}
        <div
          className="absolute inset-0 rounded-full opacity-30"
          style={{
            background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.35) 50%, transparent 100%)',
            animation: 'shimmer 2s infinite',
            backgroundSize: '200% 100%',
          }}
        />
      </div>

      <style>{`
        @keyframes shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
      `}</style>
    </div>
  );
}