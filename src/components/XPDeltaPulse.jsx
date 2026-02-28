import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';

export default function XPDeltaPulse({ value = 0, visible = false }) {
  if (!visible || !value) return null;
  const positive = value > 0;
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 14, scale: 0.92 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -12, scale: 0.95 }}
        transition={{ duration: 0.45, ease: 'easeOut' }}
        className="inline-flex items-center px-2 py-1 rounded-md border text-xs font-black tracking-wider"
        style={{
          color: positive ? '#34D399' : '#F87171',
          borderColor: positive ? 'rgba(52,211,153,0.45)' : 'rgba(248,113,113,0.45)',
          background: positive ? 'rgba(52,211,153,0.12)' : 'rgba(248,113,113,0.12)',
        }}
      >
        {positive ? '+' : ''}{Math.trunc(value)} XP
      </motion.div>
    </AnimatePresence>
  );
}
