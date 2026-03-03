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
  const isMobileViewport = typeof window !== 'undefined'
    && window.matchMedia
    && window.matchMedia('(max-width: 768px)').matches;
  const visibleParticles = isMobileViewport ? PARTICLES.slice(0, 20) : PARTICLES;

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
        {visibleParticles.map((p, i) => (
          <div key={i} className="system-bg-particle" style={{
            position: 'absolute',
            left: `${p.x}%`,
            top: `${p.y}%`,
            width: p.size,
            height: p.size,
            borderRadius: '50%',
            background: '#38BDF8',
            opacity: p.opacity,
            animationDuration: `${p.duration}s`,
            animationDelay: `${p.delay}s`,
          }} />
        ))}

      </div>

      {/* Content */}
      <div style={{ position: 'relative', zIndex: 1 }}>
        {children}
      </div>
    </div>
  );
}
