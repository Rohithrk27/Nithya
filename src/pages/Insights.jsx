import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { ArrowLeft, BrainCircuit, RotateCw, TrendingDown, TrendingUp } from 'lucide-react';
import { createPageUrl } from '@/utils';
import { Button } from '@/components/ui/button';
import HoloPanel from '@/components/HoloPanel';
import SystemBackground from '@/components/SystemBackground';
import { useAuthedPageUser } from '@/lib/useAuthedPageUser';
import {
  fetchLatestWeeklyPersonalInsight,
  fetchWeeklyPersonalInsightHistory,
  generateWeeklyPersonalInsight,
} from '@/lib/insights';
import { toastError, toastSuccess } from '@/lib/toast';

const toRate = (value) => {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return '0.0';
  return n.toFixed(1);
};

export default function Insights() {
  const navigate = useNavigate();
  const { user, authReady } = useAuthedPageUser();
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [latest, setLatest] = useState(null);
  const [history, setHistory] = useState([]);

  const loadData = useCallback(async (userId) => {
    if (!userId) return;
    setLoading(true);
    try {
      let latestInsight = await fetchLatestWeeklyPersonalInsight(userId);
      if (!latestInsight) {
        latestInsight = await generateWeeklyPersonalInsight({ userId });
      }
      const rows = await fetchWeeklyPersonalInsightHistory(userId, 12);
      setLatest(latestInsight || null);
      setHistory(rows || []);
    } catch (err) {
      toastError(err?.message || 'Failed to load personal insights.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!authReady || !user?.id) return;
    void loadData(user.id);
  }, [authReady, user?.id, loadData]);

  const metrics = useMemo(() => latest?.metrics || {}, [latest?.metrics]);
  const bestHabitLabel = useMemo(() => {
    const raw = String(metrics.best_habit || '').trim();
    return raw || 'N/A';
  }, [metrics.best_habit]);
  const worstHabitLabel = useMemo(() => {
    const worst = String(metrics.worst_habit || '').trim();
    const best = String(metrics.best_habit || '').trim();
    if (!worst) return 'N/A';
    if (best && worst.toLowerCase() === best.toLowerCase()) return 'N/A';
    return worst;
  }, [metrics.best_habit, metrics.worst_habit]);

  const generateCurrentWeek = async () => {
    if (!user?.id || generating) return;
    setGenerating(true);
    try {
      const row = await generateWeeklyPersonalInsight({ userId: user.id });
      setLatest(row || null);
      const rows = await fetchWeeklyPersonalInsightHistory(user.id, 12);
      setHistory(rows || []);
      toastSuccess('Weekly insight generated.');
    } catch (err) {
      toastError(err?.message || 'Failed to generate weekly insight.');
    } finally {
      setGenerating(false);
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
            <div className="min-w-0">
              <p className="text-white font-black tracking-widest">PERSONAL INSIGHTS</p>
              <p className="text-xs text-slate-400">Weekly what worked / what failed + one adjustment</p>
            </div>
            <Button onClick={generateCurrentWeek} disabled={generating} className="ml-auto shrink-0">
              <RotateCw className={`w-4 h-4 mr-2 ${generating ? 'animate-spin' : ''}`} />
              {generating ? 'Generating...' : 'Regenerate'}
            </Button>
          </div>
        </HoloPanel>

        {latest ? (
          <>
            <HoloPanel glowColor="#38BDF8" active>
              <p className="text-xs tracking-widest text-cyan-300 font-black mb-2 flex items-center gap-2">
                <BrainCircuit className="w-3.5 h-3.5" /> CURRENT WEEK REPORT
              </p>
              <p className="text-xs text-slate-400 mb-3">
                Week: {latest.week_start ? format(new Date(latest.week_start), 'MMM d, yyyy') : 'N/A'} - {latest.week_end ? format(new Date(latest.week_end), 'MMM d, yyyy') : 'N/A'}
              </p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-950/20 p-2">
                  <p className="text-[10px] text-emerald-300 tracking-widest">HABIT RATE</p>
                  <p className="text-lg font-black text-emerald-100">{toRate(metrics.habit_rate)}%</p>
                </div>
                <div className="rounded-lg border border-cyan-500/30 bg-cyan-950/20 p-2">
                  <p className="text-[10px] text-cyan-300 tracking-widest">QUEST RATE</p>
                  <p className="text-lg font-black text-cyan-100">{toRate(metrics.quest_rate)}%</p>
                </div>
                <div className="rounded-lg border border-amber-500/30 bg-amber-950/20 p-2">
                  <p className="text-[10px] text-amber-300 tracking-widest">BEST HABIT</p>
                  <p className="text-sm font-bold text-amber-100 truncate">{bestHabitLabel}</p>
                </div>
                <div className="rounded-lg border border-rose-500/30 bg-rose-950/20 p-2">
                  <p className="text-[10px] text-rose-300 tracking-widest">WORST HABIT</p>
                  <p className="text-sm font-bold text-rose-100 truncate">{worstHabitLabel}</p>
                </div>
              </div>

              <div className="space-y-3">
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-950/20 p-3">
                  <p className="text-xs text-emerald-300 tracking-widest font-black mb-1 flex items-center gap-1.5">
                    <TrendingUp className="w-3.5 h-3.5" /> WHAT WORKED
                  </p>
                  <p className="text-sm text-emerald-100 whitespace-pre-wrap break-words">{latest.worked_summary}</p>
                </div>

                <div className="rounded-lg border border-rose-500/30 bg-rose-950/20 p-3">
                  <p className="text-xs text-rose-300 tracking-widest font-black mb-1 flex items-center gap-1.5">
                    <TrendingDown className="w-3.5 h-3.5" /> WHAT FAILED
                  </p>
                  <p className="text-sm text-rose-100 whitespace-pre-wrap break-words">{latest.failed_summary}</p>
                </div>

                <div className="rounded-lg border border-cyan-500/35 bg-cyan-950/20 p-3">
                  <p className="text-xs text-cyan-300 tracking-widest font-black mb-1">RECOMMENDED ADJUSTMENT</p>
                  <p className="text-sm text-cyan-100 whitespace-pre-wrap break-words">{latest.recommendation}</p>
                </div>
              </div>
            </HoloPanel>

            <HoloPanel>
              <p className="text-xs text-cyan-300 font-black tracking-widest mb-3">INSIGHT HISTORY</p>
              {history.length === 0 ? (
                <p className="text-sm text-slate-500">No history yet.</p>
              ) : (
                <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1">
                  {history.map((row) => {
                    const habitRate = toRate(row?.metrics?.habit_rate);
                    const questRate = toRate(row?.metrics?.quest_rate);
                    return (
                      <div
                        key={row.id}
                        className="rounded-lg p-3 border"
                        style={{ borderColor: 'rgba(56,189,248,0.18)', background: 'rgba(15,23,42,0.45)' }}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs text-slate-200 font-bold">
                            {row.week_start ? format(new Date(row.week_start), 'MMM d') : 'N/A'} - {row.week_end ? format(new Date(row.week_end), 'MMM d') : 'N/A'}
                          </p>
                          <p className="text-[11px] text-slate-400">H {habitRate}% · Q {questRate}%</p>
                        </div>
                        <p className="text-xs text-slate-300 mt-1 line-clamp-2">{row.recommendation}</p>
                      </div>
                    );
                  })}
                </div>
              )}
            </HoloPanel>
          </>
        ) : (
          <HoloPanel>
            <p className="text-sm text-slate-400">No insight generated yet.</p>
          </HoloPanel>
        )}
      </div>
    </SystemBackground>
  );
}
