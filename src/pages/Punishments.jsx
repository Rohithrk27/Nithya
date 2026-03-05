import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, AlertTriangle, Clock3, ShieldAlert, Skull } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { createPageUrl } from '../utils';
import { Button } from '@/components/ui/button';
import SystemBackground from '@/components/SystemBackground';
import HoloPanel from '@/components/HoloPanel';
import XPDeltaPulse from '@/components/XPDeltaPulse';
import { applyProgressionSnapshot, penaltyXpRpc } from '@/lib/progression';
import { useAuthedPageUser } from '@/lib/useAuthedPageUser';
import {
  clampPunishmentHours,
  configurePunishmentTimer,
  ensurePendingPunishmentsForMissedHabits,
  getPunishmentConfiguredHours,
  getPunishmentProjectedLoss,
  getPunishmentRemainingMs,
  isOpenPunishment,
  resolvePunishmentEarly,
} from '@/lib/punishments';
import { formatCountdown } from '@/lib/gameState';

const PUNISHMENT_TIME_LIMIT_HOURS = 24;

const rowDateSafe = (row) => (row?.date || row?.logged_at || row?.created_at || '').toString().slice(0, 10);
const formatDateTimeSafe = (value) => {
  if (!value) return 'N/A';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'N/A';
  return parsed.toLocaleString();
};
const prettyPunishmentStatus = (value) => {
  const raw = String(value || '').toLowerCase();
  if (raw === 'resolved') return 'Resolved';
  if (raw === 'refused') return 'Penalty Taken';
  if (raw === 'timed_out') return 'Timed Out';
  if (raw === 'active') return 'Active';
  return raw ? raw.replace(/_/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase()) : 'Resolved';
};

