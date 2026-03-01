import React, { memo, useEffect, useId, useMemo, useRef, useState } from 'react';
import { xpBetweenLevels, xpIntoCurrentLevel } from './gameEngine';
import './AvatarEvolution.css';

const SHADOW_DEBT_BASE_THRESHOLD = 180;

export function getAvatarStage(level = 0) {
  const safeLevel = Math.max(0, Number(level) || 0);
  if (safeLevel >= 16) return 3;
  if (safeLevel >= 8) return 2;
  if (safeLevel >= 3) return 1;
  return 0;
}

// SVG/CSS-only avatar currently has no external textures to preload.
// This hook exists so future sprite/sound assets can be warmed up centrally.
export function preloadAvatarEvolutionAssets() {
  return Promise.resolve();
}

function getShadowDebtThreshold(level = 0) {
  return Math.max(SHADOW_DEBT_BASE_THRESHOLD, Math.floor((Number(level) || 0) * 35));
}

export function mapAvatarEvolutionState({
  level = 0,
  totalXp = 0,
  streak = 0,
  shadowDebt = 0,
  stability = 100,
  relicCount = 0,
} = {}) {
  const safeLevel = Math.max(0, Number(level) || 0);
  const safeTotalXp = Math.max(0, Number(totalXp) || 0);
  const safeStreak = Math.max(0, Number(streak) || 0);
  const safeShadowDebt = Math.max(0, Number(shadowDebt) || 0);
  const safeStability = Math.max(0, Math.min(100, Number(stability) || 0));
  const safeRelics = Math.max(0, Number(relicCount) || 0);

  const stage = getAvatarStage(safeLevel);
  const shadowThreshold = getShadowDebtThreshold(safeLevel);
  const debtDamaged = safeShadowDebt > shadowThreshold;
  const debtSevere = safeShadowDebt > shadowThreshold * 2;
  const unstable = safeStability < 30;
  const streakHot = safeStreak > 7;
  const hasRelic = safeRelics > 0;

  const levelGap = Math.max(1, xpBetweenLevels(safeLevel));
  const intoLevel = Math.max(0, xpIntoCurrentLevel(safeTotalXp));
  const xpRatio = Math.max(0, Math.min(1, intoLevel / levelGap));
  const xpBand = xpRatio >= 0.66 ? 'high' : (xpRatio >= 0.33 ? 'mid' : 'low');

  return {
    stage,
    xpRatio,
    xpBand,
    debtDamaged,
    debtSevere,
    unstable,
    streakHot,
    hasRelic,
    relicCount: safeRelics,
  };
}

