import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Zap, X } from 'lucide-react';

export default function DailyChallengeReveal({ challenge, onClose }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (challenge) {
      setVisible(true);
      const t = setTimeout(() => setVisible(false), 6000);
      return () => clearTimeout(t);
    }
  }, [challenge]);

  return (
    <AnimatePresence>
      {visible && challenge && (
        <motion.div
          initial={{ opacity: 0, scale: 0.85, y: -30 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: -20 }}
          className="fixed top-6 left-1/2 z-[300]"
          style={{ transform: 'translateX(-50%)', width: '92vw', maxWidth: 380 }}
        >
          {/* Energy ripple rings */}
          <div className="absolute inset-0 rounded-2xl pointer-events-none">
            <div className="absolute inset-0 rounded-2xl animate-ping opacity-20"
              style={{ border: '2px solid #38BDF8', animationDuration: '1.2s' }} />
            <div className="absolute inset-0 rounded-2xl animate-ping opacity-10"
              style={{ border: '2px solid #38BDF8', animationDuration: '1.8s', animationDelay: '0.3s' }} />
          </div>

          <div className="relative rounded-2xl p-5"
            style={{
              background: 'rgba(5, 18, 28, 0.97)',
              border: '1px solid rgba(56,189,248,0.5)',
              boxShadow: '0 0 50px rgba(56,189,248,0.25), 0 0 100px rgba(56,189,248,0.1)',
              backdropFilter: 'blur(20px)',
            }}>

            <div className="flex items-center gap-2 mb-3">
              <Zap className="w-4 h-4 animate-pulse" style={{ color: '#38BDF8' }} />
              <span className="text-xs font-black tracking-widest" style={{ color: '#38BDF8' }}>
                DAILY SYSTEM CHALLENGE ACTIVATED
              </span>
              <button onClick={() => { setVisible(false); onClose?.(); }} className="ml-auto opacity-40 hover:opacity-80">
                <X className="w-4 h-4 text-white" />
              </button>
            </div>

            <p className="text-base font-black text-white mb-1">{challenge.title}</p>
            <p className="text-xs mb-3" style={{ color: '#64748B' }}>{challenge.description}</p>

            <div className="flex items-center gap-3">
              <span className="text-xs font-black px-2 py-1 rounded-lg"
                style={{ background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.3)', color: '#FBBF24' }}>
                +{challenge.xp_reward} XP
              </span>
              <span className="text-xs font-bold px-2 py-1 rounded-lg"
                style={{ background: 'rgba(56,189,248,0.08)', border: '1px solid rgba(56,189,248,0.2)', color: '#38BDF8' }}>
                {(challenge.stat_reward || '').toUpperCase()} +1
              </span>
              <span className="ml-auto text-xs font-black tracking-widest" style={{ color: '#475569' }}>
                24H
              </span>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}