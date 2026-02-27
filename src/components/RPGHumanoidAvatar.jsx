import React, { useEffect, useState, useMemo, useRef } from 'react';
import { getAvatarTier } from './gameEngine';

export { getAvatarTier };

const TIER_CONFIG = {
  0:  { label: 'Awakening',   color: '#64748B', glow: false, particles: false },
  1:  { label: 'Initiate',    color: '#38BDF8', glow: true,  particles: false },
  2:  { label: 'Challenger',  color: '#38BDF8', glow: true,  particles: false },
  3:  { label: 'Warrior',     color: '#38BDF8', glow: true,  particles: true  },
  4:  { label: 'Sentinel',    color: '#60A5FA', glow: true,  particles: true  },
  5:  { label: 'Ascendant',   color: '#22D3EE', glow: true,  particles: true  },
  6:  { label: 'Paragon',     color: '#34D399', glow: true,  particles: true  },
  7:  { label: 'Phantom',     color: '#FBBF24', glow: true,  particles: true  },
  8:  { label: 'Transcendent',color: '#F87171', glow: true,  particles: true  },
  9:  { label: 'Awakened One',color: '#67E8F9', glow: true,  particles: true  },
  10: { label: 'System Master',color: '#FFFFFF', glow: true,  particles: true  },
};

// Stable particle positions — generated once per tier
function genParticles(n) {
  return Array.from({ length: n }, (_, i) => ({
    x: 10 + (i / n) * 80,
    size: 2 + (i % 3),
    duration: 2.5 + (i % 3) * 0.8,
    delay: i * 0.45,
  }));
}

