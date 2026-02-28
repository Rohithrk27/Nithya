import React, { useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

/**
 * SystemNotification — floating "SYSTEM MESSAGE" toast stack
 * Usage: <SystemNotification notifications={notifications} />
 * 
 * Each notification: { id, type: 'xp'|'levelup'|'stat'|'quest'|'penalty', message, sub }
 */

// Audio context for notification sounds
let audioContext = null;

const getAudioContext = () => {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioContext;
};

/**
 * Play a notification sound based on type
 * Uses Web Audio API to generate synthetic sounds (no external files needed)
 */
const playNotificationSound = (type) => {
  try {
    const ctx = getAudioContext();
    
    // Resume audio context if suspended (required by browsers)
    if (ctx.state === 'suspended') {
      ctx.resume();
    }

    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    // Different sounds for different notification types
    switch (type) {
      case 'xp':
        // Quick rising tone for XP
        oscillator.frequency.setValueAtTime(600, ctx.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(900, ctx.currentTime + 0.1);
        gainNode.gain.setValueAtTime(0.15, ctx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
        oscillator.start(ctx.currentTime);
        oscillator.stop(ctx.currentTime + 0.15);
        break;
        
      case 'levelup':
        // Celebratory ascending arpeggio
        const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
        notes.forEach((freq, i) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.frequency.setValueAtTime(freq, ctx.currentTime + i * 0.08);
          gain.gain.setValueAtTime(0.12, ctx.currentTime + i * 0.08);
          gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + i * 0.08 + 0.2);
          osc.start(ctx.currentTime + i * 0.08);
          osc.stop(ctx.currentTime + i * 0.08 + 0.2);
        });
        return; // Don't play the default sound
        
      case 'stat':
        // Two-tone boost sound
        oscillator.frequency.setValueAtTime(440, ctx.currentTime);
        oscillator.frequency.setValueAtTime(550, ctx.currentTime + 0.08);
        gainNode.gain.setValueAtTime(0.12, ctx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);
        oscillator.start(ctx.currentTime);
        oscillator.stop(ctx.currentTime + 0.2);
        break;
        
      case 'quest':
        // Success chime
        oscillator.frequency.setValueAtTime(784, ctx.currentTime); // G5
        oscillator.frequency.setValueAtTime(988, ctx.currentTime + 0.1); // B5
        gainNode.gain.setValueAtTime(0.12, ctx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.25);
        oscillator.start(ctx.currentTime);
        oscillator.stop(ctx.currentTime + 0.25);
        break;
        
      case 'penalty':
        // Warning descending tone
        oscillator.frequency.setValueAtTime(400, ctx.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(200, ctx.currentTime + 0.3);
        oscillator.type = 'sawtooth';
        gainNode.gain.setValueAtTime(0.1, ctx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
        oscillator.start(ctx.currentTime);
        oscillator.stop(ctx.currentTime + 0.3);
        return; // Don't play the default sound
        
      default:
        // Default notification ping
        oscillator.frequency.setValueAtTime(600, ctx.currentTime);
        gainNode.gain.setValueAtTime(0.1, ctx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
        oscillator.start(ctx.currentTime);
        oscillator.stop(ctx.currentTime + 0.15);
    }
  } catch (e) {
    // Silently fail if audio not supported
    console.warn('Notification sound failed:', e);
  }
};

const TYPE_STYLES = {
  xp:      { border: '#38BDF8', bg: 'rgba(56,189,248,0.08)',  label: 'XP ACQUIRED',     icon: '⚡' },
  levelup: { border: '#FBBF24', bg: 'rgba(251,191,36,0.12)',  label: 'LEVEL UP',         icon: '▲' },
  stat:    { border: '#38BDF8', bg: 'rgba(56,189,248,0.08)', label: 'STAT INCREASED',   icon: '↑' },
  quest:   { border: '#34D399', bg: 'rgba(52,211,153,0.08)',  label: 'QUEST COMPLETE',   icon: '✓' },
  penalty: { border: '#F87171', bg: 'rgba(248,113,113,0.08)', label: 'PENALTY ISSUED',   icon: '!' },
};

export function useSystemNotifications() {
  const [notifications, setNotifications] = useState([]);
  const soundEnabledRef = useRef(true);

  const notify = useCallback((type, message, sub = '') => {
    const id = Date.now() + Math.random();
    setNotifications(prev => [...prev.slice(-4), { id, type, message, sub }]);
    
    // Play notification sound
    if (soundEnabledRef.current) {
      playNotificationSound(type);
    }
    
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id));
    }, 3000);
  }, []);

  return { notifications, notify };
}

export default function SystemNotification({ notifications }) {
  return (
    <div
      style={{
        position: 'fixed',
        top: 16,
        right: 16,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        pointerEvents: 'none',
        maxWidth: 280,
      }}
    >
      <AnimatePresence>
        {notifications.map(n => {
          const style = TYPE_STYLES[n.type] || TYPE_STYLES.xp;
          return (
            <motion.div
              key={n.id}
              initial={{ opacity: 0, x: 60, scale: 0.92 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 40, scale: 0.88 }}
              transition={{ duration: 0.22, ease: 'easeOut' }}
              style={{
                background: style.bg,
                border: `1px solid ${style.border}55`,
                borderLeft: `3px solid ${style.border}`,
                borderRadius: 10,
                padding: '8px 12px',
                backdropFilter: 'blur(12px)',
                boxShadow: `0 0 16px ${style.border}22`,
              }}
            >
              <div className="flex items-center gap-2 mb-0.5">
                <span style={{ color: style.border, fontSize: 11, fontWeight: 900 }}>
                  {style.icon} {style.label}
                </span>
              </div>
              <p style={{ color: '#F1F5F9', fontSize: 13, fontWeight: 700 }}>{n.message}</p>
              {n.sub && <p style={{ color: '#64748B', fontSize: 11 }}>{n.sub}</p>}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

