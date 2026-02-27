import React, { useEffect, useState, useRef, useMemo } from 'react';
import confetti from 'canvas-confetti';
import { computeLevel, xpIntoCurrentLevel, xpBetweenLevels, levelProgressPct, getTierColors } from './gameEngine';

export default function RPGXPBar({ totalXp = 0, levelUp = false }) {
  const level = useMemo(() => computeLevel(totalXp), [totalXp]);
  const xpIn = useMemo(() => xpIntoCurrentLevel(totalXp), [totalXp]);
  const xpNeeded = useMemo(() => xpBetweenLevels(level), [level]);
  const pct = useMemo(() => levelProgressPct(totalXp), [totalXp]);

  const [displayPct, setDisplayPct] = useState(0);
  const [c1, c2] = useMemo(() => getTierColors(level), [level]);
  const prevLevelUp = useRef(false);
  const prevTotalXp = useRef(totalXp);

  // Animate bar — reset to 0 on level-up then fill again
  useEffect(() => {
    if (levelUp && !prevLevelUp.current) {
      setDisplayPct(0);
      const t = setTimeout(() => setDisplayPct(pct), 200);
      return () => clearTimeout(t);
    } else {
      const t = setTimeout(() => setDisplayPct(pct), 80);
      return () => clearTimeout(t);
    }
  }, [pct, levelUp]);

  useEffect(() => {
    if (levelUp && !prevLevelUp.current) {
      confetti({ particleCount: 150, spread: 100, origin: { y: 0.5 }, colors: [c1, c2, '#fff'], zIndex: 9999 });
    }
    prevLevelUp.current = levelUp;
  }, [levelUp]);

  return (
    <div className="w-full">
      <div className="flex justify-between items-center mb-1">
        <span className="text-xs font-bold tracking-widest" style={{ color: c1 }}>Lv. {level}</span>
        <span className="text-xs font-mono" style={{ color: `${c1}99` }}>
          {xpIn.toLocaleString()} / {xpNeeded.toLocaleString()} XP
        </span>
        <span className="text-xs" style={{ color: `${c1}55` }}>→ Lv. {Math.min(level + 1, 1000)}</span>
      </div>

      <div
        className="relative rounded-full overflow-hidden border"
        style={{ height: 10, background: 'rgba(15,32,39,0.9)', borderColor: `${c1}33` }}
      >
        <div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{
            width: `${displayPct}%`,
            background: `linear-gradient(90deg, ${c1}, ${c2})`,
            boxShadow: `0 0 10px ${c1}aa`,
            transition: 'width 0.6s ease-out',
          }}
        />
        <div
          className="absolute inset-0 rounded-full pointer-events-none"
          style={{
            background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.12) 50%, transparent)',
            animation: 'xpShimmer 2.5s infinite',
            backgroundSize: '200% 100%',
          }}
        />
      </div>

      <style>{`
        @keyframes xpShimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
      `}</style>
    </div>
  );
}