export default function Punishments() {
  const navigate = useNavigate();
  const { user, authReady } = useAuthedPageUser();
  const [profile, setProfile] = useState(null);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState('');
  const [loadError, setLoadError] = useState('');
  const [nowMs, setNowMs] = useState(Date.now());
  const [xpDelta, setXpDelta] = useState(0);
  const [timerHoursById, setTimerHoursById] = useState({});
  const [timerSavingId, setTimerSavingId] = useState('');

  const loadData = async (userId) => {
    if (!userId) return;
    setLoading(true);
    setLoadError('');
    try {
      const [punishmentsRes, habitsRes, logsRes, profileRes] = await Promise.all([
        supabase.from('punishments').select('*').eq('user_id', userId),
        supabase.from('habits').select('id,title,punishment_text,punishment_xp_penalty_pct').eq('user_id', userId),
        supabase.from('habit_logs').select('*').eq('user_id', userId),
        supabase.from('profiles').select('*').eq('id', userId).limit(1),
      ]);

      if (punishmentsRes.error) throw punishmentsRes.error;
      if (habitsRes.error) throw habitsRes.error;
      if (logsRes.error) throw logsRes.error;
      if (profileRes.error) throw profileRes.error;

      const profileRow = profileRes.data?.[0] || null;
      const allPunishments = await ensurePendingPunishmentsForMissedHabits({
        userId,
        profile: profileRow,
        habits: habitsRes.data || [],
        logs: logsRes.data || [],
        punishments: punishmentsRes.data || [],
        timeLimitHours: PUNISHMENT_TIME_LIMIT_HOURS,
      });

      const habits = new Map((habitsRes.data || []).map((h) => [h.id, h]));
      const logs = new Map((logsRes.data || []).map((l) => [l.id, l]));
      const normalized = (allPunishments || [])
        .map((punishment) => {
          const habit = habits.get(punishment.habit_id) || null;
          const log = logs.get(punishment.habit_log_id) || null;
          return {
            punishment,
            habit,
            log: log || {
              id: punishment.habit_log_id || `missing-${punishment.id}`,
              habit_id: punishment.habit_id || null,
              status: 'missed',
              date: rowDateSafe(punishment),
            },
          };
        })
        .sort((a, b) => new Date(b.punishment.created_at || b.punishment.expires_at || 0).getTime() - new Date(a.punishment.created_at || a.punishment.expires_at || 0).getTime());

      setEntries(normalized);
      setProfile(profileRow);
    } catch (err) {
      setLoadError(err?.message || 'Failed to load punishments.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!authReady || !user?.id) return;
    void loadData(user.id);
  }, [authReady, user?.id]);

  useEffect(() => {
    const timerId = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timerId);
  }, []);

  useEffect(() => {
    if (!xpDelta) return undefined;
    const timeout = setTimeout(() => setXpDelta(0), 1200);
    return () => clearTimeout(timeout);
  }, [xpDelta]);

  useEffect(() => {
    setTimerHoursById((prev) => {
      const next = { ...prev };
      entries.forEach((entry) => {
        const punishmentId = entry?.punishment?.id;
        if (!punishmentId) return;
        if (Number.isFinite(Number(next[punishmentId]))) return;
        next[punishmentId] = getPunishmentConfiguredHours(entry.punishment, PUNISHMENT_TIME_LIMIT_HOURS);
      });
      return next;
    });
  }, [entries]);

  const activeEntries = useMemo(
    () => entries.filter((item) => isOpenPunishment(item?.punishment)),
    [entries]
  );
  const historyEntries = useMemo(
    () => entries.filter((item) => !isOpenPunishment(item?.punishment)).slice(0, 20),
    [entries]
  );
  const projectedLoss = useMemo(() => (
    activeEntries.reduce((sum, item) => sum + getPunishmentProjectedLoss(item.punishment), 0)
  ), [activeEntries]);

  const resolveEarly = async (entry) => {
    if (!user?.id || !entry?.punishment?.id || savingId) return;
    setSavingId(entry.punishment.id);
    try {
      const snapshot = await resolvePunishmentEarly({
        userId: user.id,
        punishmentId: entry.punishment.id,
        source: 'punishment_resolved_early',
      });
      const merged = applyProgressionSnapshot(profile, null, snapshot);
      if (merged.nextProfile) {
        setXpDelta((merged.nextProfile.total_xp || 0) - (profile?.total_xp || 0));
        setProfile(merged.nextProfile);
      }
      setEntries((prev) => prev.filter((row) => row.punishment.id !== entry.punishment.id));
    } catch (err) {
      setLoadError(err?.message || 'Failed to resolve punishment.');
    } finally {
      setSavingId('');
    }
  };

  const runTimer = async (entry) => {
    if (!user?.id || !entry?.punishment?.id || savingId || timerSavingId) return;
    const punishmentId = entry.punishment.id;
    const safeHours = clampPunishmentHours(
      timerHoursById[punishmentId],
      getPunishmentConfiguredHours(entry.punishment, PUNISHMENT_TIME_LIMIT_HOURS)
    );
    setTimerSavingId(punishmentId);
    setLoadError('');
    try {
      const updated = await configurePunishmentTimer({
        userId: user.id,
        punishmentId,
        hours: safeHours,
        source: 'punishment_timer_configured_page',
      });
      setEntries((prev) => prev.map((row) => (
        row?.punishment?.id === punishmentId
          ? { ...row, punishment: { ...row.punishment, ...(updated || {}) } }
          : row
      )));
      setTimerHoursById((prev) => ({ ...prev, [punishmentId]: safeHours }));
    } catch (err) {
      setLoadError(err?.message || 'Failed to start punishment timer.');
    } finally {
      setTimerSavingId('');
    }
  };

  const refuseNow = async (entry) => {
    if (!user?.id || !entry?.punishment?.id || savingId) return;
    setSavingId(entry.punishment.id);
    try {
      const penalty = getPunishmentProjectedLoss(entry.punishment);
      const snapshot = await penaltyXpRpc({
        userId: user.id,
        xpAmount: penalty,
        source: 'punishment_refused',
        shadowDebtAmount: Math.ceil(penalty * 0.25),
        eventId: `punishment_refused:${entry.punishment.id}`,
        metadata: {
          punishment_id: entry.punishment.id,
          habit_id: entry.habit?.id || null,
        },
      });
      const merged = applyProgressionSnapshot(profile, null, snapshot);
      if (merged.nextProfile) {
        setXpDelta((merged.nextProfile.total_xp || 0) - (profile?.total_xp || 0));
        setProfile(merged.nextProfile);
      }

      await supabase
        .from('punishments')
        .update({
          status: 'refused',
          resolved: true,
          penalty_applied: true,
          accumulated_penalty: penalty,
          total_xp_penalty: penalty,
          resolved_at: new Date().toISOString(),
        })
        .eq('id', entry.punishment.id)
        .eq('user_id', user.id);

      setEntries((prev) => prev.filter((row) => row.punishment.id !== entry.punishment.id));
    } catch (err) {
      setLoadError(err?.message || 'Failed to apply refusal penalty.');
    } finally {
      setSavingId('');
    }
  };

  if (loading) {
    return (
      <SystemBackground>
        <div className="min-h-screen flex items-center justify-center">
          <div className="w-8 h-8 rounded-full border-2 border-red-400 border-t-transparent animate-spin" />
        </div>
      </SystemBackground>
    );
  }

  return (
    <SystemBackground>
      <div className="max-w-2xl mx-auto p-4 md:p-6 space-y-4">
        <HoloPanel data-guide-id="punishments-summary">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => navigate(createPageUrl('Dashboard'))}
              className="w-9 h-9 rounded-lg flex items-center justify-center"
              style={{ background: 'rgba(15,32,39,0.8)', border: '1px solid #1e3a4a' }}
            >
              <ArrowLeft className="w-4 h-4 text-white" />
            </button>
            <div className="flex-1">
              <p className="text-red-400 text-xs font-black tracking-widest">PUNISHMENT CONTROL</p>
              <p className="text-white text-base font-bold">
                {activeEntries.length} active - projected loss {projectedLoss} XP
              </p>
              <p className="text-xs text-slate-400 mt-1">
                Complete your recovery action before the timer ends to avoid XP loss.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => navigate(createPageUrl('Recovery'))}>Recovery</Button>
              <Button variant="outline" onClick={() => user?.id && loadData(user.id)}>Refresh</Button>
            </div>
          </div>
        </HoloPanel>

        <div className="min-h-5 flex justify-center">
          <XPDeltaPulse value={xpDelta} visible={xpDelta !== 0} />
        </div>

        {loadError && (
          <HoloPanel>
            <p className="text-sm text-red-300">{loadError}</p>
          </HoloPanel>
        )}

        <div data-guide-id="punishments-active-section">
          {activeEntries.length === 0 ? (
            <HoloPanel>
              <div className="text-center py-8 space-y-2">
                <ShieldAlert className="w-8 h-8 mx-auto text-emerald-400" />
                <p className="text-white font-bold">No active punishments</p>
                <p className="text-sm text-slate-400">All active penalties are resolved or already processed.</p>
              </div>
            </HoloPanel>
          ) : (
            <div className="space-y-3">
              {activeEntries.map((entry) => {
                const punishment = entry.punishment;
                const remainingMs = getPunishmentRemainingMs(punishment, nowMs);
                const urgency = remainingMs <= 3600000 ? 'high' : (remainingMs <= 3 * 3600000 ? 'medium' : 'low');
                const urgencyColor = urgency === 'high' ? '#F87171' : urgency === 'medium' ? '#FBBF24' : '#34D399';
                const penalty = getPunishmentProjectedLoss(punishment);
                const isSaving = savingId === punishment.id;
                const isTimerSaving = timerSavingId === punishment.id;
                const timerHours = clampPunishmentHours(
                  timerHoursById[punishment.id],
                  getPunishmentConfiguredHours(punishment, PUNISHMENT_TIME_LIMIT_HOURS)
                );

                return (
                  <HoloPanel key={punishment.id} glowColor={urgencyColor} active={urgency === 'high'}>
                    <div className="space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-black tracking-widest" style={{ color: urgencyColor }}>
                            {urgency === 'high' ? 'URGENT' : 'ACTIVE'} ACTION
                          </p>
                          <p className="text-white font-bold text-sm">{entry.habit?.title || 'Habit punishment'}</p>
                          <p className="text-xs text-slate-400 mt-1">
                            {punishment.reason || entry.habit?.punishment_text || 'Complete your recovery action before the timer ends.'}
                          </p>
                        </div>
                        <span
                          className="text-[11px] font-black tracking-widest px-2 py-1 rounded border"
                          style={{ color: urgencyColor, borderColor: `${urgencyColor}66`, background: `${urgencyColor}1a` }}
                        >
                          <Clock3 className="w-3 h-3 inline mr-1" />
                          {formatCountdown(remainingMs)}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="rounded-lg p-2 border border-red-500/30 bg-red-950/20">
                          <p className="text-red-300 font-bold tracking-wide">PROJECTED LOSS</p>
                          <p className="text-white font-black mt-0.5">-{penalty} XP</p>
                        </div>
                        <div className="rounded-lg p-2 border border-slate-600/40 bg-slate-900/30">
                          <p className="text-slate-300 font-bold tracking-wide">MISSED DATE</p>
                          <p className="text-white font-black mt-0.5">{entry.log?.date || rowDateSafe(entry.log)}</p>
                        </div>
                      </div>

                      <div className="rounded-lg p-2 border border-cyan-500/30 bg-cyan-950/20">
                        <p className="text-cyan-300 font-bold tracking-wide text-xs">SET YOUR RECOVERY WINDOW (HOURS)</p>
                        <div className="flex gap-2 mt-1.5">
                          <input
                            type="number"
                            min={1}
                            max={24}
                            value={timerHours}
                            onChange={(e) => setTimerHoursById((prev) => ({
                              ...prev,
                              [punishment.id]: clampPunishmentHours(e.target.value, timerHours),
                            }))}
                            className="w-20 px-2 py-1.5 rounded-md bg-slate-900/70 border border-cyan-500/40 text-cyan-100 text-sm font-semibold"
                          />
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => runTimer(entry)}
                            disabled={isSaving || isTimerSaving}
                            className="flex-1"
                            style={{ borderColor: 'rgba(56,189,248,0.45)', color: '#67E8F9' }}
                          >
                            {isTimerSaving ? 'Saving...' : `Start ${timerHours}h Timer`}
                          </Button>
                        </div>
                        <p className="text-[10px] text-slate-400 mt-1.5">
                          Choose the hours you need. Timer starts now and reminders run before expiry.
                        </p>
                      </div>

                      <div className="flex gap-2">
                        <Button
                          onClick={() => resolveEarly(entry)}
                          disabled={isSaving || remainingMs <= 0}
                          className="flex-1"
                          style={{ background: 'rgba(52,211,153,0.18)', border: '1px solid rgba(52,211,153,0.45)', color: '#34D399' }}
                        >
                          <AlertTriangle className="w-4 h-4 mr-2" />
                          {isSaving ? 'Saving...' : 'Mark as Completed'}
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => refuseNow(entry)}
                          disabled={isSaving}
                          className="flex-1"
                          style={{ border: '1px solid rgba(248,113,113,0.45)', color: '#F87171' }}
                        >
                          <Skull className="w-4 h-4 mr-2" />
                          {isSaving ? 'Applying...' : 'Skip and Take Penalty'}
                        </Button>
                      </div>
                    </div>
                  </HoloPanel>
                );
              })}
            </div>
          )}
        </div>

        {historyEntries.length > 0 && (
          <HoloPanel>
            <p className="text-xs text-cyan-300 font-bold tracking-widest mb-3">RECENT PENALTY HISTORY</p>
            <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
              {historyEntries.map((entry) => {
                const punishment = entry.punishment || {};
                const status = prettyPunishmentStatus(punishment.status || (punishment.penalty_applied ? 'timed_out' : 'resolved'));
                const resolvedAt = punishment.resolved_at || punishment.updated_at || punishment.created_at || null;
                const resolvedLabel = formatDateTimeSafe(resolvedAt);
                const penalty = Math.max(0, Number(punishment.total_xp_penalty || punishment.accumulated_penalty || 0));
                return (
                  <div
                    key={punishment.id}
                    className="rounded-lg p-3 border"
                    style={{ borderColor: 'rgba(56,189,248,0.16)', background: 'rgba(15,23,42,0.45)' }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-white">{entry.habit?.title || 'Habit punishment'}</p>
                      <span className="text-[10px] font-black tracking-widest px-2 py-0.5 rounded border border-slate-500/50 text-slate-200 bg-slate-700/30">
                        {status}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-1">
                      {punishment.reason || entry.habit?.punishment_text || 'Penalty history entry'}
                    </p>
                    <p className="text-xs text-slate-400 mt-1">Resolved: {resolvedLabel}</p>
                    <p className="text-xs mt-1" style={{ color: penalty > 0 ? '#FCA5A5' : '#94A3B8' }}>
                      XP Penalty: -{Math.floor(penalty)}
                    </p>
                  </div>
                );
              })}
            </div>
          </HoloPanel>
        )}
      </div>
    </SystemBackground>
  );
}


