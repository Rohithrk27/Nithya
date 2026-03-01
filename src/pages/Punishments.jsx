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
  fetchActivePunishments,
  getPunishmentProjectedLoss,
  getPunishmentRemainingMs,
  resolvePunishmentEarly,
  resolvePunishmentTimeouts,
} from '@/lib/punishments';
import { formatCountdown } from '@/lib/gameState';

const isOpenPunishment = (row) => {
  if (!row) return false;
  if (row.resolved || row.penalty_applied) return false;
  if (row.status === 'completed' || row.status === 'timed_out' || row.status === 'refused') return false;
  return true;
};

const rowDateSafe = (row) => (row?.date || row?.logged_at || row?.created_at || '').toString().slice(0, 10);

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

  const loadData = async (userId) => {
    if (!userId) return;
    setLoading(true);
    setLoadError('');
    try {
      await resolvePunishmentTimeouts({ userId, source: 'punishment_timeout' });
      const [rows, habitsRes, logsRes, profileRes] = await Promise.all([
        fetchActivePunishments(userId),
        supabase.from('habits').select('id,title,punishment_text,punishment_xp_penalty_pct').eq('user_id', userId),
        supabase.from('habit_logs').select('*').eq('user_id', userId),
        supabase.from('profiles').select('*').eq('id', userId).limit(1),
      ]);

      if (habitsRes.error) throw habitsRes.error;
      if (logsRes.error) throw logsRes.error;
      if (profileRes.error) throw profileRes.error;

      const habits = new Map((habitsRes.data || []).map((h) => [h.id, h]));
      const logs = new Map((logsRes.data || []).map((l) => [l.id, l]));
      const normalized = (rows || [])
        .filter(isOpenPunishment)
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
        .sort((a, b) => new Date(a.punishment.expires_at || a.punishment.created_at).getTime() - new Date(b.punishment.expires_at || b.punishment.created_at).getTime());

      setEntries(normalized);
      setProfile(profileRes.data?.[0] || null);
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
    if (!user?.id) return undefined;
    const intervalId = setInterval(() => {
      void resolvePunishmentTimeouts({ userId: user.id, source: 'punishment_timeout' });
      setEntries((prev) => prev.filter((entry) => getPunishmentRemainingMs(entry?.punishment, Date.now()) > 0));
    }, 60000);
    return () => clearInterval(intervalId);
  }, [user?.id]);

  useEffect(() => {
    if (!xpDelta) return undefined;
    const timeout = setTimeout(() => setXpDelta(0), 1200);
    return () => clearTimeout(timeout);
  }, [xpDelta]);

  const projectedLoss = useMemo(() => (
    entries.reduce((sum, item) => sum + getPunishmentProjectedLoss(item.punishment), 0)
  ), [entries]);

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
        <HoloPanel>
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
                {entries.length} active · projected loss {projectedLoss} XP
              </p>
            </div>
            <Button variant="outline" onClick={() => user?.id && loadData(user.id)}>Refresh</Button>
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

        {entries.length === 0 ? (
          <HoloPanel>
            <div className="text-center py-8 space-y-2">
              <ShieldAlert className="w-8 h-8 mx-auto text-emerald-400" />
              <p className="text-white font-bold">No active punishments</p>
              <p className="text-sm text-slate-400">All penalties are resolved or already processed.</p>
            </div>
          </HoloPanel>
        ) : (
          <div className="space-y-3">
            {entries.map((entry) => {
              const punishment = entry.punishment;
              const remainingMs = getPunishmentRemainingMs(punishment, nowMs);
              const urgency = remainingMs <= 3600000 ? 'high' : (remainingMs <= 3 * 3600000 ? 'medium' : 'low');
              const urgencyColor = urgency === 'high' ? '#F87171' : urgency === 'medium' ? '#FBBF24' : '#34D399';
              const penalty = getPunishmentProjectedLoss(punishment);
              const isSaving = savingId === punishment.id;

              return (
                <HoloPanel key={punishment.id} glowColor={urgencyColor} active={urgency === 'high'}>
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-black tracking-widest" style={{ color: urgencyColor }}>
                          {urgency === 'high' ? 'URGENT' : 'ACTIVE'} PUNISHMENT
                        </p>
                        <p className="text-white font-bold text-sm">{entry.habit?.title || 'Habit punishment'}</p>
                        <p className="text-xs text-slate-400 mt-1">
                          {punishment.reason || entry.habit?.punishment_text || 'Complete the required punishment action.'}
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
                        <p className="text-slate-300 font-bold tracking-wide">LOG DATE</p>
                        <p className="text-white font-black mt-0.5">{entry.log?.date || rowDateSafe(entry.log)}</p>
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <Button
                        onClick={() => resolveEarly(entry)}
                        disabled={isSaving || remainingMs <= 0}
                        className="flex-1"
                        style={{ background: 'rgba(52,211,153,0.18)', border: '1px solid rgba(52,211,153,0.45)', color: '#34D399' }}
                      >
                        <AlertTriangle className="w-4 h-4 mr-2" />
                        {isSaving ? 'Resolving...' : 'Resolve Early'}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => refuseNow(entry)}
                        disabled={isSaving}
                        className="flex-1"
                        style={{ border: '1px solid rgba(248,113,113,0.45)', color: '#F87171' }}
                      >
                        <Skull className="w-4 h-4 mr-2" />
                        {isSaving ? 'Applying...' : 'Take Full Penalty'}
                      </Button>
                    </div>
                  </div>
                </HoloPanel>
              );
            })}
          </div>
        )}
      </div>
    </SystemBackground>
  );
}
