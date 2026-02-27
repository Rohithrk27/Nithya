import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { CheckCircle2, Clock, Zap, Star, AlertTriangle, Skull } from 'lucide-react';
import { Button } from '@/components/ui/button';

const TYPE_CONFIG = {
  daily:   { label: 'DAILY',   color: '#38BDF8', icon: Clock },
  weekly:  { label: 'WEEKLY',  color: '#A78BFA', icon: Star },
  special: { label: 'SPECIAL', color: '#FBBF24', icon: Zap },
  epic:    { label: 'EPIC',    color: '#F472B6', icon: Star },
  penalty: { label: 'PENALTY', color: '#F87171', icon: Skull },
};

export default function QuestCard({ quest, onComplete, onFail, index = 0 }) {
  const [completing, setCompleting] = useState(false);
  const cfg = TYPE_CONFIG[quest.type] || TYPE_CONFIG.daily;
  const Icon = cfg.icon;
  const isPenalty = quest.type === 'penalty';

  const handleComplete = async () => {
    setCompleting(true);
    await onComplete(quest);
    setCompleting(false);
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: -30, filter: 'blur(4px)' }}
      animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
      transition={{ delay: index * 0.08, duration: 0.3, ease: 'easeOut' }}
      className="relative overflow-hidden rounded-xl"
      style={{
        background: 'rgba(15, 32, 39, 0.7)',
        backdropFilter: 'blur(12px)',
        border: `1px solid ${cfg.color}33`,
        boxShadow: `0 0 20px ${cfg.color}11`,
      }}
    >
      {/* Top accent line */}
      <div style={{ height: 2, background: `linear-gradient(90deg, ${cfg.color}, transparent)` }} />

      <div className="p-4">
        <div className="flex items-start gap-3">
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
            style={{ background: `${cfg.color}22`, border: `1px solid ${cfg.color}44` }}
          >
            <Icon className="w-4 h-4" style={{ color: cfg.color }} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-xs font-bold tracking-widest" style={{ color: cfg.color }}>{cfg.label}</span>
              {quest.stat_reward && (
                <span className="text-xs" style={{ color: `${cfg.color}88` }}>+{quest.stat_reward_amount || 1} {quest.stat_reward?.toUpperCase()}</span>
              )}
            </div>
            <p className="text-sm font-semibold text-white leading-snug">{quest.title}</p>
            {quest.description && (
              <p className="text-xs mt-1" style={{ color: '#94A3B8' }}>{quest.description}</p>
            )}
            <div className="flex items-center gap-3 mt-2">
              <span className="text-xs font-bold" style={{ color: '#FBBF24' }}>⚡ +{quest.xp_reward} XP</span>
              {quest.expires_date && (
                <span className="text-xs" style={{ color: '#64748B' }}>Expires {quest.expires_date}</span>
              )}
            </div>
          </div>
        </div>

        {quest.status === 'active' && (
          <div className="flex gap-2 mt-3">
            <Button
              size="sm"
              onClick={handleComplete}
              disabled={completing}
              className="flex-1 h-8 text-xs font-bold tracking-wide"
              style={{
                background: `linear-gradient(90deg, ${cfg.color}33, ${cfg.color}55)`,
                border: `1px solid ${cfg.color}66`,
                color: cfg.color,
              }}
            >
              <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
              {completing ? 'CLAIMING...' : isPenalty ? 'COMPLETED PENALTY' : 'COMPLETE'}
            </Button>
            {!isPenalty && onFail && (
              <Button
                size="sm"
                onClick={() => onFail(quest)}
                variant="ghost"
                className="h-8 text-xs px-3"
                style={{ color: '#64748B', border: '1px solid #1e3a4a' }}
              >
                Skip
              </Button>
            )}
          </div>
        )}

        {quest.status === 'completed' && (
          <div className="mt-3 flex items-center gap-2 text-xs" style={{ color: '#34D399' }}>
            <CheckCircle2 className="w-4 h-4" />
            <span className="font-bold">COMPLETED</span>
            {quest.completed_date && <span style={{ color: '#64748B' }}>on {quest.completed_date}</span>}
          </div>
        )}

        {quest.status === 'failed' && (
          <div className="mt-3 flex items-center gap-2 text-xs" style={{ color: '#F87171' }}>
            <AlertTriangle className="w-4 h-4" />
            <span className="font-bold">FAILED</span>
          </div>
        )}
      </div>
    </motion.div>
  );
}