const AvatarEvolution = memo(function AvatarEvolution({
  level = 0,
  totalXp = 0,
  streak = 0,
  shadowDebt = 0,
  stability = 100,
  relicCount = 0,
  levelUp = false,
  skin = 'default',
  seasonalArmor = null,
  guildInsignia = null,
  betMode = false,
  className = '',
}) {
  const [xpBurst, setXpBurst] = useState(false);
  const [victoryPose, setVictoryPose] = useState(false);
  const prevXpRef = useRef(Math.max(0, Number(totalXp) || 0));
  const xpBurstTimerRef = useRef(null);
  const victoryTimerRef = useRef(null);
  const uid = useId().replace(/:/g, '');

  const state = useMemo(() => (
    mapAvatarEvolutionState({ level, totalXp, streak, shadowDebt, stability, relicCount })
  ), [level, totalXp, streak, shadowDebt, stability, relicCount]);

  useEffect(() => {
    const currentXp = Math.max(0, Number(totalXp) || 0);
    if (currentXp > prevXpRef.current) {
      setXpBurst(true);
      if (xpBurstTimerRef.current) clearTimeout(xpBurstTimerRef.current);
      xpBurstTimerRef.current = setTimeout(() => setXpBurst(false), state.stage >= 3 ? 1200 : 850);
    }
    prevXpRef.current = currentXp;
  }, [totalXp, state.stage]);

  useEffect(() => {
    if (!levelUp || state.stage < 3) return;
    setVictoryPose(true);
    if (victoryTimerRef.current) clearTimeout(victoryTimerRef.current);
    victoryTimerRef.current = setTimeout(() => setVictoryPose(false), 900);
  }, [levelUp, state.stage]);

  useEffect(() => () => {
    if (xpBurstTimerRef.current) clearTimeout(xpBurstTimerRef.current);
    if (victoryTimerRef.current) clearTimeout(victoryTimerRef.current);
  }, []);

  const leftLegX = state.stage >= 1 ? 52 : 56;
  const rightLegX = state.stage >= 1 ? 80 : 76;
  const skinClass = useMemo(() => {
    const key = String(skin || 'default').toLowerCase().replace(/[^a-z0-9_-]/g, '');
    return key ? `aev--skin-${key}` : 'aev--skin-default';
  }, [skin]);

  const bodyClasses = useMemo(() => ([
    'aev',
    skinClass,
    `aev--stage-${state.stage}`,
    `aev--xp-${state.xpBand}`,
    state.debtDamaged ? 'aev--debt' : '',
    state.debtSevere ? 'aev--debt-severe' : '',
    state.unstable ? 'aev--unstable' : '',
    state.streakHot ? 'aev--streak-hot' : '',
    state.hasRelic ? 'aev--relic' : '',
    xpBurst ? 'aev--xp-burst' : '',
    victoryPose ? 'aev--victory' : '',
    className,
  ].filter(Boolean).join(' ')), [state, xpBurst, victoryPose, className, skinClass]);

  const auraCoolId = `aev-aura-cool-${uid}`;
  const auraHotId = `aev-aura-hot-${uid}`;
  const bodyId = `aev-body-${uid}`;
  const armorId = `aev-armor-${uid}`;
  const relicId = `aev-relic-${uid}`;

  return (
    <div className={bodyClasses} role="img" aria-label={`Avatar stage ${state.stage}`}>
      <svg className="aev-svg" viewBox="0 0 144 220" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id={bodyId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#C7D2FE" />
            <stop offset="100%" stopColor="#64748B" />
          </linearGradient>
          <linearGradient id={armorId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#38BDF8" />
            <stop offset="100%" stopColor="#0F172A" />
          </linearGradient>
          <linearGradient id={relicId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#FCD34D" />
            <stop offset="100%" stopColor="#F59E0B" />
          </linearGradient>
          <radialGradient id={auraCoolId} cx="50%" cy="42%" r="60%">
            <stop offset="0%" stopColor="#67E8F9" stopOpacity="0.62" />
            <stop offset="100%" stopColor="#0EA5E9" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={auraHotId} cx="50%" cy="42%" r="60%">
            <stop offset="0%" stopColor="#FBBF24" stopOpacity="0.75" />
            <stop offset="100%" stopColor="#F97316" stopOpacity="0" />
          </radialGradient>
        </defs>

        <g className="aev-layer aev-aura">
          <ellipse className="aev-aura-core" cx="72" cy="104" rx="46" ry="74" fill={`url(#${state.streakHot ? auraHotId : auraCoolId})`} />
          <ellipse className="aev-aura-ring" cx="72" cy="112" rx="54" ry="86" fill={`url(#${state.streakHot ? auraHotId : auraCoolId})`} />
        </g>

        <g className="aev-layer aev-burst">
          <circle className="aev-burst-ring" cx="72" cy="104" r="24" />
        </g>

        <g className="aev-layer aev-particles" aria-hidden="true">
          <circle className="aev-particle aev-particle-1" cx="40" cy="170" r="2.2" />
          <circle className="aev-particle aev-particle-2" cx="58" cy="176" r="2.4" />
          <circle className="aev-particle aev-particle-3" cx="88" cy="175" r="2.2" />
          <circle className="aev-particle aev-particle-4" cx="104" cy="168" r="2.8" />
        </g>

        {state.stage >= 3 && (
          <g className="aev-layer aev-trail" aria-hidden="true">
            <circle className="aev-trail-dot aev-trail-dot-1" cx="30" cy="154" r="2.6" />
            <circle className="aev-trail-dot aev-trail-dot-2" cx="20" cy="138" r="2.1" />
            <circle className="aev-trail-dot aev-trail-dot-3" cx="14" cy="120" r="1.8" />
          </g>
        )}

        <g className="aev-layer aev-body-root">
          <g className="aev-layer aev-base">
            <circle className="aev-head" cx="72" cy="30" r="14" fill={`url(#${bodyId})`} />
            <rect className="aev-neck" x="67" y="42" width="10" height="8" rx="4" fill={`url(#${bodyId})`} />
            <path className="aev-torso" d="M52 56 C49 82 49 118 52 146 L92 146 C95 118 95 82 92 56 Z" fill={`url(#${bodyId})`} />
            <rect className="aev-hip" x="56" y="144" width="32" height="10" rx="5" fill={`url(#${bodyId})`} />
            <rect className="aev-arm" x="41" y="64" width="11" height="44" rx="5.5" fill={`url(#${bodyId})`} />
            <rect className="aev-forearm" x="38" y="104" width="11" height="32" rx="5.5" fill={`url(#${bodyId})`} />
            <rect className="aev-arm" x="92" y="64" width="11" height="44" rx="5.5" fill={`url(#${bodyId})`} />
            <rect className="aev-forearm" x="95" y="104" width="11" height="32" rx="5.5" fill={`url(#${bodyId})`} />
            <rect className="aev-leg" x={leftLegX} y="154" width="13" height="34" rx="6.5" fill={`url(#${bodyId})`} />
            <rect className="aev-shin" x={leftLegX + 1} y="184" width="12" height="28" rx="6" fill={`url(#${bodyId})`} />
            <rect className="aev-leg" x={rightLegX} y="154" width="13" height="34" rx="6.5" fill={`url(#${bodyId})`} />
            <rect className="aev-shin" x={rightLegX} y="184" width="12" height="28" rx="6" fill={`url(#${bodyId})`} />
          </g>

          {state.stage >= 1 && (
            <g className="aev-layer aev-armor-fragments">
              <path d="M56 58 L72 50 L88 58 L84 92 L60 92 Z" fill={`url(#${armorId})`} opacity="0.7" />
              <path d="M48 64 L60 62 L62 76 L50 82 Z" fill={`url(#${armorId})`} opacity="0.8" />
              <path d="M96 64 L84 62 L82 76 L94 82 Z" fill={`url(#${armorId})`} opacity="0.8" />
            </g>
          )}

          {state.stage >= 2 && (
            <g className="aev-layer aev-armor-detail">
              <path d="M60 100 L84 100 L80 142 L64 142 Z" fill={`url(#${armorId})`} opacity="0.82" />
              <path d="M62 104 L82 104" className="aev-detail-line" />
              <path d="M61 116 L83 116" className="aev-detail-line" />
              <path d="M60 128 L84 128" className="aev-detail-line" />
            </g>
          )}

          {state.stage >= 2 && seasonalArmor && (
            <g className="aev-layer aev-seasonal-armor">
              <path d="M46 78 L58 74 L60 86 L48 92 Z" fill={`url(#${armorId})`} opacity="0.95" />
              <path d="M98 78 L86 74 L84 86 L96 92 Z" fill={`url(#${armorId})`} opacity="0.95" />
            </g>
          )}

          {state.stage >= 3 && (
            <g className="aev-layer aev-armor-full">
              <path d="M72 15 L79 24 L72 32 L65 24 Z" fill={`url(#${armorId})`} />
              <path d="M50 154 L64 146 L66 182 L51 188 Z" fill={`url(#${armorId})`} opacity="0.9" />
              <path d="M94 154 L80 146 L78 182 L93 188 Z" fill={`url(#${armorId})`} opacity="0.9" />
              <path d="M47 88 L60 88 L61 130 L47 134 Z" fill={`url(#${armorId})`} opacity="0.9" />
              <path d="M97 88 L83 88 L82 130 L96 134 Z" fill={`url(#${armorId})`} opacity="0.9" />
            </g>
          )}

          {state.stage >= 1 && (
            <g className="aev-layer aev-eyes">
              <circle cx="67" cy="30" r="1.8" />
              <circle cx="77" cy="30" r="1.8" />
            </g>
          )}

          <g className="aev-layer aev-cracks">
            <path d="M66 88 L63 96 L66 104 L62 112" />
            <path d="M80 90 L84 102 L80 112 L83 122" />
            <path d="M72 120 L69 130 L74 138 L70 147" />
          </g>
        </g>

        {state.hasRelic && (
          <g className="aev-layer aev-relic-symbol">
            <circle className="aev-relic-halo" cx="112" cy="52" r="13" />
            <path
              className="aev-relic-core"
              d="M112 42 L115 49 L123 49 L117 54 L120 61 L112 57 L104 61 L107 54 L101 49 L109 49 Z"
              fill={`url(#${relicId})`}
            />
            <text className="aev-relic-count" x="112" y="72">{Math.min(99, state.relicCount)}</text>
          </g>
        )}

        {guildInsignia && (
          <g className="aev-layer aev-guild-insignia">
            <circle cx="34" cy="46" r="10" className="aev-guild-core" />
            <text x="34" y="49" className="aev-guild-text">{String(guildInsignia).slice(0, 1).toUpperCase()}</text>
          </g>
        )}

        {betMode && (
          <g className="aev-layer aev-bet-badge">
            <rect x="96" y="18" width="30" height="11" rx="5.5" className="aev-bet-chip" />
            <text x="111" y="26" className="aev-bet-text">BET</text>
          </g>
        )}
      </svg>
    </div>
  );
});

export default AvatarEvolution;
