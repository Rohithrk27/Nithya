import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { ArrowLeft, RotateCw, ShieldCheck, Sparkles, Target, TriangleAlert } from 'lucide-react';
import { createPageUrl } from '@/utils';
import { Button } from '@/components/ui/button';
import HoloPanel from '@/components/HoloPanel';
import SystemBackground from '@/components/SystemBackground';
import XPDeltaPulse from '@/components/XPDeltaPulse';
import { useAuthedPageUser } from '@/lib/useAuthedPageUser';
import {
  abandonRecoveryPlan,
  createRecoveryPlan,
  fetchActiveRecoveryPlan,
  fetchRecoveryPlanHistory,
  fetchRecoveryPlanSteps,
  progressRecoveryPlanStep,
} from '@/lib/recovery';
import { toastError, toastSuccess } from '@/lib/toast';

const statusColor = (status) => {
  const key = String(status || '').toLowerCase();
  if (key === 'active') return '#FBBF24';
  if (key === 'completed') return '#34D399';
  if (key === 'abandoned') return '#F87171';
  if (key === 'expired') return '#F97316';
  return '#94A3B8';
};

export default function Recovery() {
  const navigate = useNavigate();
  const { user, authReady } = useAuthedPageUser();
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState('');
  const [activePlan, setActivePlan] = useState(null);
  const [steps, setSteps] = useState([]);
  const [history, setHistory] = useState([]);
  const [xpDelta, setXpDelta] = useState(0);

  const loadData = useCallback(async (userId) => {
    if (!userId) return;
    setLoading(true);
    try {
      const [plan, rows] = await Promise.all([
        fetchActiveRecoveryPlan(userId),
        fetchRecoveryPlanHistory(userId, 10),
      ]);

      setActivePlan(plan || null);
      setHistory(rows || []);

      if (plan?.id) {
        const nextSteps = await fetchRecoveryPlanSteps(plan.id);
        setSteps(nextSteps || []);
      } else {
        setSteps([]);
      }
    } catch (err) {
      toastError(err?.message || 'Failed to load recovery planner.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!authReady || !user?.id) return;
    void loadData(user.id);
  }, [authReady, user?.id, loadData]);

  useEffect(() => {
    if (!xpDelta) return undefined;
    const timerId = setTimeout(() => setXpDelta(0), 1300);
    return () => clearTimeout(timerId);
  }, [xpDelta]);

  const completedSteps = useMemo(
    () => (steps || []).filter((step) => String(step?.status || '').toLowerCase() === 'completed').length,
    [steps]
  );

  const totalSteps = steps.length;
  const progressPct = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;
  const metadata = activePlan?.metadata || {};

  const generatePlan = async () => {
    if (!user?.id || busyKey) return;
    setBusyKey('generate');
    try {
      await createRecoveryPlan({
        userId: user.id,
        source: 'manual',
        reason: 'Manual recovery restart requested by user.',
        forceNew: false,
      });
      toastSuccess('Recovery plan activated.');
      await loadData(user.id);
    } catch (err) {
      toastError(err?.message || 'Failed to generate recovery plan.');
    } finally {
      setBusyKey('');
    }
  };

  const regeneratePlan = async () => {
    if (!user?.id || busyKey) return;
    setBusyKey('regenerate');
    try {
      await createRecoveryPlan({
        userId: user.id,
        source: 'manual',
        reason: 'User requested forced recovery refresh.',
        forceNew: true,
      });
      toastSuccess('Fresh recovery plan generated.');
      await loadData(user.id);
    } catch (err) {
      toastError(err?.message || 'Failed to regenerate recovery plan.');
    } finally {
      setBusyKey('');
    }
  };

  const progressStep = async (stepId) => {
    if (!user?.id || !stepId || busyKey) return;
    setBusyKey(`step-${stepId}`);
    try {
      const res = await progressRecoveryPlanStep({
        userId: user.id,
        stepId,
        delta: 1,
      });
      const gained = Math.max(0, Number(res?.xp_awarded || 0));
      if (gained > 0) {
        setXpDelta(gained);
        toastSuccess(`Recovery step cleared. +${gained} XP.`);
      } else {
        toastSuccess('Recovery step progress updated.');
      }
      await loadData(user.id);
    } catch (err) {
      toastError(err?.message || 'Failed to progress recovery step.');
    } finally {
      setBusyKey('');
    }
  };

  const abandonPlan = async () => {
    if (!user?.id || !activePlan?.id || busyKey) return;
    setBusyKey('abandon');
    try {
      await abandonRecoveryPlan({
        userId: user.id,
        planId: activePlan.id,
      });
      toastSuccess('Recovery plan marked abandoned.');
      await loadData(user.id);
    } catch (err) {
      toastError(err?.message || 'Failed to abandon recovery plan.');
    } finally {
      setBusyKey('');
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
              <p className="text-white font-black tracking-widest">RECOVERY PLANNER</p>
              <p className="text-xs text-slate-400">48-hour comeback protocol after failures</p>
            </div>
            {!activePlan && (
              <Button onClick={generatePlan} disabled={busyKey === 'generate'} className="ml-auto">
                <Sparkles className="w-4 h-4 mr-2" />
                {busyKey === 'generate' ? 'Generating...' : 'Generate Plan'}
              </Button>
            )}
          </div>
        </HoloPanel>

        <div className="min-h-5 flex justify-center">
          <XPDeltaPulse value={xpDelta} visible={xpDelta !== 0} />
        </div>

        {activePlan ? (
          <>
            <HoloPanel glowColor="#FBBF24" active>
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div>
                  <p className="text-xs tracking-widest text-amber-300 font-black">ACTIVE PROTOCOL</p>
                  <p className="text-white text-lg font-bold">{activePlan.title || 'Recovery Plan'}</p>
                  <p className="text-xs text-slate-400 mt-1">
                    {activePlan.starts_on ? format(new Date(activePlan.starts_on), 'MMM d, yyyy') : 'N/A'} - {activePlan.ends_on ? format(new Date(activePlan.ends_on), 'MMM d, yyyy') : 'N/A'}
                  </p>
                </div>
                <span
                  className="text-[11px] font-black tracking-widest px-2 py-1 rounded border self-start"
                  style={{
                    color: statusColor(activePlan.status),
                    borderColor: `${statusColor(activePlan.status)}66`,
                    background: `${statusColor(activePlan.status)}1a`,
                  }}
                >
                  {String(activePlan.status || 'active').toUpperCase()}
                </span>
              </div>

              <div className="mt-3 rounded-lg p-3 border border-cyan-500/20 bg-cyan-950/15">
                <p className="text-xs text-cyan-300 font-bold tracking-widest">WHY THIS PLAN</p>
                <p className="text-sm text-cyan-100 mt-1 whitespace-pre-wrap break-words">
                  {activePlan.reason || 'Recovery protocol generated based on recent failures.'}
                </p>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">
                <div className="rounded-lg p-2 border border-slate-700/60 bg-slate-900/35">
                  <p className="text-[10px] tracking-widest text-slate-400">MISSED HABITS (14D)</p>
                  <p className="text-lg font-black text-rose-300">{Math.max(0, Number(metadata.missed_habits_14d || 0))}</p>
                </div>
                <div className="rounded-lg p-2 border border-slate-700/60 bg-slate-900/35">
                  <p className="text-[10px] tracking-widest text-slate-400">FAILED QUESTS (14D)</p>
                  <p className="text-lg font-black text-orange-300">{Math.max(0, Number(metadata.failed_quests_14d || 0))}</p>
                </div>
                <div className="rounded-lg p-2 border border-slate-700/60 bg-slate-900/35 col-span-2">
                  <p className="text-[10px] tracking-widest text-slate-400">WEAKEST HABIT</p>
                  <p className="text-sm font-bold text-white truncate">{metadata.top_missed_habit || 'N/A'}</p>
                </div>
              </div>

              <div className="mt-4">
                <div className="flex items-center justify-between text-xs text-slate-300">
                  <p>Step completion</p>
                  <p>{completedSteps}/{totalSteps} ({progressPct}%)</p>
                </div>
                <div className="mt-1 h-2 rounded-full bg-slate-800 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${progressPct}%`, background: 'linear-gradient(90deg, #22D3EE, #34D399)' }}
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-2 mt-4">
                <Button variant="outline" onClick={regeneratePlan} disabled={Boolean(busyKey)}>
                  <RotateCw className="w-4 h-4 mr-2" /> Refresh Plan
                </Button>
                <Button variant="outline" onClick={abandonPlan} disabled={Boolean(busyKey)} style={{ color: '#F87171', borderColor: 'rgba(248,113,113,0.45)' }}>
                  <TriangleAlert className="w-4 h-4 mr-2" /> Abandon
                </Button>
              </div>
            </HoloPanel>

            <HoloPanel>
              <p className="text-xs text-cyan-300 font-black tracking-widest mb-3 flex items-center gap-2">
                <Target className="w-3.5 h-3.5" /> RECOVERY STEPS
              </p>
              {steps.length === 0 ? (
                <p className="text-sm text-slate-500">No recovery steps found.</p>
              ) : (
                <div className="space-y-3">
                  {steps.map((step) => {
                    const target = Math.max(1, Number(step.target_count || 1));
                    const progress = Math.max(0, Number(step.progress_count || 0));
                    const pct = Math.min(100, Math.round((progress / target) * 100));
                    const completed = String(step.status || '').toLowerCase() === 'completed';
                    const thisBusy = busyKey === `step-${step.id}`;

                    return (
                      <div key={step.id} className="rounded-lg p-3 border border-slate-700/60 bg-slate-900/35">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-white font-semibold break-words">{step.title}</p>
                            <p className="text-xs text-slate-400 mt-1 break-words">{step.description || 'No description'}</p>
                            <p className="text-[11px] text-amber-300 mt-1">Reward +{Math.max(0, Number(step.xp_reward || 0))} XP</p>
                          </div>
                          <span
                            className="text-[10px] font-black tracking-widest px-2 py-1 rounded border"
                            style={{
                              color: completed ? '#34D399' : '#FBBF24',
                              borderColor: completed ? 'rgba(52,211,153,0.45)' : 'rgba(251,191,36,0.45)',
                              background: completed ? 'rgba(16,185,129,0.2)' : 'rgba(161,98,7,0.2)',
                            }}
                          >
                            {completed ? 'DONE' : `D+${Math.max(0, Number(step.day_offset || 0))}`}
                          </span>
                        </div>

                        <div className="mt-2">
                          <div className="flex items-center justify-between text-xs text-slate-300">
                            <p>Progress {progress}/{target}</p>
                            <p>{pct}%</p>
                          </div>
                          <div className="mt-1 h-2 rounded-full bg-slate-800 overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-500"
                              style={{ width: `${pct}%`, background: completed ? 'linear-gradient(90deg, #10B981, #34D399)' : 'linear-gradient(90deg, #0EA5E9, #22D3EE)' }}
                            />
                          </div>
                        </div>

                        {!completed && (
                          <Button className="mt-3" size="sm" onClick={() => progressStep(step.id)} disabled={Boolean(busyKey) || thisBusy}>
                            {thisBusy ? 'Updating...' : 'Mark +1 Progress'}
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </HoloPanel>
          </>
        ) : (
          <HoloPanel>
            <div className="py-5 text-center space-y-2">
              <ShieldCheck className="w-8 h-8 mx-auto text-emerald-400" />
              <p className="text-white font-bold">No active recovery plan</p>
              <p className="text-sm text-slate-400">
                Recovery plans auto-generate after failed quests or timed-out/refused punishments.
              </p>
              <Button onClick={generatePlan} disabled={busyKey === 'generate'} className="mt-2">
                <Sparkles className="w-4 h-4 mr-2" />
                {busyKey === 'generate' ? 'Generating...' : 'Generate Now'}
              </Button>
            </div>
          </HoloPanel>
        )}

        <HoloPanel>
          <p className="text-xs text-cyan-300 font-black tracking-widest mb-3">RECOVERY HISTORY</p>
          {history.length === 0 ? (
            <p className="text-sm text-slate-500">No recovery plans yet.</p>
          ) : (
            <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
              {history.map((plan) => (
                <div key={plan.id} className="rounded-lg p-3 border border-slate-700/60 bg-slate-900/35">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm text-white font-semibold">{plan.title || 'Recovery Plan'}</p>
                    <span
                      className="text-[10px] font-black tracking-widest px-2 py-1 rounded border"
                      style={{
                        color: statusColor(plan.status),
                        borderColor: `${statusColor(plan.status)}66`,
                        background: `${statusColor(plan.status)}1a`,
                      }}
                    >
                      {String(plan.status || 'active').toUpperCase()}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-1">{plan.reason || 'No reason logged.'}</p>
                  <p className="text-[11px] text-slate-500 mt-1">
                    {plan.starts_on ? format(new Date(plan.starts_on), 'MMM d, yyyy') : 'N/A'} - {plan.ends_on ? format(new Date(plan.ends_on), 'MMM d, yyyy') : 'N/A'}
                  </p>
                </div>
              ))}
            </div>
          )}
        </HoloPanel>
      </div>
    </SystemBackground>
  );
}
