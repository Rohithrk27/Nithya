import React, { memo, useId, useMemo } from 'react';
import { mapAvatarEvolutionState } from './AvatarEvolution';
import './BaseHumanoidCharacter.css';

const BaseHumanoidCharacter = memo(function BaseHumanoidCharacter({
  level = 0,
  totalXp = 0,
  streak = 0,
  shadowDebt = 0,
  stability = 100,
  relicCount = 0,
  levelUp = false,
  className = '',
  showBackground = true,
  animate = true,
}) {
  const uid = useId().replace(/:/g, '');
  const state = useMemo(() => (
    mapAvatarEvolutionState({ level, totalXp, streak, shadowDebt, stability, relicCount })
  ), [level, totalXp, streak, shadowDebt, stability, relicCount]);

  const ids = useMemo(() => ({
    surface: `bhc-surface-${uid}`,
    highlight: `bhc-highlight-${uid}`,
    rim: `bhc-rim-${uid}`,
    eyeGlow: `bhc-eye-glow-${uid}`,
    eyeFill: `bhc-eye-fill-${uid}`,
    auraCool: `bhc-aura-cool-${uid}`,
    auraHot: `bhc-aura-hot-${uid}`,
    relic: `bhc-relic-${uid}`,
  }), [uid]);

  const rootClassName = [
    'bhc',
    showBackground ? 'bhc--with-bg' : '',
    animate ? 'bhc--animate' : 'bhc--still',
    `bhc--stage-${state.stage}`,
    `bhc--xp-${state.xpBand}`,
    state.debtDamaged ? 'bhc--debt' : '',
    state.debtSevere ? 'bhc--debt-severe' : '',
    state.unstable ? 'bhc--unstable' : '',
    state.streakHot ? 'bhc--streak-hot' : '',
    state.hasRelic ? 'bhc--relic' : '',
    levelUp ? 'bhc--levelup' : '',
    className,
  ].filter(Boolean).join(' ');

  return (
    <div className={rootClassName} role="img" aria-label={`Evolving humanoid avatar stage ${state.stage}`}>
      <div className="bhc-radial-glow" aria-hidden="true" />

      <svg className="bhc-svg" viewBox="0 0 300 640" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id={ids.surface} x1="18%" y1="10%" x2="82%" y2="92%">
            <stop offset="0%" stopColor="#F3F8FF" />
            <stop offset="46%" stopColor="#DDE8F4" />
            <stop offset="100%" stopColor="#B7C7D7" />
          </linearGradient>
          <linearGradient id={ids.highlight} x1="10%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="rgba(180, 226, 255, 0.52)" />
            <stop offset="100%" stopColor="rgba(180, 226, 255, 0)" />
          </linearGradient>
          <linearGradient id={ids.rim} x1="12%" y1="20%" x2="88%" y2="20%">
            <stop offset="0%" stopColor="rgba(120, 214, 255, 0)" />
            <stop offset="50%" stopColor="rgba(145, 224, 255, 0.56)" />
            <stop offset="100%" stopColor="rgba(120, 214, 255, 0)" />
          </linearGradient>
          <radialGradient id={ids.eyeFill} cx="50%" cy="50%" r="60%">
            <stop offset="0%" stopColor="#C9F4FF" />
            <stop offset="100%" stopColor="#7BE6FF" />
          </radialGradient>
          <radialGradient id={ids.auraCool} cx="50%" cy="45%" r="58%">
            <stop offset="0%" stopColor="#67E8F9" stopOpacity="0.72" />
            <stop offset="100%" stopColor="#0EA5E9" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={ids.auraHot} cx="50%" cy="45%" r="58%">
            <stop offset="0%" stopColor="#FBBF24" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#F97316" stopOpacity="0" />
          </radialGradient>
          <linearGradient id={ids.relic} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#FDE68A" />
            <stop offset="100%" stopColor="#F59E0B" />
          </linearGradient>
          <filter id={ids.eyeGlow} x="-200%" y="-200%" width="400%" height="400%">
            <feGaussianBlur stdDeviation="2.2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <g className="bhc-aura-layer" aria-hidden="true">
          <ellipse className="bhc-aura-core" cx="150" cy="324" rx="100" ry="214" fill={`url(#${state.streakHot ? ids.auraHot : ids.auraCool})`} />
          <ellipse className="bhc-aura-ring" cx="150" cy="336" rx="116" ry="232" fill={`url(#${state.streakHot ? ids.auraHot : ids.auraCool})`} />
        </g>

        <g className="bhc-burst-layer" aria-hidden="true">
          <circle className="bhc-burst-ring" cx="150" cy="320" r="38" />
        </g>

        <g className="bhc-particles" aria-hidden="true">
          <circle className="bhc-particle bhc-particle-1" cx="56" cy="574" r="1.9" />
          <circle className="bhc-particle bhc-particle-2" cx="92" cy="552" r="1.6" />
          <circle className="bhc-particle bhc-particle-3" cx="236" cy="566" r="1.7" />
          <circle className="bhc-particle bhc-particle-4" cx="210" cy="540" r="1.4" />
          <circle className="bhc-particle bhc-particle-5" cx="40" cy="516" r="1.3" />
          <circle className="bhc-particle bhc-particle-6" cx="256" cy="506" r="1.5" />
        </g>

        <g className="bhc-trail" aria-hidden="true">
          <circle className="bhc-trail-dot bhc-trail-dot-1" cx="36" cy="426" r="2.2" />
          <circle className="bhc-trail-dot bhc-trail-dot-2" cx="26" cy="408" r="1.8" />
          <circle className="bhc-trail-dot bhc-trail-dot-3" cx="16" cy="386" r="1.5" />
        </g>

        <g className="bhc-character">
          <g className="bhc-rim-light">
            <path
              d="M103 87 C111 64 132 49 150 49 C168 49 189 64 197 87"
              fill="none"
              stroke={`url(#${ids.rim})`}
              strokeWidth="10"
              strokeLinecap="round"
            />
            <path
              d="M92 196 C102 176 124 166 150 166 C176 166 198 176 208 196"
              fill="none"
              stroke={`url(#${ids.rim})`}
              strokeWidth="8"
              strokeLinecap="round"
            />
          </g>

          <g className="bhc-energy-lines" aria-hidden="true">
            <path d="M122 188 C116 246 116 336 126 432" />
            <path d="M150 174 C150 252 150 356 150 456" />
            <path d="M178 188 C184 246 184 336 174 432" />
          </g>

          <g className="bhc-body">
            <ellipse className="bhc-surface" cx="150" cy="100" rx="44" ry="52" fill={`url(#${ids.surface})`} />
            <rect className="bhc-surface" x="136" y="148" width="28" height="24" rx="12" fill={`url(#${ids.surface})`} />

            <path
              className="bhc-surface"
              d="M96 194 C104 176 126 166 150 166 C174 166 196 176 204 194 C206 244 206 298 198 356 C191 403 182 438 172 462 L128 462 C118 438 109 403 102 356 C94 298 94 244 96 194 Z"
              fill={`url(#${ids.surface})`}
            />

            <ellipse className="bhc-surface" cx="150" cy="464" rx="34" ry="20" fill={`url(#${ids.surface})`} />

            <rect className="bhc-surface" x="78" y="208" width="24" height="122" rx="12" fill={`url(#${ids.surface})`} />
            <rect className="bhc-surface" x="72" y="320" width="22" height="100" rx="11" fill={`url(#${ids.surface})`} />
            <ellipse className="bhc-surface" cx="83" cy="430" rx="13" ry="12" fill={`url(#${ids.surface})`} />

            <rect className="bhc-surface" x="198" y="208" width="24" height="122" rx="12" fill={`url(#${ids.surface})`} />
            <rect className="bhc-surface" x="206" y="320" width="22" height="100" rx="11" fill={`url(#${ids.surface})`} />
            <ellipse className="bhc-surface" cx="217" cy="430" rx="13" ry="12" fill={`url(#${ids.surface})`} />

            <rect className="bhc-surface" x="124" y="480" width="24" height="88" rx="12" fill={`url(#${ids.surface})`} />
            <rect className="bhc-surface" x="122" y="558" width="24" height="60" rx="12" fill={`url(#${ids.surface})`} />
            <ellipse className="bhc-surface" cx="134" cy="624" rx="18" ry="9" fill={`url(#${ids.surface})`} />

            <rect className="bhc-surface" x="152" y="480" width="24" height="88" rx="12" fill={`url(#${ids.surface})`} />
            <rect className="bhc-surface" x="154" y="558" width="24" height="60" rx="12" fill={`url(#${ids.surface})`} />
            <ellipse className="bhc-surface" cx="166" cy="624" rx="18" ry="9" fill={`url(#${ids.surface})`} />

            <circle className="bhc-joint" cx="102" cy="210" r="9" />
            <circle className="bhc-joint" cx="198" cy="210" r="9" />
            <circle className="bhc-joint" cx="94" cy="324" r="8" />
            <circle className="bhc-joint" cx="206" cy="324" r="8" />
            <circle className="bhc-joint" cx="124" cy="486" r="8" />
            <circle className="bhc-joint" cx="176" cy="486" r="8" />
            <circle className="bhc-joint" cx="122" cy="562" r="8" />
            <circle className="bhc-joint" cx="178" cy="562" r="8" />

            <path
              className="bhc-highlight"
              d="M126 188 C112 250 111 334 126 438 M150 174 C150 256 150 366 150 452 M173 186 C188 250 189 334 174 438"
              fill="none"
              stroke={`url(#${ids.highlight})`}
              strokeWidth="6"
              strokeLinecap="round"
              opacity="0.55"
            />
          </g>

          <g className="bhc-cracks">
            <path d="M136 224 L130 248 L136 270 L128 294" />
            <path d="M166 228 L172 252 L166 278 L174 302" />
            <path d="M150 288 L144 318 L152 346 L146 372" />
          </g>

          <g className="bhc-face">
            <ellipse className="bhc-eye-glow" cx="134" cy="104" rx="9" ry="4" fill="rgba(98, 233, 255, 0.3)" filter={`url(#${ids.eyeGlow})`} />
            <ellipse className="bhc-eye-glow" cx="166" cy="104" rx="9" ry="4" fill="rgba(98, 233, 255, 0.3)" filter={`url(#${ids.eyeGlow})`} />
            <ellipse className="bhc-eye" cx="134" cy="104" rx="5.4" ry="2.6" fill={`url(#${ids.eyeFill})`} />
            <ellipse className="bhc-eye" cx="166" cy="104" rx="5.4" ry="2.6" fill={`url(#${ids.eyeFill})`} />
          </g>
        </g>

        <g className="bhc-relic-symbol" aria-hidden="true">
          <circle className="bhc-relic-halo" cx="238" cy="132" r="15" />
          <path
            d="M238 119 L241 127 L250 127 L243 132 L246 140 L238 135 L230 140 L233 132 L226 127 L235 127 Z"
            fill={`url(#${ids.relic})`}
            className="bhc-relic-core"
          />
        </g>
      </svg>
    </div>
  );
});

export default BaseHumanoidCharacter;
