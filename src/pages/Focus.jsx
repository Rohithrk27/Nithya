import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { ArrowLeft, CirclePause, PlayCircle, Timer } from 'lucide-react';
import { createPageUrl } from '@/utils';
import { Button } from '@/components/ui/button';
import HoloPanel from '@/components/HoloPanel';
import SystemBackground from '@/components/SystemBackground';
import { useAuthedPageUser } from '@/lib/useAuthedPageUser';
import {
  completeFocusSession,
  fetchActiveFocusSession,
  fetchRecentFocusSessions,
  interruptFocusSession,
  startFocusSession,
} from '@/lib/focus';
import { toastError, toastInfo, toastSuccess } from '@/lib/toast';

const DURATION_OPTIONS = [15, 25, 40, 50];

const sessionStatusColor = (status) => {
  const key = String(status || '').toLowerCase();
  if (key === 'completed') return '#34D399';
  if (key === 'interrupted' || key === 'abandoned') return '#F87171';
  if (key === 'active') return '#FBBF24';
  return '#94A3B8';
};

const formatCountdown = (ms) => {
  const total = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

export default function Focus() {
  const navigate = useNavigate();
  const { user, authReady } = useAuthedPageUser();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [selectedMinutes, setSelectedMinutes] = useState(25);
  const [activeSession, setActiveSession] = useState(null);
  const [recentSessions, setRecentSessions] = useState([]);
  const [nowMs, setNowMs] = useState(Date.now());
  const interruptLockRef = useRef(false);

  const loadData = useCallback(async (userId) => {
    if (!userId) return;
    try {
      const [active, recent] = await Promise.all([
        fetchActiveFocusSession(userId),
        fetchRecentFocusSessions(userId, 20),
      ]);
      setActiveSession(active || null);
      setRecentSessions(recent || []);
    } catch (err) {
      toastError(err?.message || 'Failed to load focus sessions.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!authReady || !user?.id) return;
    void loadData(user.id);
  }, [authReady, user?.id, loadData]);

  useEffect(() => {
    if (!activeSession?.id) return undefined;
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [activeSession?.id]);

  const activeEndsAtMs = useMemo(() => {
    if (!activeSession?.started_at) return 0;
    const startTs = new Date(activeSession.started_at).getTime();
    if (!Number.isFinite(startTs)) return 0;
    return startTs + (Math.max(5, Number(activeSession.planned_minutes || 25)) * 60000);
  }, [activeSession?.started_at, activeSession?.planned_minutes]);

  const remainingMs = useMemo(() => {
    if (!activeSession?.id || !activeEndsAtMs) return 0;
    return Math.max(0, activeEndsAtMs - nowMs);
  }, [activeSession?.id, activeEndsAtMs, nowMs]);

  const isReadyToComplete = Boolean(activeSession?.id) && remainingMs <= 0;

  const completedSessions = useMemo(
    () => (recentSessions || []).filter((row) => String(row?.status || '').toLowerCase() === 'completed'),
    [recentSessions]
  );

  const totalCompletedMinutes = useMemo(
    () => completedSessions.reduce((sum, row) => sum + Math.max(0, Number(row?.planned_minutes || 0)), 0),
    [completedSessions]
  );

  const weekCompletedCount = useMemo(() => {
    const now = new Date();
    const dow = now.getDay();
    const diff = dow === 0 ? 6 : dow - 1;
    const weekStart = new Date(now);
    weekStart.setHours(0, 0, 0, 0);
    weekStart.setDate(now.getDate() - diff);
    const threshold = weekStart.getTime();
    return completedSessions.filter((row) => {
      const ts = new Date(row?.started_at || row?.created_at || 0).getTime();
      return Number.isFinite(ts) && ts >= threshold;
    }).length;
  }, [completedSessions]);

  const runInterrupt = useCallback(async (reason) => {
    if (!user?.id || !activeSession?.id || interruptLockRef.current) return;
    interruptLockRef.current = true;
    try {
      await interruptFocusSession({
        userId: user.id,
        sessionId: activeSession.id,
        reason,
      });
      toastError('Focus session interrupted. XP reward cancelled.');
      await loadData(user.id);
    } catch {
      // Non-blocking auto-interrupt path.
    } finally {
      interruptLockRef.current = false;
    }
  }, [activeSession?.id, loadData, user?.id]);

  useEffect(() => {
    if (!activeSession?.id || !user?.id) return undefined;

    const handleVisibility = () => {
      if (document.hidden) {
        void runInterrupt('tab_hidden');
      }
    };

    window.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [activeSession?.id, runInterrupt, user?.id]);

  const handleStart = async () => {
    if (!user?.id || busy || activeSession?.id) return;
    setBusy(true);
    try {
      const row = await startFocusSession({
        userId: user.id,
        minutes: selectedMinutes,
        metadata: { client: 'web' },
      });
      setActiveSession(row || null);
      setNowMs(Date.now());
      toastInfo(`Focus session started (${selectedMinutes} min). Keep this tab open.`);
      await loadData(user.id);
    } catch (err) {
      toastError(err?.message || 'Failed to start focus session.');
    } finally {
      setBusy(false);
    }
  };

  const handleManualInterrupt = async () => {
    if (!user?.id || !activeSession?.id || busy) return;
    setBusy(true);
    try {
      await interruptFocusSession({
        userId: user.id,
        sessionId: activeSession.id,
        reason: 'manual_interrupt',
      });
      toastInfo('Focus session interrupted.');
      await loadData(user.id);
    } catch (err) {
      toastError(err?.message || 'Failed to interrupt focus session.');
    } finally {
      setBusy(false);
    }
  };

  const handleComplete = async () => {
    if (!user?.id || !activeSession?.id || busy) return;
    if (!isReadyToComplete) {
      toastInfo('Session still running. Complete it when timer reaches 00:00.');
      return;
    }

    setBusy(true);
    try {
      const result = await completeFocusSession({
        userId: user.id,
        sessionId: activeSession.id,
      });
      const xp = Math.max(0, Number(result?.xp_awarded || 0));
      toastSuccess(`Focus block complete. +${xp} XP awarded.`);
      await loadData(user.id);
    } catch (err) {
      toastError(err?.message || 'Failed to complete focus session.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <SystemBackground>
        <div className="min-h-screen flex items-center justify-center">
          <div className="w-8 h-8 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />
        </div>
      </SystemBackground>
    );
  }

  return (
    <SystemBackground>
      <div className="max-w-3xl mx-auto p-4 md:p-6 space-y-4">
        <HoloPanel>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => navigate(createPageUrl('Dashboard'))}
              className="w-9 h-9 rounded-lg flex items-center justify-center"
              style={{ background: 'rgba(10,25,33,0.8)', border: '1px solid rgba(56,189,248,0.2)' }}
            >
              <ArrowLeft className="w-4 h-4 text-white" />
            </button>
            <div>
              <p className="text-white font-black tracking-widest">FOCUS SESSION</p>
              <p className="text-xs text-slate-400">Pomodoro + XP, uninterrupted only</p>
            </div>
          </div>
        </HoloPanel>

        <div className="grid grid-cols-3 gap-3">
          <HoloPanel>
            <p className="text-[10px] tracking-widest text-slate-400">COMPLETED</p>
            <p className="text-2xl font-black text-emerald-300 mt-1">{completedSessions.length}</p>
          </HoloPanel>
          <HoloPanel>
            <p className="text-[10px] tracking-widest text-slate-400">FOCUS MINUTES</p>
            <p className="text-2xl font-black text-cyan-300 mt-1">{totalCompletedMinutes}</p>
          </HoloPanel>
          <HoloPanel>
            <p className="text-[10px] tracking-widest text-slate-400">THIS WEEK</p>
            <p className="text-2xl font-black text-amber-300 mt-1">{weekCompletedCount}</p>
          </HoloPanel>
        </div>

        {!activeSession && (
          <HoloPanel>
            <p className="text-xs text-cyan-300 font-bold tracking-widest mb-3 flex items-center gap-2">
              <Timer className="w-3.5 h-3.5" /> START A FOCUS BLOCK
            </p>
            <div className="flex flex-wrap gap-2 mb-4">
              {DURATION_OPTIONS.map((mins) => (
                <button
                  key={mins}
                  type="button"
                  onClick={() => setSelectedMinutes(mins)}
                  className="px-3 py-1.5 rounded-md text-xs font-black tracking-widest"
                  style={{
                    border: `1px solid ${selectedMinutes === mins ? 'rgba(56,189,248,0.45)' : 'rgba(71,85,105,0.45)'}`,
                    background: selectedMinutes === mins ? 'rgba(8,145,178,0.2)' : 'rgba(15,23,42,0.45)',
                    color: selectedMinutes === mins ? '#67E8F9' : '#94A3B8',
                  }}
                >
                  {mins} MIN
                </button>
              ))}
            </div>
            <Button onClick={handleStart} disabled={busy} className="w-full sm:w-auto">
              <PlayCircle className="w-4 h-4 mr-2" /> {busy ? 'Starting...' : `Start ${selectedMinutes}m Session`}
            </Button>
          </HoloPanel>
        )}

        {activeSession && (
          <HoloPanel glowColor="#FBBF24" active>
            <p className="text-xs text-amber-300 font-bold tracking-widest mb-2">ACTIVE FOCUS BLOCK</p>
            <p className="text-4xl sm:text-5xl font-black text-white tabular-nums">{formatCountdown(remainingMs)}</p>
            <p className="text-xs text-slate-400 mt-2">
              Keep this tab in foreground. Switching tabs marks the session interrupted and no XP is granted.
            </p>
            <div className="flex flex-col sm:flex-row gap-2 mt-4">
              <Button onClick={handleComplete} disabled={busy || !isReadyToComplete} className="w-full sm:w-auto">
                {busy ? 'Completing...' : (isReadyToComplete ? 'Complete & Claim XP' : 'Waiting for timer...')}
              </Button>
              <Button variant="outline" onClick={handleManualInterrupt} disabled={busy} className="w-full sm:w-auto">
                <CirclePause className="w-4 h-4 mr-2" /> Interrupt
              </Button>
            </div>
          </HoloPanel>
        )}

        <HoloPanel>
          <p className="text-xs text-cyan-300 font-bold tracking-widest mb-3">RECENT FOCUS SESSIONS</p>
          {recentSessions.length === 0 ? (
            <p className="text-sm text-slate-500">No sessions yet.</p>
          ) : (
            <div className="space-y-2 max-h-[340px] overflow-y-auto pr-1">
              {recentSessions.map((row) => {
                const status = String(row?.status || 'unknown').toUpperCase();
                const statusColor = sessionStatusColor(row?.status);
                const startedAt = row?.started_at ? format(new Date(row.started_at), 'MMM d, HH:mm') : 'N/A';
                const duration = Math.max(0, Number(row?.planned_minutes || 0));
                const xp = Math.max(0, Number(row?.xp_awarded || 0));
                return (
                  <div
                    key={row.id}
                    className="rounded-lg p-3 border"
                    style={{ borderColor: 'rgba(56,189,248,0.18)', background: 'rgba(15,23,42,0.45)' }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm text-white font-semibold">{duration} min block</p>
                      <span
                        className="text-[10px] font-black tracking-widest px-2 py-0.5 rounded border"
                        style={{ color: statusColor, borderColor: `${statusColor}66`, background: `${statusColor}1a` }}
                      >
                        {status}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-1">Started {startedAt}</p>
                    <p className="text-xs mt-1" style={{ color: xp > 0 ? '#34D399' : '#94A3B8' }}>
                      XP Awarded: +{xp}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </HoloPanel>
      </div>
    </SystemBackground>
  );
}
