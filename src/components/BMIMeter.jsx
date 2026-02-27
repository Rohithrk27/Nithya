import React, { useEffect, useState } from 'react';

const getBMICategory = (bmi) => {
  if (!bmi || bmi <= 0) return null;
  if (bmi < 18.5) return { label: 'Underweight', color: '#3B82F6', glow: '#3B82F6' };
  if (bmi < 25) return { label: 'Normal', color: '#22C55E', glow: '#22C55E' };
  if (bmi < 30) return { label: 'Overweight', color: '#F97316', glow: '#F97316' };
  return { label: 'Obese', color: '#EF4444', glow: '#EF4444' };
};

export default function BMIMeter({ bmi }) {
  const [displayBMI, setDisplayBMI] = useState(bmi || 0);
  const [shake, setShake] = useState(false);

  useEffect(() => {
    setDisplayBMI(bmi || 0);
    if (bmi >= 30) {
      setShake(true);
      setTimeout(() => setShake(false), 600);
    }
  }, [bmi]);

  const category = getBMICategory(displayBMI);
  const validBMI = displayBMI > 0 && displayBMI < 50;

  // Map BMI 15–40 to 0–100% arc
  const pct = validBMI ? Math.min(Math.max((displayBMI - 15) / 25, 0), 1) : 0;

  // SVG arc params
  const R = 70;
  const cx = 90;
  const cy = 90;
  const startAngle = -210;
  const sweepAngle = 240;
  const toRad = d => (d * Math.PI) / 180;

  const arcPath = (start, sweep, r) => {
    const s = toRad(start);
    const e = toRad(start + sweep);
    const x1 = cx + r * Math.cos(s);
    const y1 = cy + r * Math.sin(s);
    const x2 = cx + r * Math.cos(e);
    const y2 = cy + r * Math.sin(e);
    const large = sweep > 180 ? 1 : 0;
    return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
  };

  const fillAngle = startAngle + sweepAngle * pct;
  const needleRad = toRad(fillAngle);
  const needleX = cx + (R - 10) * Math.cos(needleRad);
  const needleY = cy + (R - 10) * Math.sin(needleRad);

  const isNormal = category?.label === 'Normal';

  return (
    <div className="flex flex-col items-center">
      <div className={`relative ${shake ? 'animate-[shake_0.5s_ease-in-out]' : ''}`}>
        <style>{`
          @keyframes shake { 0%,100%{transform:translateX(0)} 20%{transform:translateX(-6px)} 40%{transform:translateX(6px)} 60%{transform:translateX(-4px)} 80%{transform:translateX(4px)} }
          @keyframes breathe { 0%,100%{opacity:0.4;transform:scale(1)} 50%{opacity:0.8;transform:scale(1.05)} }
        `}</style>

        {isNormal && (
          <div
            className="absolute inset-0 rounded-full pointer-events-none"
            style={{
              background: `radial-gradient(circle, ${category.glow}22 0%, transparent 70%)`,
              animation: 'breathe 3s ease-in-out infinite'
            }}
          />
        )}

        <svg width="180" height="160" viewBox="0 0 180 160">
          {/* Track */}
          <path
            d={arcPath(startAngle, sweepAngle, R)}
            fill="none"
            stroke="#1E293B"
            strokeWidth="14"
            strokeLinecap="round"
          />
          {/* Gradient fill */}
          {validBMI && (
            <path
              d={arcPath(startAngle, sweepAngle * pct, R)}
              fill="none"
              stroke={category?.color || '#94A3B8'}
              strokeWidth="14"
              strokeLinecap="round"
              style={{ transition: 'all 0.6s cubic-bezier(0.4,0,0.2,1)', filter: `drop-shadow(0 0 6px ${category?.color}88)` }}
            />
          )}
          {/* Zone labels */}
          <text x={cx - 58} y={cy + 52} fill="#3B82F6" fontSize="8" opacity="0.7">15</text>
          <text x={cx + 50} y={cy + 52} fill="#EF4444" fontSize="8" opacity="0.7">40</text>

          {/* Center BMI */}
          <text x={cx} y={cy - 2} textAnchor="middle" fill="#F8FAFC" fontSize="28" fontWeight="bold" style={{ transition: 'all 0.4s ease' }}>
            {validBMI ? displayBMI.toFixed(1) : '—'}
          </text>
          <text x={cx} y={cy + 16} textAnchor="middle" fill="#94A3B8" fontSize="10">BMI</text>
        </svg>
      </div>

      {/* Category badge */}
      <div
        className="mt-1 px-4 py-1.5 rounded-full text-sm font-bold tracking-wide transition-all duration-500"
        style={{ color: category?.color || '#94A3B8', background: `${category?.color || '#334155'}22`, border: `1px solid ${category?.color || '#334155'}55` }}
      >
        {category?.label || 'Enter stats'}
      </div>

      {/* Medical silhouette illustration */}
      <div className="mt-4 opacity-20">
        <svg width="40" height="80" viewBox="0 0 40 80">
          <circle cx="20" cy="8" r="7" fill="#94A3B8" />
          <rect x="13" y="18" width="14" height="30" rx="6" fill="#94A3B8" />
          <rect x="5" y="20" width="8" height="22" rx="4" fill="#94A3B8" />
          <rect x="27" y="20" width="8" height="22" rx="4" fill="#94A3B8" />
          <rect x="13" y="46" width="6" height="28" rx="3" fill="#94A3B8" />
          <rect x="21" y="46" width="6" height="28" rx="3" fill="#94A3B8" />
        </svg>
      </div>
    </div>
  );
}