function AvatarSVG({ tier, breathing, glowing }) {
  const cfg = TIER_CONFIG[tier];
  const c = cfg.color;
  const sw = 16 + tier * 2.2;
  const bw = 8 + tier * 1.4;
  const aw = 4 + tier * 0.7;

  const glowFilter = glowing
    ? `drop-shadow(0 0 20px ${c}) drop-shadow(0 0 8px ${c})`
    : cfg.glow
    ? `drop-shadow(0 0 8px ${c}88)`
    : 'none';

  return (
    <svg
      width="110" height="200" viewBox="0 0 100 200"
      style={{
        transform: breathing ? 'scaleY(1.015)' : 'scaleY(1)',
        transition: 'transform 3.5s ease-in-out, filter 0.3s ease',
        filter: glowFilter,
        overflow: 'visible',
      }}
    >
      <defs>
        <linearGradient id={`ag${tier}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={c} stopOpacity="1" />
          <stop offset="100%" stopColor={c} stopOpacity="0.5" />
        </linearGradient>
        {tier >= 3 && (
          <radialGradient id={`aura${tier}`} cx="50%" cy="40%" r="60%">
            <stop offset="0%" stopColor={c} stopOpacity="0.3" />
            <stop offset="100%" stopColor={c} stopOpacity="0" />
          </radialGradient>
        )}
      </defs>

      {tier >= 3 && <ellipse cx="50" cy="90" rx="52" ry="100" fill={`url(#aura${tier})`} />}

      {tier >= 4 && (
        <>
          <ellipse cx="50" cy="40" rx={sw + 5} ry="9" fill={c} opacity="0.18" />
          <rect x={50 - bw - 2} y="44" width={bw * 2 + 4} height="3" rx="1.5" fill={c} opacity="0.3" />
        </>
      )}

      {/* Head */}
      <circle cx="50" cy="18" r={11 + Math.min(tier, 4) * 0.5} fill={`url(#ag${tier})`} />

      {/* Eyes (tier 5+) */}
      {tier >= 5 && (
        <>
          <circle cx="46" cy="17" r="2.5" fill={c} opacity="0.95" />
          <circle cx="54" cy="17" r="2.5" fill={c} opacity="0.95" />
          <circle cx="46" cy="17" r="4" fill={c} opacity="0.2" />
          <circle cx="54" cy="17" r="4" fill={c} opacity="0.2" />
        </>
      )}

      <rect x="46" y="28" width="8" height="7" rx="3" fill={`url(#ag${tier})`} />
      <ellipse cx="50" cy="38" rx={sw} ry={6 + tier * 0.3} fill={`url(#ag${tier})`} />
      <path d={`M ${50-sw} 38 Q ${50-sw+4} 82 ${50-bw} 92 L ${50+bw} 92 Q ${50+sw-4} 82 ${50+sw} 38 Z`}
        fill={`url(#ag${tier})`} opacity="0.95" />

      {tier >= 2 && (
        <>
          <ellipse cx={50 - bw * 0.55} cy="52" rx={bw * 0.55} ry={8 + tier * 0.5} fill={c} opacity="0.3" />
          <ellipse cx={50 + bw * 0.55} cy="52" rx={bw * 0.55} ry={8 + tier * 0.5} fill={c} opacity="0.3" />
        </>
      )}

      {tier >= 3 && (
        <>
          <rect x="46" y="64" width="8" height="5" rx="2" fill={c} opacity="0.2" />
          <rect x="46" y="72" width="8" height="5" rx="2" fill={c} opacity="0.2" />
        </>
      )}

      <rect x={50-sw-aw+1} y="36" width={aw} height={32+tier*2} rx={aw/2} fill={`url(#ag${tier})`} />
      <rect x={50+sw-1}    y="36" width={aw} height={32+tier*2} rx={aw/2} fill={`url(#ag${tier})`} />
      <rect x={50-sw-aw+2} y={66+tier*2} width={aw-1} height={22} rx={(aw-1)/2} fill={`url(#ag${tier})`} opacity="0.8" />
      <rect x={50+sw}      y={66+tier*2} width={aw-1} height={22} rx={(aw-1)/2} fill={`url(#ag${tier})`} opacity="0.8" />

      <ellipse cx="50" cy="92" rx={bw+5} ry="6" fill={`url(#ag${tier})`} />
      <rect x={50-bw-1} y="96" width={bw+2} height={52} rx="5" fill={`url(#ag${tier})`} />
      <rect x={50+1}    y="96" width={bw+2} height={52} rx="5" fill={`url(#ag${tier})`} />

      {tier >= 4 && (
        <>
          <rect x={50-bw} y="136" width={bw+2} height="14" rx="4" fill={c} opacity="0.4" />
          <rect x={50+2}  y="136" width={bw+2} height="14" rx="4" fill={c} opacity="0.4" />
        </>
      )}

      {tier >= 9 && (
        <ellipse cx="50" cy="130" rx="38" ry="70" fill={c} opacity="0.06" />
      )}
    </svg>
  );
}

export default function RPGHumanoidAvatar({ level = 0, levelUp = false }) {
  const tier = useMemo(() => getAvatarTier(level), [level]);
  const cfg = TIER_CONFIG[tier];

  const [breathing, setBreathing] = useState(false);
  const [glowing, setGlowing] = useState(false);
  const prevLevelUp = useRef(false);

  // Stable particle list — recalculate only when tier changes
  const particles = useMemo(() => cfg.particles ? genParticles(8) : [], [tier]);

  useEffect(() => {
    const iv = setInterval(() => setBreathing(b => !b), 3500);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    if (levelUp && !prevLevelUp.current) {
      setGlowing(true);
      const t = setTimeout(() => setGlowing(false), 1800);
      return () => clearTimeout(t);
    }
    prevLevelUp.current = levelUp;
  }, [levelUp]);

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative flex items-center justify-center" style={{ width: 120, height: 215 }}>

        {/* Ambient aura */}
        {tier >= 1 && (
          <div style={{
            position: 'absolute', inset: -10, borderRadius: '50%',
            background: `radial-gradient(ellipse, ${cfg.color}22 0%, transparent 70%)`,
            animation: tier >= 5 ? 'breatheAura 3s ease-in-out infinite' : 'none',
          }} />
        )}

        {/* Particles */}
        {cfg.particles && (
          <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
            {particles.map((p, i) => (
              <div key={i} style={{
                position: 'absolute', left: `${p.x}%`, bottom: 0,
                width: p.size, height: p.size, borderRadius: '50%',
                background: cfg.color, opacity: 0,
                animation: `floatUp ${p.duration}s ${p.delay}s ease-out infinite`,
              }} />
            ))}
          </div>
        )}

        {/* Level-up burst */}
        {glowing && (
          <div style={{
            position: 'absolute', inset: -20, borderRadius: '50%',
            background: `radial-gradient(circle, ${cfg.color}55 0%, transparent 70%)`,
            animation: 'pingOnce 1.2s ease-out forwards', pointerEvents: 'none',
          }} />
        )}

        <AvatarSVG tier={tier} breathing={breathing} glowing={glowing} />
      </div>

      <div className="text-center">
        <p className="text-sm font-bold tracking-wide" style={{ color: cfg.color }}>{cfg.label}</p>
        <p className="text-xs" style={{ color: `${cfg.color}88` }}>Tier {tier}</p>
      </div>

      <style>{`
        @keyframes floatUp {
          0% { transform: translateY(0); opacity: 0.8; }
          100% { transform: translateY(-130px); opacity: 0; }
        }
        @keyframes breatheAura {
          0%, 100% { opacity: 0.5; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.1); }
        }
        @keyframes pingOnce {
          0% { transform: scale(0.7); opacity: 1; }
          100% { transform: scale(2.8); opacity: 0; }
        }
      `}</style>
    </div>
  );
}
