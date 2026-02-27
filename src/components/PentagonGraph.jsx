import React, { useMemo } from 'react';

// 5 main stats for the pentagon
const PENTAGON_STATS = [
  { key: 'strength', label: 'STR', color: '#F87171' },
  { key: 'intelligence', label: 'INT', color: '#60A5FA' },
  { key: 'discipline', label: 'DIS', color: '#A78BFA' },
  { key: 'health', label: 'HP', color: '#34D399' },
  { key: 'career', label: 'CAR', color: '#FBBF24' },
];

const MAX_STAT = 150;
const SIZE = 160;
const CENTER = SIZE / 2;
const RADIUS = 70;

function getPoint(index, value, totalPoints) {
  const angle = (Math.PI * 2 * index) / totalPoints - Math.PI / 2;
  const normalizedValue = Math.min(value / MAX_STAT, 1);
  const r = RADIUS * normalizedValue;
  return {
    x: CENTER + r * Math.cos(angle),
    y: CENTER + r * Math.sin(angle),
  };
}

function getGridPoint(index, totalPoints, gridLevel) {
  const angle = (Math.PI * 2 * index) / totalPoints - Math.PI / 2;
  const r = RADIUS * gridLevel;
  return {
    x: CENTER + r * Math.cos(angle),
    y: CENTER + r * Math.sin(angle),
  };
}

export default function PentagonGraph({ stats, size = SIZE }) {
  const points = useMemo(() => {
    return PENTAGON_STATS.map((stat, i) => {
      const value = stats[stat.key] || 0;
      return getPoint(i, value, PENTAGON_STATS.length);
    });
  }, [stats]);

  const polygonPath = useMemo(() => {
    return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ') + ' Z';
  }, [points]);

  const gridLevels = [0.25, 0.5, 0.75, 1];

  return (
    <div className="relative flex flex-col items-center">
      <svg width={size} height={size} className="overflow-visible">
        {/* Grid lines - pentagons */}
        {gridLevels.map((level, li) => (
          <polygon
            key={li}
            points={PENTAGON_STATS.map((_, i) => {
              const p = getGridPoint(i, PENTAGON_STATS.length, level);
              return `${p.x} ${p.y}`;
            }).join(' ')}
            fill="none"
            stroke={li === 3 ? '#38BDF844' : '#1e3a4a'}
            strokeWidth={li === 3 ? 1.5 : 1}
            strokeDasharray={li === 3 ? '4 2' : 'none'}
          />
        ))}

        {/* Axis lines from center */}
        {PENTAGON_STATS.map((_, i) => {
          const p = getGridPoint(i, PENTAGON_STATS.length, 1);
          return (
            <line
              key={i}
              x1={CENTER}
              y1={CENTER}
              x2={p.x}
              y2={p.y}
              stroke="#1e3a4a"
              strokeWidth={1}
            />
          );
        })}

        {/* Data polygon */}
        <polygon
          points={polygonPath.replace(/[ML]/g, '').trim().split(' ').filter(Boolean).join(' ')}
          fill="url(#statGradient)"
          fillOpacity={0.3}
          stroke="url(#statStrokeGradient)"
          strokeWidth={2.5}
          className="drop-shadow-lg"
        />

        {/* Data points */}
        {points.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={5}
            fill={PENTAGON_STATS[i].color}
            stroke="#0a191f"
            strokeWidth={2}
            className="animate-pulse"
            style={{
              filter: `drop-shadow(0 0 6px ${PENTAGON_STATS[i].color}88)`,
            }}
          />
        ))}

        {/* Labels */}
        {PENTAGON_STATS.map((stat, i) => {
          const p = getGridPoint(i, PENTAGON_STATS.length, 1.35);
          const value = stats[stat.key] || 0;
          return (
            <g key={stat.key}>
              <text
                x={p.x}
                y={p.y - 8}
                textAnchor="middle"
                fill={stat.color}
                fontSize="10"
                fontWeight="bold"
                className="tracking-widest"
                style={{ textShadow: `0 0 8px ${stat.color}66` }}
              >
                {stat.label}
              </text>
              <text
                x={p.x}
                y={p.y + 4}
                textAnchor="middle"
                fill="#94a3b8"
                fontSize="8"
                fontWeight="bold"
              >
                {value}
              </text>
            </g>
          );
        })}

        {/* Gradients */}
        <defs>
          <linearGradient id="statGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#38BDF8" stopOpacity={0.4} />
            <stop offset="100%" stopColor="#A78BFA" stopOpacity={0.2} />
          </linearGradient>
          <linearGradient id="statStrokeGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#38BDF8" />
            <stop offset="50%" stopColor="#A78BFA" />
            <stop offset="100%" stopColor="#F472B6" />
          </linearGradient>
        </defs>
      </svg>

      {/* Center display */}
      <div 
        className="absolute inset-0 flex items-center justify-center pointer-events-none"
        style={{ width: size, height: size }}
      >
        <div className="text-center">
          <div className="text-2xl font-black text-white" style={{ textShadow: '0 0 20px rgba(56,189,248,0.6)' }}>
            {Math.round(Object.values(stats).reduce((a, b) => a + (b || 0), 0) / 5)}
          </div>
          <div className="text-[8px] font-bold tracking-widest" style={{ color: '#38BDF888' }}>
            AVG
          </div>
        </div>
      </div>
    </div>
  );
}
