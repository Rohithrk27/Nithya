import React, { useEffect, useState } from 'react';

const getStage = (level) => {
  if (level >= 21) return 4;
  if (level >= 11) return 3;
  if (level >= 6) return 2;
  return 1;
};

const stageConfig = {
  1: { label: 'Beginner', sublabel: 'The journey starts', color: '#64748B', accent: '#334155' },
  2: { label: 'Disciplined', sublabel: 'Form taking shape', color: '#3B82F6', accent: '#1D4ED8' },
  3: { label: 'Athlete', sublabel: 'Muscle & mind aligned', color: '#0EA5E9', accent: '#0284C7' },
  4: { label: 'Elite', sublabel: 'Peak human form', color: '#F59E0B', accent: '#D97706' },
};

// SVG humanoid silhouette with varying musculature
function Silhouette({ stage, breathing }) {
  const s = stage;
  // Shoulder width increases with stage
  const sw = [0, 18, 22, 27, 32][s];
  // Body width
  const bw = [0, 10, 13, 16, 20][s];
  // Arm width
  const aw = [0, 5, 6, 8, 10][s];
  const color = stageConfig[s].color;

  return (
    <svg
      width="100" height="180" viewBox="0 0 100 180"
      style={{
        transform: breathing ? 'scaleY(1.012)' : 'scaleY(1)',
        transition: 'transform 3s ease-in-out',
        filter: `drop-shadow(0 0 12px ${color}66)`
      }}
    >
      <defs>
        <linearGradient id={`bodyGrad${s}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={stageConfig[s].color} stopOpacity="0.9" />
          <stop offset="100%" stopColor={stageConfig[s].accent} stopOpacity="0.7" />
        </linearGradient>
      </defs>

      {/* Head */}
      <circle cx="50" cy="18" r="12" fill={`url(#bodyGrad${s})`} />

      {/* Neck */}
      <rect x="46" y="28" width="8" height="8" rx="3" fill={`url(#bodyGrad${s})`} />

      {/* Shoulders */}
      <ellipse cx="50" cy="40" rx={sw} ry="7" fill={`url(#bodyGrad${s})`} />

      {/* Torso */}
      <path
        d={`M ${50-sw} 40 Q ${50-sw+3} 80 ${50-bw} 90 L ${50+bw} 90 Q ${50+sw-3} 80 ${50+sw} 40 Z`}
        fill={`url(#bodyGrad${s})`}
        opacity="0.95"
      />

      {/* Chest definition for higher stages */}
      {s >= 3 && (
        <>
          <ellipse cx="43" cy="52" rx="6" ry="8" fill={stageConfig[s].color} opacity="0.4" />
          <ellipse cx="57" cy="52" rx="6" ry="8" fill={stageConfig[s].color} opacity="0.4" />
        </>
      )}

      {/* Arms */}
      <rect x={50-sw-aw+2} y="38" width={aw} height={s >= 3 ? 36 : 30} rx={aw/2} fill={`url(#bodyGrad${s})`} />
      <rect x={50+sw-2} y="38" width={aw} height={s >= 3 ? 36 : 30} rx={aw/2} fill={`url(#bodyGrad${s})`} />

      {/* Forearms */}
      <rect x={50-sw-aw+4} y={38+(s>=3?32:26)} width={aw-2} height={24} rx={(aw-2)/2} fill={`url(#bodyGrad${s})`} opacity="0.8" />
      <rect x={50+sw} y={38+(s>=3?32:26)} width={aw-2} height={24} rx={(aw-2)/2} fill={`url(#bodyGrad${s})`} opacity="0.8" />

      {/* Hips */}
      <ellipse cx="50" cy="90" rx={bw+4} ry="6" fill={`url(#bodyGrad${s})`} />

      {/* Legs */}
      <rect x={50-bw-2} y="94" width={s>=2?10:8} height={50} rx="4" fill={`url(#bodyGrad${s})`} />
      <rect x={50+2} y="94" width={s>=2?10:8} height={50} rx="4" fill={`url(#bodyGrad${s})`} />

      {/* Calves */}
      <rect x={50-bw} y="136} " width={s>=2?9:7} height="22" rx="4" fill={`url(#bodyGrad${s})`} opacity="0.8" />
      <rect x={50+3} y="136" width={s>=2?9:7} height="22" rx="4" fill={`url(#bodyGrad${s})`} opacity="0.8" />

      {/* Muscle highlights for elite */}
      {s === 4 && (
        <>
          <ellipse cx={50-bw+4} cy="110" rx="4" ry="10" fill="white" opacity="0.12" />
          <ellipse cx={50+bw} cy="110" rx="4" ry="10" fill="white" opacity="0.12" />
        </>
      )}
    </svg>
  );
}

export default function HumanoidAvatar({ level, levelUp }) {
  const stage = getStage(level);
  const config = stageConfig[stage];
  const [breathing, setBreathing] = useState(false);
  const [glow, setGlow] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      setBreathing(b => !b);
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (levelUp) {
      setGlow(true);
      setTimeout(() => setGlow(false), 1500);
    }
  }, [levelUp]);

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative">
        {glow && (
          <div
            className="absolute inset-0 rounded-full pointer-events-none"
            style={{
              background: `radial-gradient(circle, ${config.color}66 0%, transparent 70%)`,
              animation: 'ping 1s ease-out',
              borderRadius: '50%',
              width: '120%', height: '120%',
              top: '-10%', left: '-10%'
            }}
          />
        )}
        <Silhouette stage={stage} breathing={breathing} />
      </div>
      <div className="text-center">
        <p className="text-sm font-bold" style={{ color: config.color }}>{config.label}</p>
        <p className="text-xs text-[#475569]">{config.sublabel}</p>
      </div>
    </div>
  );
}
