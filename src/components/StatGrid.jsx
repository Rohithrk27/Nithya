import React, { useEffect, useRef, useState, useMemo } from 'react';
import { computeAllStats, passiveBonusPerStat } from './gameEngine';
import PentagonGraph from './PentagonGraph';

const STAT_META = [
  { key: 'strength',     label: 'STR', fullLabel: 'Strength',    color: '#F87171', icon: '💪' },
  { key: 'intelligence', label: 'INT', fullLabel: 'Intelligence', color: '#60A5FA', icon: '🧠' },
  { key: 'discipline',   label: 'DIS', fullLabel: 'Discipline',   color: '#A78BFA', icon: '⚡' },
  { key: 'health',       label: 'HP',  fullLabel: 'Health',       color: '#34D399', icon: '❤️' },
  { key: 'career',       label: 'CAR', fullLabel: 'Career',       color: '#FBBF24', icon: '🎯' },
  { key: 'social',       label: 'SOC', fullLabel: 'Social',       color: '#F472B6', icon: '🌐' },
  { key: 'consistency',  label: 'CON', fullLabel: 'Consistency',  color: '#38BDF8', icon: '🔥' },
];

const PENTAGON_STAT_KEYS = ['strength', 'intelligence', 'discipline', 'health', 'career'];

const MAX_STAT_DISPLAY = 200; // cap for bar width calculation

function AnimatedNumber({ value }) {
  const [display, setDisplay] = useState(value);
  const prev = useRef(value);

  useEffect(() => {
    if (value === prev.current) return;
    const diff = value - prev.current;
    const steps = 12;
    const step = diff / steps;
    let current = prev.current;
    let count = 0;
    const iv = setInterval(() => {
      count++;
      current += step;
      if (count >= steps) {
        setDisplay(value);
        clearInterval(iv);
      } else {
        setDisplay(Math.round(current));
      }
    }, 30);
    prev.current = value;
    return () => clearInterval(iv);
  }, [value]);

  return <>{display}</>;
}

function StatBar({ meta, value, canAllocate, onAllocate, flash }) {
  const pct = Math.min((value / MAX_STAT_DISPLAY) * 100, 100);
  const { color, label, fullLabel, icon } = meta;

  return (
    <div
      className="group transition-all duration-200"
      style={{
        outline: flash ? `1px solid ${color}88` : 'none',
        borderRadius: 6,
        padding: '2px 0',
        boxShadow: flash ? `0 0 8px ${color}44` : 'none',
      }}
    >
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5">
          <span className="text-sm leading-none">{icon}</span>
          <span className="text-xs font-bold tracking-widest" style={{ color }}>{label}</span>
          <span className="text-xs hidden sm:inline" style={{ color: `${color}66` }}>{fullLabel}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono font-bold" style={{ color }}>
            <AnimatedNumber value={value} />
          </span>
          {canAllocate && (
            <button
              onClick={onAllocate}
              className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-black transition-all hover:scale-125"
              style={{ background: `${color}33`, color, border: `1px solid ${color}88` }}
            >
              +
            </button>
          )}
        </div>
      </div>
      <div className="relative h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(15,32,39,0.9)' }}>
        <div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{
            width: `${pct}%`,
            background: `linear-gradient(90deg, ${color}88, ${color})`,
            boxShadow: `0 0 6px ${color}66`,
            transition: 'width 0.6s ease-out',
          }}
        />
      </div>
    </div>
  );
}

/**
 * StatGrid
 * profile: raw UserProfile record from DB
 * level: current computed level (from gameEngine.computeLevel)
 * statPoints: how many points can be allocated
 * onAllocate: (statKey) => void
 * flashStat: statKey that just increased (for flash animation)
 */
export default function StatGrid({ profile, level = 0, statPoints = 0, onAllocate, flashStat = null, compact = false, expandable = false }) {
  const finalStats = useMemo(() => computeAllStats(profile, level), [profile, level]);
  const bonus = useMemo(() => passiveBonusPerStat(level), [level]);
  const [expanded, setExpanded] = useState(!expandable);

  // Get stats for pentagon graph (first 5 stats)
  const pentagonStats = useMemo(() => {
    const stats = {};
    PENTAGON_STAT_KEYS.forEach(key => {
      stats[key] = finalStats[key] || 0;
    });
    return stats;
  }, [finalStats]);

  return (
    <div className="space-y-3">
      {/* Pentagon Graph */}
      <div className="flex justify-center mb-4">
        <button
          type="button"
          onClick={() => expandable && setExpanded((prev) => !prev)}
          className={expandable ? 'transition-transform duration-200 hover:scale-[1.02]' : ''}
          style={{ cursor: expandable ? 'pointer' : 'default' }}
          aria-label={expandable ? (expanded ? 'Collapse stat details' : 'Expand stat details') : 'Stat graph'}
        >
          <PentagonGraph stats={pentagonStats} size={180} />
          {expandable && (
            <p className="mt-2 text-center text-[10px] font-bold tracking-widest text-cyan-400">
              {expanded ? 'TAP TO COLLAPSE STATS' : 'TAP TO EXPAND FULL STATS'}
            </p>
          )}
        </button>
      </div>
      {!compact && expanded && (
        <>
      {statPoints > 0 && (
        <div
          className="text-center py-1.5 rounded-lg text-xs font-bold tracking-widest animate-pulse"
          style={{ background: '#FBBF2422', color: '#FBBF24', border: '1px solid #FBBF2466' }}
        >
          ✦ {statPoints} STAT POINT{statPoints !== 1 ? 'S' : ''} AVAILABLE
        </div>
      )}
      {bonus > 0 && (
        <div className="text-right text-xs" style={{ color: '#38BDF866' }}>
          +{bonus} passive level bonus applied
        </div>
      )}
      {STAT_META.map(meta => (
        <StatBar
          key={meta.key}
          meta={meta}
          value={finalStats[meta.key]}
          canAllocate={statPoints > 0}
          onAllocate={() => onAllocate(meta.key)}
          flash={flashStat === meta.key}
        />
      ))}
        </>
      )}
    </div>
  );
}
