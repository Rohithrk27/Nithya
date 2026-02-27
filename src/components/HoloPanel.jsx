import React from 'react';

/**
 * HoloPanel — reusable holographic floating card
 * glowColor: optional accent color for border/glow
 * active: bool — stronger glow when true
 */
export default function HoloPanel({ children, className = '', style = {}, glowColor = '#38BDF8', active = false, noPad = false }) {
  return (
    <div
      className={`relative overflow-hidden rounded-2xl transition-all duration-300 group ${className}`}
      style={{
        background: 'rgba(10, 25, 33, 0.72)',
        backdropFilter: 'blur(20px)',
        border: `1px solid ${active ? glowColor + '66' : glowColor + '22'}`,
        boxShadow: active
          ? `0 0 30px ${glowColor}22, inset 0 0 30px ${glowColor}08`
          : `0 0 15px rgba(0,0,0,0.4), inset 0 0 20px ${glowColor}04`,
        padding: noPad ? 0 : undefined,
        ...style,
      }}
    >
      {/* Top scan line */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 1,
        background: `linear-gradient(90deg, transparent, ${glowColor}66, transparent)`,
        opacity: 0.8,
      }} />

      {/* Corner accents */}
      <div style={{
        position: 'absolute', top: 0, left: 0,
        width: 12, height: 12,
        borderTop: `2px solid ${glowColor}88`,
        borderLeft: `2px solid ${glowColor}88`,
        borderRadius: '2px 0 0 0',
      }} />
      <div style={{
        position: 'absolute', top: 0, right: 0,
        width: 12, height: 12,
        borderTop: `2px solid ${glowColor}88`,
        borderRight: `2px solid ${glowColor}88`,
        borderRadius: '0 2px 0 0',
      }} />
      <div style={{
        position: 'absolute', bottom: 0, left: 0,
        width: 12, height: 12,
        borderBottom: `2px solid ${glowColor}44`,
        borderLeft: `2px solid ${glowColor}44`,
        borderRadius: '0 0 0 2px',
      }} />
      <div style={{
        position: 'absolute', bottom: 0, right: 0,
        width: 12, height: 12,
        borderBottom: `2px solid ${glowColor}44`,
        borderRight: `2px solid ${glowColor}44`,
        borderRadius: '0 0 2px 0',
      }} />

      <div className={noPad ? '' : 'p-5'} style={{ position: 'relative', zIndex: 1 }}>
        {children}
      </div>
    </div>
  );
}