import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, CheckCircle2, X, Shield, Clock } from 'lucide-react';

const DIFFICULTY_COLORS = {
  low:     { bg: 'rgba(251,191,36,0.12)',  border: 'rgba(251,191,36,0.4)',  text: '#FBBF24', label: 'LOW' },
  medium:  { bg: 'rgba(251,146,60,0.12)',  border: 'rgba(251,146,60,0.4)',  text: '#FB923C', label: 'MEDIUM' },
  high:    { bg: 'rgba(248,113,113,0.12)', border: 'rgba(248,113,113,0.4)', text: '#F87171', label: 'HIGH' },
  extreme: { bg: 'rgba(167,139,250,0.15)', border: 'rgba(167,139,250,0.5)', text: '#A78BFA', label: 'EXTREME' },
};

/**
 * Props:
 *   pendingPunishments: [{log, habit, punishment}]
 *   hardcoreMode: bool
 *   onDone(log, habit, punishment)
 *   onSkip(log, habit, punishment)
 *   timeLimitHours: number
 */
export default function PunishmentModal({ pendingPunishments, hardcoreMode, onDone, onSkip, timeLimitHours = 8 }) {
  const [phase, setPhase] = useState('main'); // 'main' | 'confirm' | 'holding'
  const [holdProgress, setHoldProgress] = useState(0);
  const [now, setNow] = useState(Date.now());
  const holdInterval = useRef(null);

  useEffect(() => {
    setPhase('main');
    setHoldProgress(0);
    clearInterval(holdInterval.current);
  }, [pendingPunishments?.length]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (!pendingPunishments || pendingPunishments.length === 0) return null;

  const { log, habit, punishment } = pendingPunishments[0];
  const remaining = pendingPunishments.length;
  const diffLevel = habit.punishment_difficulty || 'medium';
  const diffStyle = DIFFICULTY_COLORS[diffLevel] || DIFFICULTY_COLORS.medium;
  const xpPenaltyPct = habit.punishment_xp_penalty_pct || 10;
  const xpPenalty = Math.max(50, Math.floor((habit.xp_value || 100) * (xpPenaltyPct / 100)));
  const createdAtMs = new Date(punishment?.created_at || Date.now()).getTime();
  const deadlineMs = createdAtMs + (timeLimitHours * 60 * 60 * 1000);
  const remainingMs = Math.max(0, deadlineMs - now);
  const expired = remainingMs <= 0;
  const timeLeftLabel = expired
    ? 'TIME WINDOW EXPIRED'
    : `${Math.floor(remainingMs / 3600000)}h ${Math.floor((remainingMs % 3600000) / 60000)}m LEFT`;

  // ── Hold-to-confirm logic ──
  const startHold = () => {
    if (expired) return;
    if (!hardcoreMode) {
      setPhase('confirm');
      return;
    }
    setPhase('holding');
    let elapsed = 0;
    holdInterval.current = setInterval(() => {
      elapsed += 100;
      const pct = Math.min(100, (elapsed / 10000) * 100);
      setHoldProgress(pct);
      if (elapsed >= 10000) {
        clearInterval(holdInterval.current);
        setPhase('confirm');
      }
    }, 100);
  };

  const cancelHold = () => {
    clearInterval(holdInterval.current);
    setHoldProgress(0);
    setPhase('main');
  };

  const confirmDone = () => {
    if (expired) return;
    onDone(log, habit, punishment);
  };

  const denyDone = () => {
    setPhase('main');
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[200] flex items-center justify-center p-4"
        style={{ background: 'rgba(5,0,0,0.85)', backdropFilter: 'blur(8px)' }}>

        {/* Red warning pulse border */}
        <div className="absolute inset-0 pointer-events-none"
          style={{ boxShadow: 'inset 0 0 60px rgba(248,113,113,0.15)', animation: 'redPulse 2s ease-in-out infinite' }} />

        <motion.div
          key={phase}
          initial={{ scale: 0.88, opacity: 0, y: 16 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.88, opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="w-full max-w-sm rounded-2xl overflow-hidden"
          style={{
            background: 'rgba(12, 4, 4, 0.97)',
            border: '1px solid rgba(248,113,113,0.5)',
            boxShadow: '0 0 60px rgba(248,113,113,0.2), 0 0 120px rgba(248,113,113,0.08)',
          }}
        >
          {/* Header bar */}
          <div className="px-5 py-3 flex items-center gap-2"
            style={{ background: 'rgba(248,113,113,0.1)', borderBottom: '1px solid rgba(248,113,113,0.2)' }}>
            <AlertTriangle className="w-4 h-4 animate-pulse" style={{ color: '#F87171' }} />
            <span className="text-xs font-black tracking-widest" style={{ color: '#F87171' }}>
              SYSTEM FAILURE DETECTED
            </span>
            {remaining > 1 && (
              <span className="ml-auto text-xs font-mono" style={{ color: '#F8717166' }}>{remaining} PENDING</span>
            )}
          </div>

          <div className="p-5 space-y-4">

            {phase === 'main' && (
              <>
                {/* Habit info */}
                <div className="space-y-1">
                  <p className="text-xs font-bold tracking-widest" style={{ color: '#64748B' }}>HABIT INCOMPLETE</p>
                  <p className="text-base font-black text-white">{habit.title}</p>
                  <p className="text-xs font-mono" style={{ color: '#475569' }}>{log.date}</p>
                </div>

                {/* Punishment */}
                <div className="rounded-xl p-4 space-y-2"
                  style={{ background: diffStyle.bg, border: `1px solid ${diffStyle.border}` }}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-black tracking-widest" style={{ color: diffStyle.text }}>
                      ⚠ PUNISHMENT REQUIRED
                    </span>
                    <span className="text-xs font-black px-2 py-0.5 rounded"
                      style={{ background: diffStyle.bg, border: `1px solid ${diffStyle.border}`, color: diffStyle.text }}>
                      {diffStyle.label}
                    </span>
                  </div>
                  <p className="text-sm font-bold text-white leading-snug">
                    {habit.punishment_text || 'No punishment configured'}
                  </p>
                </div>

                {/* Penalty info */}
                <div className="text-center py-1">
                  <p className="text-xs font-black tracking-widest mb-1" style={{ color: expired ? '#F87171' : '#FBBF24' }}>
                    {timeLeftLabel}
                  </p>
                  <p className="text-xs" style={{ color: '#64748B' }}>
                    {expired ? 'Window expired. You must accept XP reduction.' : <>Refusing costs <span className="font-black" style={{ color: '#F87171' }}>−{xpPenalty} XP</span></>}
                    {hardcoreMode && (
                      <span style={{ color: '#A78BFA' }}> + stat reduction</span>
                    )}
                  </p>
                  {hardcoreMode && (
                    <p className="text-xs mt-1 font-bold tracking-widest" style={{ color: '#A78BFA' }}>
                      ◆ HARDCORE MODE ACTIVE
                    </p>
                  )}
                </div>

                {/* Actions */}
                <div className="flex gap-3">
                  <button onClick={() => onSkip(log, habit, punishment)}
                    className="flex-1 py-3 rounded-xl text-xs font-black tracking-widest transition-all hover:scale-[1.02]"
                    style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.25)', color: '#F87171' }}>
                    <X className="w-3.5 h-3.5 inline mr-1" />
                    ACCEPT XP REDUCTION
                  </button>
                  <button
                    onMouseDown={startHold}
                    onMouseUp={!hardcoreMode ? undefined : cancelHold}
                    onTouchStart={startHold}
                    onTouchEnd={!hardcoreMode ? undefined : cancelHold}
                    disabled={expired}
                    className="flex-1 py-3 rounded-xl text-xs font-black tracking-widest transition-all hover:scale-[1.02] active:scale-95"
                    style={{
                      background: expired ? 'rgba(71,85,105,0.2)' : 'rgba(52,211,153,0.12)',
                      border: expired ? '1px solid rgba(71,85,105,0.4)' : '1px solid rgba(52,211,153,0.35)',
                      color: expired ? '#64748B' : '#34D399',
                    }}>
                    <CheckCircle2 className="w-3.5 h-3.5 inline mr-1" />
                    {expired ? 'TIME EXPIRED' : (hardcoreMode ? 'HOLD TO CONFIRM' : 'PUNISHMENT DONE')}
                  </button>
                </div>
              </>
            )}

            {phase === 'holding' && (
              <div className="space-y-4 text-center py-2">
                <Clock className="w-8 h-8 mx-auto animate-spin" style={{ color: '#34D399' }} />
                <p className="text-xs font-black tracking-widest" style={{ color: '#34D399' }}>
                  HOLD FOR 10 SECONDS
                </p>
                <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: 'rgba(52,211,153,0.1)' }}>
                  <div className="h-full rounded-full transition-all"
                    style={{ width: `${holdProgress}%`, background: 'linear-gradient(90deg, #34D399, #38BDF8)' }} />
                </div>
                <button onClick={cancelHold}
                  className="text-xs font-bold tracking-widest" style={{ color: '#475569' }}>
                  RELEASE TO CANCEL
                </button>
              </div>
            )}

            {phase === 'confirm' && (
              <div className="space-y-4">
                <div className="text-center py-2">
                  <Shield className="w-8 h-8 mx-auto mb-2" style={{ color: '#38BDF8' }} />
                  <p className="text-sm font-black text-white tracking-wide">
                    VERIFICATION REQUIRED
                  </p>
                  <p className="text-xs mt-1" style={{ color: '#94A3B8' }}>
                    Did you really complete the punishment?
                  </p>
                  <p className="text-xs mt-0.5 font-bold" style={{ color: '#F87171' }}>
                    "{habit.punishment_text}"
                  </p>
                </div>
                <div className="flex gap-3">
                  <button onClick={denyDone}
                    className="flex-1 py-3 rounded-xl text-xs font-black tracking-widest"
                    style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.25)', color: '#F87171' }}>
                    NO, NOT YET
                  </button>
                  <button onClick={confirmDone}
                    className="flex-1 py-3 rounded-xl text-xs font-black tracking-widest"
                    style={{ background: 'rgba(52,211,153,0.12)', border: '1px solid rgba(52,211,153,0.35)', color: '#34D399' }}>
                    YES, CONFIRMED
                  </button>
                </div>
              </div>
            )}
          </div>
        </motion.div>
      </div>

      <style>{`
        @keyframes redPulse {
          0%, 100% { box-shadow: inset 0 0 60px rgba(248,113,113,0.10); }
          50% { box-shadow: inset 0 0 80px rgba(248,113,113,0.22); }
        }
      `}</style>
    </AnimatePresence>
  );
}
