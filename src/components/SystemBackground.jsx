import React from 'react';

// Stable particle data — generated once
const PARTICLES = Array.from({ length: 40 }, (_, i) => ({
  x: (i * 37.3) % 100,
  y: (i * 53.7) % 100,
  size: 1 + (i % 3) * 0.6,
  duration: 18 + (i % 7) * 4,
  delay: -(i * 2.1),
  opacity: 0.08 + (i % 4) * 0.04,
}));

export default function SystemBackground({ children }) {
  return (
    <div className="relative min-h-screen overflow-x-hidden"
      style={{ background: 'linear-gradient(135deg, #0f2027 0%, #203a43 50%, #2c5364 100%)' }}>

      {/* Grid overlay */}
      <div style={{
        position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0,
        backgroundImage: `
          linear-gradient(rgba(56,189,248,0.04) 1px, transparent 1px),
          linear-gradient(90deg, rgba(56,189,248,0.04) 1px, transparent 1px)
        `,
        backgroundSize: '60px 60px',
      }} />

      {/* Ambient radial glow */}
      <div style={{
        position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0,
        background: 'radial-gradient(ellipse 80% 60% at 50% 0%, rgba(56,189,248,0.06) 0%, transparent 70%)',
      }} />

      {/* Slow moving holo ribbons */}
      <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0, overflow: 'hidden' }}>
        <div className="holo-ribbon holo-ribbon--a" />
        <div className="holo-ribbon holo-ribbon--b" />
      </div>

      {/* Floating particles */}
      <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0, overflow: 'hidden' }}>
        {PARTICLES.map((p, i) => (
          <div key={i} style={{
            position: 'absolute',
            left: `${p.x}%`,
            top: `${p.y}%`,
            width: p.size,
            height: p.size,
            borderRadius: '50%',
            background: '#38BDF8',
            opacity: p.opacity,
            animation: `particleDrift ${p.duration}s ${p.delay}s linear infinite`,
          }} />
        ))}

        {/* RK watermark */}
        <div style={{
          position: 'absolute',
          right: '8%',
          bottom: '12%',
          fontSize: 120,
          fontWeight: 900,
          color: 'rgba(56,189,248,0.04)',
          letterSpacing: '-4px',
          userSelect: 'none',
          fontFamily: 'monospace',
          lineHeight: 1,
        }}>RK</div>
      </div>

      {/* Content */}
      <div style={{ position: 'relative', zIndex: 1 }}>
        {children}
      </div>

      {/* Creator signature */}
      <div
        style={{
          position: 'fixed',
          bottom: 72,
          right: 16,
          zIndex: 50,
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: '0.15em',
          color: 'rgba(56,189,248,0.35)',
          textShadow: '0 0 8px rgba(56,189,248,0.3)',
          fontFamily: 'monospace',
          transition: 'color 0.3s, text-shadow 0.3s',
          cursor: 'default',
          userSelect: 'none',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.color = 'rgba(56,189,248,0.7)';
          e.currentTarget.style.textShadow = '0 0 14px rgba(56,189,248,0.6)';
        }}
        onMouseLeave={e => {
          e.currentTarget.style.color = 'rgba(56,189,248,0.35)';
          e.currentTarget.style.textShadow = '0 0 8px rgba(56,189,248,0.3)';
        }}
      >
        CREATED BY RK
      </div>

      <style>{`
        @keyframes particleDrift {
          0%   { transform: translate(0, 0) scale(1); opacity: inherit; }
          25%  { transform: translate(12px, -18px) scale(1.2); }
          50%  { transform: translate(-8px, -35px) scale(0.8); }
          75%  { transform: translate(6px, -52px) scale(1.1); }
          100% { transform: translate(0, -70px) scale(1); opacity: 0; }
        }
      `}</style>
    </div>
  );
}
