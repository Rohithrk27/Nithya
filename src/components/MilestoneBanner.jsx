
import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';

const MILESTONES = [7, 30, 60, 100, 365];

export default function MilestoneBanner({ milestone, habitName, onClose }) {
  useEffect(() => {
    const timer = setTimeout(onClose, 5000);
    return () => clearTimeout(timer);
  }, [onClose]);

  const getEmoji = (days) => {
    if (days >= 365) return '🏆';
    if (days >= 100) return '💎';
    if (days >= 60) return '🔥';
    if (days >= 30) return '⚡';
    return '🎉';
  };

  const getMessage = (days) => {
    if (days >= 365) return 'Legendary! One full year!';
    if (days >= 100) return 'Diamond consistency!';
    if (days >= 60) return 'Two months strong!';
    if (days >= 30) return 'One month — incredible!';
    return 'One week — you\'re on fire!';
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -60, scale: 0.9 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -60, scale: 0.9 }}
        className="fixed top-4 left-0 right-0 z-50 flex justify-center px-4"
      >
        <div className="bg-gradient-to-r from-orange-500 to-yellow-500 rounded-2xl px-5 py-4 shadow-2xl max-w-sm w-full flex items-center gap-3">
          <span className="text-4xl">{getEmoji(milestone)}</span>
          <div className="flex-1">
            <p className="font-bold text-white text-sm">{milestone}-Day Streak!</p>
            <p className="text-white/90 text-xs">{habitName} — {getMessage(milestone)}</p>
          </div>
          <button onClick={onClose} className="text-white/70 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

export { MILESTONES };