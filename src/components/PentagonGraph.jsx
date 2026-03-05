import React, { useMemo } from 'react';

const DEFAULT_STATS = [
  { key: 'strength', label: 'STR', color: '#F87171' },
  { key: 'intelligence', label: 'INT', color: '#60A5FA' },
  { key: 'discipline', label: 'DIS', color: '#38BDF8' },
  { key: 'health', label: 'HP', color: '#34D399' },
  { key: 'career', label: 'CAR', color: '#FBBF24' },
];

const MAX_STAT = 150;
const SIZE = 160;

function getPoint(index, value, totalPoints, center, radius) {
  const angle = (Math.PI * 2 * index) / totalPoints - Math.PI / 2;
  const normalizedValue = Math.min(value / MAX_STAT, 1);
  const r = radius * normalizedValue;
  return {
    x: center + r * Math.cos(angle),
    y: center + r * Math.sin(angle),
  };
}

function getGridPoint(index, totalPoints, gridLevel, center, radius) {
  const angle = (Math.PI * 2 * index) / totalPoints - Math.PI / 2;
  const r = radius * gridLevel;
  return {
    x: center + r * Math.cos(angle),
    y: center + r * Math.sin(angle),
  };
}

export default function PentagonGraph({ stats, statMeta = DEFAULT_STATS, size = SIZE }) {
  const safeSize = Math.max(120, Number(size || SIZE));
  const center = safeSize / 2;
  const radius = safeSize * 0.33;
  const labelRadius = Math.min(safeSize * 0.44, radius * 1.18);
  const dotRadius = Math.max(4, Math.round(safeSize * 0.028));
  const labelFontSize = Math.max(9, Math.round(safeSize * 0.06));
  const valueFontSize = Math.max(8, Math.round(safeSize * 0.045));
  const avgFontSize = Math.max(20, Math.round(safeSize * 0.14));
  const visibleStats = useMemo(
    () => (Array.isArray(statMeta) && statMeta.length > 0 ? statMeta : DEFAULT_STATS),
    [statMeta],
  );

  const points = useMemo(() => {
    return visibleStats.map((stat, i) => {
      const value = stats[stat.key] || 0;
      return getPoint(i, value, visibleStats.length, center, radius);
    });
  }, [stats, visibleStats, center, radius]);

  const polygonPoints = useMemo(() => {
    return points.map((p) => `${p.x} ${p.y}`).join(' ');
  }, [points]);

  const average = useMemo(() => {
    if (!visibleStats.length) return 0;
    const total = visibleStats.reduce((sum, stat) => sum + Number(stats[stat.key] || 0), 0);
    return Math.round(total / visibleStats.length);
  }, [stats, visibleStats]);

  const gridLevels = [0.25, 0.5, 0.75, 1];

  return (
    <div className="relative flex flex-col items-center">
      <svg width={safeSize} height={safeSize} className="block">
        {/* Grid lines */}
        {gridLevels.map((level, li) => (
          <polygon
            key={li}
            points={visibleStats.map((_, i) => {
              const p = getGridPoint(i, visibleStats.length, level, center, radius);
              return `${p.x} ${p.y}`;
            }).join(' ')}
            fill="none"
            stroke={li === 3 ? '#38BDF844' : '#1e3a4a'}
            strokeWidth={li === 3 ? 1.5 : 1}
            strokeDasharray={li === 3 ? '4 2' : 'none'}
          />
        ))}

        {/* Axis lines from center */}
        {visibleStats.map((_, i) => {
          const p = getGridPoint(i, visibleStats.length, 1, center, radius);
          return (
            <line
              key={i}
              x1={center}
              y1={center}
              x2={p.x}
              y2={p.y}
              stroke="#1e3a4a"
              strokeWidth={1}
            />
          );
        })}

        {/* Data polygon */}
        <polygon
          points={polygonPoints}
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
            r={dotRadius}
            fill={visibleStats[i].color}
            stroke="#0a191f"
            strokeWidth={2}
            className="animate-pulse"
            style={{
              filter: `drop-shadow(0 0 6px ${visibleStats[i].color}88)`,
            }}
          />
        ))}

        {/* Labels */}
        {visibleStats.map((stat, i) => {
          const p = getGridPoint(i, visibleStats.length, 1, center, labelRadius);
          const value = stats[stat.key] || 0;
          return (
            <g key={stat.key}>
              <text
                x={p.x}
                y={p.y - 6}
                textAnchor="middle"
                fill={stat.color}
                fontSize={labelFontSize}
                fontWeight="bold"
                className="tracking-widest"
                style={{ textShadow: `0 0 8px ${stat.color}66` }}
              >
                {stat.label}
              </text>
              <text
                x={p.x}
                y={p.y + 8}
                textAnchor="middle"
                fill="#94a3b8"
                fontSize={valueFontSize}
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
            <stop offset="100%" stopColor="#38BDF8" stopOpacity={0.2} />
          </linearGradient>
          <linearGradient id="statStrokeGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#38BDF8" />
            <stop offset="50%" stopColor="#38BDF8" />
            <stop offset="100%" stopColor="#22D3EE" />
          </linearGradient>
        </defs>
      </svg>

      {/* Center display */}
      <div 
        className="absolute inset-0 flex items-center justify-center pointer-events-none"
        style={{ width: safeSize, height: safeSize }}
      >
        <div className="text-center">
          <div className="font-black text-white" style={{ textShadow: '0 0 20px rgba(56,189,248,0.6)', fontSize: avgFontSize }}>
            {average}
          </div>
          <div className="text-[8px] font-bold tracking-widest" style={{ color: '#38BDF888' }}>
            AVG
          </div>
        </div>
      </div>
    </div>
  );
}

