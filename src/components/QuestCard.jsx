import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { CheckCircle2, Clock, Zap, Star, AlertTriangle, Skull } from 'lucide-react';
import { Button } from '@/components/ui/button';

const TYPE_CONFIG = {
  daily:   { label: 'DAILY',   color: '#38BDF8', icon: Clock },
  weekly:  { label: 'WEEKLY',  color: '#38BDF8', icon: Star },
  special: { label: 'SPECIAL', color: '#FBBF24', icon: Zap },
  epic:    { label: 'EPIC',    color: '#22D3EE', icon: Star },
  penalty: { label: 'PENALTY', color: '#F87171', icon: Skull },
};

const getQuestRemainingMs = (quest, nowMs) => {
  if (!quest) return 0;
  const exp = quest.expires_at || quest.expires_date || null;
  if (!exp) return 0;
  const parsed = new Date(exp);
  if (Number.isNaN(parsed.getTime())) return 0;
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  return Math.max(0, parsed.getTime() - now);
};

const toCountdown = (ms) => {
  const safe = Math.max(0, Number(ms || 0));
  const totalSeconds = Math.floor(safe / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return `${days}d ${String(hours).padStart(2, '0')}h`;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

const isQuestInProgressStatus = (status) => {
  const normalized = String(status || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  return ['active', 'in_progress', 'accepted', 'inprogress', 'ongoing', 'started', 'start'].includes(normalized);
};

function QuestCard({ quest, onComplete = async (_quest) => {}, onFail = null, index = 0, disabled = false, nowMs = Date.now() }) {
  const [completing, setCompleting] = useState(false);
  const cfg = TYPE_CONFIG[quest.type] || TYPE_CONFIG.daily;
  const Icon = cfg.icon;
  const isPenalty = quest.type === 'penalty';
  const progressCurrent = Math.max(0, Number(quest.progress_current || 0));
  const progressTarget = Math.max(1, Number(quest.progress_target || 100));
  const progressPct = Math.min(100, Math.round((progressCurrent / progressTarget) * 100));
  const remainingMs = Number.isFinite(quest.remaining_ms) ? Math.max(0, quest.remaining_ms) : getQuestRemainingMs(quest, nowMs);
  const countdownLabel = quest.remaining_label || toCountdown(remainingMs);
  const timerUrgency = quest.timer_urgency || (remainingMs <= (2 * 60 * 60 * 1000) ? 'high' : (remainingMs <= (8 * 60 * 60 * 1000) ? 'medium' : 'low'));
  const timerColor = timerUrgency === 'high' ? '#F87171' : (timerUrgency === 'medium' ? '#FBBF24' : '#34D399');
  const inProgress = isQuestInProgressStatus(quest.status);

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
            <div className="flex flex-wrap items-center gap-2 mb-0.5">
              <span className="text-xs font-bold tracking-widest" style={{ color: cfg.color }}>{cfg.label}</span>
              {inProgress && (
                <span className="text-[10px] font-black tracking-wide px-1.5 py-0.5 rounded border" style={{ color: '#38BDF8', borderColor: '#38BDF866', background: '#0C4A6E44' }}>
                  IN PROGRESS
                </span>
              )}
              {quest.stat_reward && (
                <span className="text-xs break-words" style={{ color: `${cfg.color}88` }}>+{quest.stat_reward_amount || 1} {quest.stat_reward?.toUpperCase()}</span>
              )}
            </div>
            <p className="text-sm font-semibold text-white leading-snug">{quest.title}</p>
            {quest.description && (
              <p className="text-xs mt-1" style={{ color: '#94A3B8' }}>{quest.description}</p>
            )}
            <div className="flex flex-wrap items-center gap-2 sm:gap-3 mt-2">
              <span className="text-xs font-bold" style={{ color: '#FBBF24' }}>⚡ +{quest.xp_reward} XP</span>
              {quest.expires_date && (
                <span className="text-xs" style={{ color: '#64748B' }}>Expires {quest.expires_date}</span>
              )}
              {(quest.expires_at || quest.expires_date) && inProgress && (
                <span
                  className="text-[10px] font-black tracking-wide px-2 py-0.5 rounded border"
                  style={{ color: timerColor, borderColor: `${timerColor}66`, background: `${timerColor}18` }}
                >
                  {countdownLabel}
                </span>
              )}
            </div>
            <div className="mt-2.5 space-y-1">
              <div className="flex items-center justify-between gap-2 text-[10px] tracking-wide" style={{ color: '#94A3B8' }}>
                <span>Progress</span>
                <span>{progressCurrent}/{progressTarget} ({progressPct}%)</span>
              </div>
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(100,116,139,0.25)' }}>
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${progressPct}%`, background: `linear-gradient(90deg, ${cfg.color}, rgba(255,255,255,0.5))` }}
                />
              </div>
            </div>
            {(quest.expires_at || quest.expires_date) && inProgress && (
              <div className="mt-2">
                <p className="text-[10px] mb-1 font-bold tracking-wide" style={{ color: timerColor }}>
                  Remaining: {countdownLabel}
                </p>
                <div className="h-1 rounded-full overflow-hidden" style={{ background: 'rgba(100,116,139,0.25)' }}>
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{
                      width: `${timerUrgency === 'high' ? 100 : timerUrgency === 'medium' ? 65 : 35}%`,
                      background: `linear-gradient(90deg, ${timerColor}, rgba(255,255,255,0.6))`,
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {inProgress && (
          <div className="flex flex-col sm:flex-row gap-2 mt-3">
            <Button
              type="button"
              size="sm"
              onClick={handleComplete}
              disabled={completing || disabled}
              className="w-full sm:flex-1 h-8 text-xs font-bold tracking-wide"
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
                type="button"
                size="sm"
                onClick={() => onFail(quest)}
                variant="ghost"
                disabled={disabled}
                className="h-8 text-xs px-3 w-full sm:w-auto"
                style={{ color: '#64748B', border: '1px solid #1e3a4a' }}
              >
                Skip
              </Button>
            )}
          </div>
        )}

        {quest.status === 'completed' && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs" style={{ color: '#34D399' }}>
            <CheckCircle2 className="w-4 h-4" />
            <span className="font-bold">COMPLETED</span>
            {quest.completed_date && <span style={{ color: '#64748B' }}>on {quest.completed_date}</span>}
          </div>
        )}

        {quest.status === 'failed' && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs" style={{ color: '#F87171' }}>
            <AlertTriangle className="w-4 h-4" />
            <span className="font-bold">FAILED</span>
          </div>
        )}
      </div>
    </motion.div>
  );
}

export default React.memo(QuestCard);
