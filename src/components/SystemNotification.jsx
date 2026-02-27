import React, { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

/**
 * SystemNotification — floating "SYSTEM MESSAGE" toast stack
 * Usage: <SystemNotification notifications={notifications} />
 * 
 * Each notification: { id, type: 'xp'|'levelup'|'stat'|'quest'|'penalty', message, sub }
 */

const TYPE_STYLES = {
  xp:      { border: '#38BDF8', bg: 'rgba(56,189,248,0.08)',  label: 'XP ACQUIRED',     icon: '⚡' },
  levelup: { border: '#FBBF24', bg: 'rgba(251,191,36,0.12)',  label: 'LEVEL UP',         icon: '▲' },
  stat:    { border: '#A78BFA', bg: 'rgba(167,139,250,0.08)', label: 'STAT INCREASED',   icon: '↑' },
  quest:   { border: '#34D399', bg: 'rgba(52,211,153,0.08)',  label: 'QUEST COMPLETE',   icon: '✓' },
  penalty: { border: '#F87171', bg: 'rgba(248,113,113,0.08)', label: 'PENALTY ISSUED',   icon: '!' },
};

export function useSystemNotifications() {
  const [notifications, setNotifications] = useState([]);

  const notify = useCallback((type, message, sub = '') => {
    const id = Date.now() + Math.random();
    setNotifications(prev => [...prev.slice(-4), { id, type, message, sub }]);
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